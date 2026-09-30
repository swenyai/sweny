/**
 * AcpHarness specifics beyond the shared contract suite (#416): the handshake
 * it sends, permission answers, the refusal of client file access, the
 * structured-output retry, usage, the watchdog and kill escalation, protocol
 * errors, the command line, the JSON-RPC layer and the tool bridge end to end.
 * Every test drives the scripted fake ACP agent (fakes/acp-fake.mjs); nothing
 * calls a model.
 */
import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createAcpProcessFake } from "./__contract__/acp-fakes.js";
import {
  ACP_CAPABILITIES,
  AcpHarness,
  classifyAcpTool,
  isSkillToolCall,
  pickPermissionOutcome,
  toAcpMcpServers,
  type AcpHarnessOptions,
} from "./acp.js";
import { RpcError, RpcPeer, splitCommandLine } from "./acp-rpc.js";
import { createHarness, isSupportedAgent } from "./index.js";
import { policyGate } from "./policy.js";
import type { HarnessRunRequest } from "./types.js";
import type { Tool } from "../types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(here, "../../dist/cli/main.js");
const haveDist = fs.existsSync(distCli);

// These tests spawn the fake agent (and, for the bridge, the real shim); give a loaded CI runner room.
vi.setConfig({ testTimeout: 60_000 });

const fakes = createAcpProcessFake();
afterAll(() => fakes.destroy());
afterEach(async () => {
  vi.unstubAllEnvs();
  await fakes.dispose();
});

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function harness(over: Partial<AcpHarnessOptions> = {}) {
  fakes.reset();
  const log = logger();
  const h = new AcpHarness({
    logger: log,
    envScope: true,
    sandbox: "off",
    policy: "warn",
    acpCommand: fakes.command,
    killGraceMs: 300,
    cancelGraceMs: 500,
    sandboxWrapper: null,
    ...over,
  });
  return { h, log };
}

const req = (over: Partial<HarnessRunRequest> = {}): HarnessRunRequest => ({
  instruction: "Do it.",
  context: {},
  tools: [],
  ...over,
});
const DONE = [{ kind: "final" as const, text: "done" }];
const lookup: Tool = {
  name: "lookup",
  description: "Look something up.",
  input_schema: { type: "object", properties: { q: { type: "string" } } },
  handler: async () => ({}),
};
const readOnlyPolicy = { readOnly: true, deny: [], egress: [], strict: false };
const cap = () => fakes.raw().at(-1)!;
/** The optionId (or "cancelled") the adapter chose for each scripted permission request. */
const chosen = () =>
  Object.fromEntries(
    cap().permissions.map((p) => [p.id, p.outcome?.outcome === "selected" ? p.outcome.optionId : p.outcome?.outcome]),
  );

// ─── Pure helpers ────────────────────────────────────────────────

describe("classifyAcpTool", () => {
  it("maps ToolKind to portable classes", () => {
    expect(classifyAcpTool("read", "x")).toEqual({ classes: [], readOnlySafe: true });
    expect(classifyAcpTool("search", null)).toEqual({ classes: [], readOnlySafe: true });
    expect(classifyAcpTool("think", undefined)).toEqual({ classes: [], readOnlySafe: true });
    expect(classifyAcpTool("edit", "x").classes).toEqual(["write", "edit"]);
    expect(classifyAcpTool("delete", "x").classes).toEqual(["write"]);
    expect(classifyAcpTool("move", "x").classes).toEqual(["write"]);
    expect(classifyAcpTool("execute", "x").classes).toEqual(["shell"]);
    expect(classifyAcpTool("fetch", "x").classes).toEqual(["net"]);
  });

  it("falls back to the tool name for other and unknown kinds, and never calls them read-only safe", () => {
    expect(classifyAcpTool("other", "Task")).toEqual({ classes: ["subagent"], readOnlySafe: false });
    expect(classifyAcpTool("other", "Bash").classes).toEqual(["shell"]);
    expect(classifyAcpTool(undefined, "WebFetch").classes).toEqual(["net"]);
    expect(classifyAcpTool("other", "mystery")).toEqual({ classes: [], readOnlySafe: false });
    expect(classifyAcpTool("switch_mode", null).readOnlySafe).toBe(false);
  });
});

describe("isSkillToolCall", () => {
  it("recognizes the bridge's tools by the names agents give MCP tools", () => {
    const tools = ["lookup"];
    expect(isSkillToolCall(["lookup"], tools)).toBe(true);
    expect(isSkillToolCall([undefined, "mcp__sweny-core__lookup"], tools)).toBe(true);
    expect(isSkillToolCall(["sweny-core_lookup"], tools)).toBe(true);
    expect(isSkillToolCall(["sweny-core__lookup"], tools)).toBe(true);
    expect(isSkillToolCall(["other_lookup"], tools)).toBe(false);
    expect(isSkillToolCall(["lookup2"], tools)).toBe(false);
    expect(isSkillToolCall([null, ""], tools)).toBe(false);
    expect(isSkillToolCall(["lookup"], [])).toBe(false);
  });
});

describe("pickPermissionOutcome", () => {
  const opts = [
    { optionId: "a", kind: "allow_always" },
    { optionId: "o", kind: "allow_once" },
    { optionId: "r", kind: "reject_once" },
    { optionId: "ra", kind: "reject_always" },
  ];
  it("prefers the once variants", () => {
    expect(pickPermissionOutcome(opts, true)).toEqual({ outcome: "selected", optionId: "o" });
    expect(pickPermissionOutcome(opts, false)).toEqual({ outcome: "selected", optionId: "r" });
  });
  it("falls back to always, then to cancelled when the kind is not offered", () => {
    expect(pickPermissionOutcome([{ optionId: "a", kind: "allow_always" }], true)).toEqual({
      outcome: "selected",
      optionId: "a",
    });
    expect(pickPermissionOutcome([{ optionId: "a", kind: "allow_once" }], false)).toEqual({ outcome: "cancelled" });
    expect(pickPermissionOutcome([], true)).toEqual({ outcome: "cancelled" });
  });
});

describe("toAcpMcpServers", () => {
  it("builds the McpServer shapes of the schema: env and headers are name/value arrays", () => {
    const { list, unsupported } = toAcpMcpServers(
      {
        ext: { type: "stdio", command: "ext-server", args: ["--x"], env: { A: "1" } },
        bare: { command: "bare-server" },
        web: { type: "http", url: "https://mcp.example.test", headers: { Authorization: "Bearer t" } },
      },
      true,
    );
    expect(unsupported).toEqual([]);
    expect(list).toEqual([
      { name: "ext", command: "ext-server", args: ["--x"], env: [{ name: "A", value: "1" }] },
      { name: "bare", command: "bare-server", args: [], env: [] },
      {
        type: "http",
        name: "web",
        url: "https://mcp.example.test",
        headers: [{ name: "Authorization", value: "Bearer t" }],
      },
    ]);
  });

  it("reports http servers an agent without the http transport cannot load, and malformed ones", () => {
    const { list, unsupported } = toAcpMcpServers(
      { web: { type: "http", url: "https://x.test" }, nourl: { type: "http" }, weird: {} },
      false,
    );
    expect(list).toEqual([]);
    expect(unsupported).toHaveLength(3);
    expect(unsupported[0]).toMatch(/web.*no http/);
  });
});

describe("declared capabilities", () => {
  it("are weak on purpose, so strict mode needs the wrapper", () => {
    expect(ACP_CAPABILITIES).toMatchObject({
      structuredOutput: "prompt",
      builtinDeny: "none",
      readOnly: "none",
      sandbox: { fs: false, network: false },
      mcp: { inject: true, exclusive: "none" },
      turnLimit: "watchdog",
    });
    const strict = {
      readOnly: true,
      deny: ["shell" as const],
      egress: ["x.test"],
      strict: true,
      sandbox: "auto" as const,
    };
    const bare = policyGate(ACP_CAPABILITIES, strict, {});
    expect(bare.refuse).toMatch(/strict policy/);
    const wrapped = policyGate(ACP_CAPABILITIES, strict, { sandbox: true, egress: true, readOnlyMount: true });
    // The wrapper covers sandbox, egress and read-only; a deny list is still not enforceable.
    expect(wrapped.degraded.filter((d) => /sandbox|egress|read-only/.test(d))).toEqual([]);
    expect(wrapped.refuse).toMatch(/deny \[shell\]/);
  });
});

// ─── The command line ────────────────────────────────────────────

describe("the agent command", () => {
  it("splits like a shell would, without running one", () => {
    expect(splitCommandLine("opencode acp")).toEqual(["opencode", "acp"]);
    expect(splitCommandLine("  gemini   --experimental-acp ")).toEqual(["gemini", "--experimental-acp"]);
    expect(splitCommandLine(`node "/a path/agent.js" --name 'x y' a\\ b`)).toEqual([
      "node",
      "/a path/agent.js",
      "--name",
      "x y",
      "a b",
    ]);
    expect(splitCommandLine('x ""')).toEqual(["x", ""]);
    // No expansion: these stay literal.
    expect(splitCommandLine("agent $HOME `id` ; rm -rf *")).toEqual(["agent", "$HOME", "`id`", ";", "rm", "-rf", "*"]);
    expect(splitCommandLine("")).toEqual([]);
    expect(() => splitCommandLine('agent "unterminated')).toThrow(/unterminated/);
  });

  it("createHarness builds an AcpHarness for acp:<command> and isSupportedAgent accepts it", () => {
    const h = createHarness("acp:opencode acp");
    expect(h).toBeInstanceOf(AcpHarness);
    expect(h.id).toBe("acp:opencode");
    expect(h.capabilities).toBe(ACP_CAPABILITIES);
    expect(createHarness("acp:/usr/local/bin/hermes acp").id).toBe("acp:hermes");
    expect(isSupportedAgent("acp:opencode acp")).toBe(true);
    expect(isSupportedAgent("acp:")).toBe(false);
    expect(isSupportedAgent("acp:   ")).toBe(false);
    expect(isSupportedAgent("opencode")).toBe(false);
    expect(() => createHarness("acp:")).toThrow(/empty/);
  });

  it("preflight finds the command without starting it; a missing one fails with the fix", async () => {
    const ok = await new AcpHarness({ acpCommand: fakes.command }).preflight();
    expect(ok.ok).toBe(true);
    const missing = new AcpHarness({ acpCommand: "definitely-not-an-acp-agent --flag", logger: logger() });
    const pre = await missing.preflight();
    expect(pre.ok).toBe(false);
    expect(pre.ok === false && pre.reason).toMatch(/definitely-not-an-acp-agent.*not found/);
    // run() and complete() fail closed on it without spawning anything.
    const r = await missing.run(req());
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/not found/);
    expect(await missing.complete({ prompt: "p" })).toBeNull();
  });
});

// ─── The handshake ───────────────────────────────────────────────

describe("initialize and session/new", () => {
  it("speaks protocol 1, advertises no client file or terminal access, and sends an absolute cwd", async () => {
    const { h } = harness({ cwd: process.cwd() });
    fakes.script(DONE);
    const r = await h.run(req());
    expect(r.status).toBe("success");
    const c = cap();
    expect(c.initialize?.protocolVersion).toBe(1);
    expect(c.initialize?.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });
    expect(c.initialize?.clientInfo?.name).toBe("sweny");
    expect(c.sessionCwd).toBe(path.resolve(process.cwd()));
    expect(path.isAbsolute(c.sessionCwd!)).toBe(true);
    // The agent's own version from initialize is what the run is tagged with.
    expect(r.harness).toEqual({ id: h.id, version: "9.8.7" });
  });

  it("sends MCP servers in the ACP shape and reports http servers the agent cannot load", async () => {
    const servers = {
      ext: { type: "stdio" as const, command: "ext-server", args: ["--x"], env: { A: "1" } },
      web: { type: "http" as const, url: "https://mcp.example.test", headers: { Authorization: "Bearer t" } },
    };
    const a = harness();
    fakes.script(DONE);
    const noHttp = await a.h.run(req({ mcpServers: servers }));
    expect(cap().mcpServers).toEqual([
      { name: "ext", command: "ext-server", args: ["--x"], env: [{ name: "A", value: "1" }] },
    ]);
    expect(noHttp.degraded.some((d) => /^mcp: .*web.*no http/.test(d))).toBe(true);

    const b = harness();
    fakes.scriptWith({ http: true, steps: DONE });
    const withHttp = await b.h.run(req({ mcpServers: servers }));
    expect(cap().mcpServers).toContainEqual({
      type: "http",
      name: "web",
      url: "https://mcp.example.test",
      headers: [{ name: "Authorization", value: "Bearer t" }],
    });
    expect(withHttp.degraded.some((d) => d.startsWith("mcp:"))).toBe(false);
  });

  it("a dry run sends no external MCP servers, only the skill tool server", async () => {
    const { h } = harness();
    fakes.script(DONE);
    await h.run(
      req({
        readOnly: true,
        policy: readOnlyPolicy,
        tools: [lookup],
        mcpServers: { ext: { type: "stdio", command: "ext-server" } },
      }),
    );
    expect(cap().mcpServersLoaded).toEqual(["sweny-core"]);
  });

  it("refuses an agent that speaks another protocol version", async () => {
    const { h } = harness();
    fakes.scriptWith({ protocolVersion: 2, steps: DONE });
    const r = await h.run(req());
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/protocol version 2/);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("tells the operator how to authenticate when the agent wants a sign-in", async () => {
    const { h } = harness();
    fakes.scriptWith({ authRequired: true, steps: DONE });
    const r = await h.run(req());
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/SWENY_ENV_PASSTHROUGH/);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("passes only the agent auth vars the operator named through the scoped env", async () => {
    vi.stubEnv("MY_AGENT_KEY", "agent-key-value");
    vi.stubEnv("UNRELATED_SECRET", "nope");
    const a = harness({ authVars: ["MY_AGENT_KEY"] });
    fakes.script(DONE);
    await a.h.run(req());
    expect(cap().env.MY_AGENT_KEY).toBe("agent-key-value");
    expect(cap().env.UNRELATED_SECRET).toBeUndefined();

    vi.stubEnv("SWENY_ENV_PASSTHROUGH", "MY_AGENT_KEY");
    const b = harness();
    fakes.script(DONE);
    await b.h.run(req());
    expect(cap().env.MY_AGENT_KEY).toBe("agent-key-value");
  });

  it("notes that a requested model cannot be selected over ACP", async () => {
    const { h } = harness();
    fakes.script(DONE);
    const r = await h.run(req({ model: "some-model" }));
    expect(r.degraded.some((d) => d.startsWith("model:"))).toBe(true);
  });
});

// ─── Permission requests and client file access ──────────────────

describe("session/request_permission", () => {
  const ask = (id: string, toolKind: string | undefined, title: string, name?: string) => ({
    kind: "permission",
    id,
    title,
    ...(toolKind ? { toolKind } : {}),
    ...(name ? { name } : {}),
  });

  it("a dry run allows reads and skill tools and rejects everything else, including unknown tools", async () => {
    const { h } = harness();
    fakes.scriptWith({
      noProbe: true,
      steps: [
        ask("read", "read", "Read a file"),
        ask("search", "search", "Grep"),
        ask("think", "think", "Plan"),
        ask("skill", "other", "sweny-core_lookup"),
        ask("skill2", "other", "Lookup", "mcp__sweny-core__lookup"),
        ask("exec", "execute", "Run a command"),
        ask("edit", "edit", "Edit a file"),
        ask("delete", "delete", "Delete a file"),
        ask("fetch", "fetch", "Fetch a URL"),
        ask("mystery", "other", "mystery"),
        ask("nokind", undefined, "no kind at all"),
        ask("mode", "switch_mode", "Switch to build mode"),
        { kind: "final", text: "done" },
      ],
    });
    const r = await h.run(req({ readOnly: true, policy: readOnlyPolicy, tools: [lookup] }));
    expect(r.status).toBe("success");
    expect(chosen()).toEqual({
      read: "allow",
      search: "allow",
      think: "allow",
      skill: "allow",
      skill2: "allow",
      exec: "reject",
      edit: "reject",
      delete: "reject",
      fetch: "reject",
      mystery: "reject",
      nokind: "reject",
      mode: "reject",
    });
  });

  it("a normal run rejects only the classes the node denies", async () => {
    const { h } = harness();
    fakes.scriptWith({
      noProbe: true,
      steps: [
        ask("exec", "execute", "Run a command"),
        ask("edit", "edit", "Edit a file"),
        ask("fetch", "fetch", "Fetch a URL"),
        ask("task", "other", "Task", "Task"),
        { kind: "final", text: "done" },
      ],
    });
    const r = await h.run(req({ policy: { readOnly: false, deny: ["shell", "subagent"], egress: [], strict: false } }));
    expect(chosen()).toEqual({ exec: "reject", edit: "allow", fetch: "allow", task: "reject" });
    // The protocol cannot promise the agent asks, so the gate still reports the deny list as not enforced.
    expect(r.degraded.some((d) => d.startsWith("deny [shell, subagent]"))).toBe(true);
  });

  it("legacy disallowed_tools names that map to a class are rejected too, and reported as unenforced", async () => {
    const { h } = harness();
    fakes.scriptWith({
      noProbe: true,
      steps: [ask("exec", "execute", "Run a command"), ask("edit", "edit", "Edit"), { kind: "final", text: "done" }],
    });
    const r = await h.run(req({ disallowedTools: ["Bash"] }));
    expect(chosen()).toEqual({ exec: "reject", edit: "allow" });
    expect(r.degraded.some((d) => d.startsWith("disallowed_tools"))).toBe(true);
  });

  it("answers cancelled when the agent offers no option of the wanted kind", async () => {
    const { h } = harness();
    fakes.scriptWith({
      noProbe: true,
      steps: [
        { ...ask("exec", "execute", "Run"), options: [{ optionId: "yes", name: "Yes", kind: "allow_once" }] },
        { ...ask("read", "read", "Read"), options: [{ optionId: "no", name: "No", kind: "reject_once" }] },
        { kind: "final", text: "done" },
      ],
    });
    await h.run(req({ policy: { readOnly: true, deny: [], egress: [], strict: false } }));
    expect(chosen()).toEqual({ exec: "cancelled", read: "cancelled" });
  });

  it("a judge call rejects every request", async () => {
    const { h } = harness();
    fakes.scriptWith({
      noProbe: true,
      steps: [ask("read", "read", "Read"), ask("exec", "execute", "Run"), { kind: "final", text: "b" }],
    });
    expect(await h.complete({ prompt: "p" })).toBe("b");
    expect(chosen()).toEqual({ read: "allow", exec: "reject" });
    // Reads are harmless; the point is that nothing that changes anything is allowed. The probe is in the contract suite.
  });
});

describe("fs/write_text_file", () => {
  it("is refused in a dry run and in a normal run, and the run carries on", async () => {
    const dry = harness();
    fakes.scriptWith({
      noProbe: true,
      steps: [{ kind: "fs-write", path: "/tmp/never-written.txt" }, ...DONE],
    });
    const r1 = await dry.h.run(req({ readOnly: true, policy: readOnlyPolicy }));
    expect(r1.status).toBe("success");
    expect(cap().fsWrites).toHaveLength(1);
    expect(cap().fsWrites[0].error).toMatch(/read-only/);

    const normal = harness();
    fakes.scriptWith({
      noProbe: true,
      steps: [{ kind: "fs-write", path: "/tmp/never-written.txt" }, ...DONE],
    });
    const r2 = await normal.h.run(req());
    expect(r2.status).toBe("success");
    expect(cap().fsWrites[0].error).toMatch(/did not advertise/);
    expect(fs.existsSync("/tmp/never-written.txt")).toBe(false);
  });
});

// ─── Structured output ───────────────────────────────────────────

describe("structured output by prompt, parse, validate and retry", () => {
  const schema = {
    type: "object",
    properties: { ok: { type: "boolean" }, count: { type: "number" } },
    required: ["ok", "count"],
  };
  const good = JSON.stringify({ ok: true, count: 2 });

  it("puts the schema in the prompt and asks once more when the answer does not match", async () => {
    const { h, log } = harness();
    fakes.scriptWith({
      turns: [[{ kind: "final", text: '{"ok":tru' }], [{ kind: "final", text: good }]],
    });
    const r = await h.run(req({ outputSchema: schema }));
    expect(r.status).toBe("success");
    expect(r.data).toMatchObject({ ok: true, count: 2 });
    const prompts = cap().prompts;
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("## Required Output");
    expect(prompts[0]).toContain('"required"');
    expect(prompts[1]).toMatch(/did not match the required output/);
    expect(prompts[1]).toMatch(/missing required property "ok"/);
    expect(r.degraded.some((d) => d.startsWith("structured_output"))).toBe(false);
    expect(log.warn.mock.calls.some((c) => /schema/i.test(String(c[0])))).toBe(false);
  });

  it("asks only once, then reports what it could not get", async () => {
    const { h } = harness();
    fakes.scriptWith({ steps: [{ kind: "final", text: JSON.stringify({ ok: true }) }] });
    const r = await h.run(req({ outputSchema: schema }));
    expect(r.status).toBe("success");
    expect(cap().prompts).toHaveLength(2);
    expect(r.data).toMatchObject({ ok: true });
    expect(r.degraded.some((d) => d.startsWith("structured_output"))).toBe(true);
  });

  it("does not retry a matching answer, or a node without a schema", async () => {
    const a = harness();
    fakes.scriptWith({ steps: [{ kind: "final", text: "done:\n```json\n" + good + "\n```" }] });
    const ok = await a.h.run(req({ outputSchema: schema }));
    expect(ok.data).toMatchObject({ ok: true, count: 2 });
    expect(cap().prompts).toHaveLength(1);

    const b = harness();
    fakes.scriptWith({ steps: [{ kind: "final", text: "not json at all" }] });
    const none = await b.h.run(req());
    expect(none.status).toBe("success");
    expect(cap().prompts).toHaveLength(1);
  });

  it("does not retry after a timeout or a stop", async () => {
    const { h } = harness();
    fakes.scriptWith({ steps: [{ kind: "hang" }] });
    const r = await h.run(req({ outputSchema: schema, timeoutMs: 400 }));
    expect(r.status).toBe("failed");
    expect(cap().prompts.length).toBeLessThanOrEqual(1);
  });
});

// ─── Output text and tool calls ──────────────────────────────────

describe("what counts as the agent's answer", () => {
  const chunk = (text: string, messageId?: string) => ({
    kind: "raw" as const,
    event: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s",
        update: {
          sessionUpdate: "agent_message_chunk",
          ...(messageId ? { messageId } : {}),
          content: { type: "text", text },
        },
      },
    },
  });

  it("is the text after the agent's last tool call, not the narration before it", async () => {
    const { h } = harness();
    fakes.script([
      chunk("I will look that up."),
      { kind: "tool-call", id: "t1", name: "lookup", input: { q: 1 } },
      { kind: "tool-result", id: "t1", content: "{}" },
      { kind: "final", text: "The answer is 42." },
    ]);
    const r = await h.run(req());
    expect(r.data.summary).toBe("The answer is 42.");
  });

  it("is the last message when the agent labels its messages", async () => {
    const { h } = harness();
    fakes.script([
      chunk("first ", "m-a"),
      chunk("part", "m-a"),
      chunk("second message", "m-b"),
      { kind: "final", text: "" },
    ]);
    const r = await h.run(req());
    expect(r.data.summary).toBe("second message");
  });

  it("keeps a tool call's diff and raw output when there is no text", async () => {
    const { h } = harness();
    fakes.script([
      {
        kind: "raw",
        event: {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "s",
            update: { sessionUpdate: "tool_call", toolCallId: "d1", title: "Edit", kind: "edit", status: "pending" },
          },
        },
      },
      {
        kind: "raw",
        event: {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "s",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "d1",
              status: "completed",
              content: [{ type: "diff", path: "/w/a.txt", oldText: "a", newText: "b" }],
            },
          },
        },
      },
      ...DONE,
    ]);
    const r = await h.run(req());
    expect(r.toolCalls).toEqual([
      { tool: "Edit", input: {}, status: "success", output: [{ path: "/w/a.txt", oldText: "a", newText: "b" }] },
    ]);
  });
});

describe("usage", () => {
  it("maps cumulative USD cost, and leaves everything else absent", async () => {
    const { h } = harness();
    fakes.script([{ kind: "final", text: "done", usage: { costUsd: 0.5, inputTokens: 100, outputTokens: 20 } }]);
    const r = await h.run(req());
    expect(r.usage).toEqual({ costUsd: 0.5 });
  });

  it("does not record a cost in another currency as dollars", async () => {
    const { h } = harness();
    fakes.script([
      {
        kind: "raw",
        event: {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "s",
            update: { sessionUpdate: "usage_update", used: 1, size: 2, cost: { amount: 3, currency: "EUR" } },
          },
        },
      },
      ...DONE,
    ]);
    const r = await h.run(req());
    expect(r.usage).toBeUndefined();
  });
});

// ─── Stopping the agent ──────────────────────────────────────────

describe("session/cancel and kill escalation", () => {
  it("sends session/cancel on timeout and the agent ends the turn", async () => {
    const { h } = harness();
    fakes.script([{ kind: "tool-call", id: "h1", name: "lookup", input: {} }, { kind: "hang" }]);
    const r = await h.run(req({ timeoutMs: 1500 }));
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/timed out after 1500ms/);
    expect(cap().cancels).toBe(1);
    expect(fakes.captured().stopped).toBe(true);
  });

  it("kills an agent that ignores session/cancel, closed stdin and SIGTERM", async () => {
    const { h } = harness({ cancelGraceMs: 200, killGraceMs: 200 });
    fakes.scriptWith({ ignoreCancel: true, ignoreEof: true, ignoreTerm: true, steps: [{ kind: "hang" }] });
    const t0 = Date.now();
    const r = await h.run(req({ timeoutMs: 1000 }));
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/timed out/);
    expect(fakes.captured().stopped).toBe(true);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("the watchdog cancels past the tool-call budget and still kills an agent that does not stop", async () => {
    const { h } = harness({ cancelGraceMs: 300 });
    fakes.scriptWith({
      ignoreCancel: true,
      steps: [
        { kind: "tool-call", id: "w1", name: "lookup", input: {} },
        { kind: "tool-call", id: "w2", name: "lookup", input: {} },
        { kind: "hang" },
      ],
    });
    const r = await h.run(req({ maxTurns: 1 }));
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/max_turns \(1 tool calls/);
    expect(r.degraded.some((d) => d.startsWith("max_turns"))).toBe(true);
    expect(fakes.captured().stopped).toBe(true);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("a judge call that makes the agent call a tool fails closed", async () => {
    const { h, log } = harness();
    fakes.script([{ kind: "tool-call", id: "c1", name: "lookup", input: {} }, ...DONE]);
    expect(await h.complete({ prompt: "p", purpose: "evaluate" })).toBeNull();
    expect(log.warn.mock.calls.some((c) => /acp\.evaluate: .*tried to call a tool/.test(String(c[0])))).toBe(true);
  });
});

// ─── Strict policy ───────────────────────────────────────────────

describe("strict policy", () => {
  it("refuses a node in CI conditions unless the process wrapper is there", async () => {
    const { h } = harness({ policy: "strict", sandbox: "auto" });
    fakes.script(DONE);
    const r = await h.run(req());
    expect(r.status).toBe("failed");
    expect(r.data.refused).toBe(true);
    expect(String(r.data.error)).toMatch(/strict policy: sandbox/);
    expect(fakes.raw()).toHaveLength(0);
    // Judge calls fail closed the same way: no agent process is started.
    expect(await h.complete({ prompt: "p" })).toBeNull();
    expect(fakes.raw()).toHaveLength(0);
  });

  it("a node with no sandbox ask runs in strict mode when sandboxing is off", async () => {
    const { h } = harness({ policy: "strict", sandbox: "off" });
    fakes.script(DONE);
    const r = await h.run(req());
    expect(r.status).toBe("success");
  });
});

// ─── The JSON-RPC layer ──────────────────────────────────────────

describe("RpcPeer", () => {
  function pair(handlers: Partial<ConstructorParameters<typeof RpcPeer>[1]> = {}) {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const sent: Array<Record<string, any>> = [];
    let buf = "";
    stdin.on("data", (c: Buffer) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        sent.push(JSON.parse(buf.slice(0, nl)));
        buf = buf.slice(nl + 1);
      }
    });
    const junk: string[] = [];
    const notes: Array<[string, unknown]> = [];
    const peer = new RpcPeer({ stdin, stdout } as never, {
      onRequest: async () => ({}),
      onNotification: (m, p) => notes.push([m, p]),
      onJunk: (l) => junk.push(l),
      ...handlers,
    });
    const tick = () => new Promise((r) => setTimeout(r, 10));
    return { peer, stdout, sent, junk, notes, tick };
  }

  it("matches responses to requests by id, across split chunks, and skips non-JSON lines", async () => {
    const { peer, stdout, sent, junk, tick } = pair();
    const a = peer.request("a", { x: 1 });
    const b = peer.request("b", {});
    await tick();
    expect(sent.map((m) => [m.id, m.method])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(sent[0]).toMatchObject({ jsonrpc: "2.0", params: { x: 1 } });
    stdout.write("Welcome to the agent!\n");
    stdout.write('{"jsonrpc":"2.0","id":2,"res');
    stdout.write('ult":{"which":"b"}}\n{"jsonrpc":"2.0","id":1,"result":{"which":"a"}}\n');
    expect(await b).toEqual({ which: "b" });
    expect(await a).toEqual({ which: "a" });
    expect(junk).toEqual(["Welcome to the agent!"]);
  });

  it("rejects with the error the agent sent", async () => {
    const { peer, stdout, tick } = pair();
    const p = peer.request("x", {});
    await tick();
    stdout.write('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Authentication required"}}\n');
    await expect(p).rejects.toMatchObject({ name: "RpcError", code: -32000, message: "Authentication required" });
  });

  it("answers the agent's requests from the handler, with errors as error responses", async () => {
    const { stdout, sent, tick } = pair({
      onRequest: async (method) => {
        if (method === "ok") return { fine: true };
        if (method === "nope") throw new RpcError("not here", -32601);
        throw new Error("boom");
      },
    });
    stdout.write('{"jsonrpc":"2.0","id":"a","method":"ok","params":{}}\n');
    stdout.write('{"jsonrpc":"2.0","id":7,"method":"nope"}\n');
    stdout.write('{"jsonrpc":"2.0","id":8,"method":"other"}\n');
    await tick();
    await tick();
    const byId = Object.fromEntries(sent.map((m) => [String(m.id), m]));
    expect(byId.a.result).toEqual({ fine: true });
    expect(byId["7"].error).toEqual({ code: -32601, message: "not here" });
    expect(byId["8"].error).toEqual({ code: -32603, message: "boom" });
  });

  it("delivers notifications, and end() rejects what is pending after flushing a final unterminated line", async () => {
    const { peer, stdout, notes, tick } = pair();
    stdout.write('{"jsonrpc":"2.0","method":"session/update","params":{"n":1}}\n');
    const done = peer.request("x", {});
    const late = peer.request("y", {});
    await tick();
    stdout.write('{"jsonrpc":"2.0","id":1,"result":"last words"}');
    await tick();
    const lateRejected = expect(late).rejects.toThrow(/agent process exited/);
    peer.end("agent process exited");
    expect(await done).toBe("last words");
    await lateRejected;
    await expect(peer.request("z", {})).rejects.toThrow(/agent process exited/);
    expect(notes).toEqual([["session/update", { n: 1 }]]);
  });
});

// ─── The tool bridge, end to end ─────────────────────────────────

describe.skipIf(!haveDist)("AcpHarness skill tools over the tool bridge (needs the core build)", () => {
  const shim = { command: process.execPath, args: [distCli, "tool-bridge"] };

  it("the agent lists and calls sweny skill tools through session/new's MCP server; the token never touches argv", async () => {
    const calls: unknown[] = [];
    const tool: Tool = {
      name: "lookup",
      description: "Look something up.",
      input_schema: { type: "object", properties: { q: { type: "string" } } },
      handler: async (input) => {
        calls.push(input);
        return { found: (input as { q: string }).q };
      },
    };
    const { h } = harness({ toolBridgeShim: shim });
    fakes.scriptWith({
      callMcp: true,
      steps: [
        { kind: "tool-call", id: "t1", name: "lookup", input: { q: "a" } },
        { kind: "final", text: "done" },
      ],
    });
    const r = await h.run(req({ tools: [tool] }));
    expect(r.status).toBe("success");
    const c = cap();
    expect(c.mcpTools).toEqual({ "sweny-core": ["lookup"] });
    expect(calls).toEqual([{ q: "a" }]);
    expect(r.toolCalls).toEqual([{ tool: "lookup", input: { q: "a" }, status: "success", output: { found: "a" } }]);
    const server = c.mcpServers.find((s) => s.name === "sweny-core")!;
    const token = (server.env as Array<{ name: string; value: string }>).find(
      (e) => e.name === "SWENY_TOOL_BRIDGE_TOKEN",
    )?.value;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // The token reaches the shim in session/new's env list (over the agent's stdin), never in any argv.
    expect(JSON.stringify([c.args, server.args, server.command])).not.toContain(token!);
    expect(fakes.leftovers()).toEqual([]);
  });
});
