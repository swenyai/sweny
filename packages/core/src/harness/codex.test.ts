/**
 * CodexHarness specifics beyond the shared contract suite (#331): the argv it
 * builds, strict refusal, the tool bridge end to end, the schema fallback,
 * item mapping, auth env and preflight. Every test drives the scripted fake
 * `codex` process (fakes/codex-fake.mjs); nothing calls a model.
 */
import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexProcessFake } from "./__contract__/fakes.js";
import {
  CodexHarness,
  CODEX_ISOLATION_FEATURES_OFF,
  codexBackendHosts,
  isStrictCompatibleSchema,
  toTomlValue,
  translateDenyNames,
  type CodexHarnessOptions,
} from "./codex.js";
import { createHarness } from "./index.js";
import { triageWorkflow } from "../workflows/index.js";
import { buildNodePolicy, resolveNodePermissions } from "../node-policy.js";
import type { ExecutionEvent, Skill, Tool, Workflow } from "../types.js";
import type { NodePolicy } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(here, "../../dist/cli/main.js");
const haveDist = fs.existsSync(distCli);

// These tests spawn the fake codex (and, for the bridge, the real shim); give a loaded CI runner room.
vi.setConfig({ testTimeout: 60_000 });

const fakes = createCodexProcessFake();
afterAll(() => fakes.destroy());
afterEach(async () => {
  vi.unstubAllEnvs();
  await fakes.dispose();
});

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function harness(over: Partial<CodexHarnessOptions> = {}) {
  fakes.reset();
  const log = logger();
  const h = new CodexHarness({
    logger: log,
    envScope: true,
    sandbox: "off",
    policy: "warn",
    codexCommand: fakes.command,
    killGraceMs: 500,
    sandboxWrapper: null,
    ...over,
  });
  return { h, log };
}

const DONE = [{ kind: "final" as const, text: "done" }];

/** `-c` values the fake parsed, flattened to "a.b.c" keys. */
function overrides(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v) && !key.startsWith("mcp_servers.")) {
        walk(v as Record<string, unknown>, key);
      } else out[key] = v;
    }
  };
  walk(fakes.raw().at(-1)!.config, "");
  return out;
}

describe("CodexHarness argv", () => {
  it("runs codex exec headless, isolated from the user's config, with the prompt on stdin", async () => {
    const { h } = harness({ model: "gpt-5-codex" });
    fakes.script(DONE);
    const r = await h.run({ instruction: "Do it.", context: { a: 1 }, tools: [] });
    expect(r.status).toBe("success");
    const cap = fakes.raw().at(-1)!;
    expect(cap.args[0]).toBe("exec");
    for (const flag of ["--json", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check"]) {
      expect(cap.flags).toContain(flag);
    }
    expect(cap.args.at(-1)).toBe("-");
    expect(cap.prompt).toContain("## Instruction\n\nDo it.");
    expect(cap.model).toBe("gpt-5-codex");
    expect(cap.cd).toBe(process.cwd());
    const o = overrides();
    expect(o.approval_policy).toBe("never");
    expect(o.check_for_update_on_startup).toBe(false);
    expect(String(o.developer_instructions)).toMatch(/automated workflow/);
    for (const f of CODEX_ISOLATION_FEATURES_OFF) expect(o[`features.${f}`], f).toBe(false);
    // Unsandboxed locally (SWENY_SANDBOX off), like Claude Code.
    expect(cap.sandbox).toBe("danger-full-access");
    expect(r.harness).toEqual({ id: "codex", version: "0.159.2" });
  });

  it("sandboxes commands in workspace-write with network on when the host can sandbox", async () => {
    const { h } = harness({ sandbox: "auto", sandboxProbe: () => undefined });
    fakes.script(DONE);
    await h.run({ instruction: "x", context: {}, tools: [] });
    expect(fakes.raw().at(-1)!.sandbox).toBe("workspace-write");
    expect(overrides()["sandbox_workspace_write.network_access"]).toBe(true);
  });

  it("read-only keeps the shell inside --sandbox read-only; net and subagents stay off", async () => {
    const { h } = harness();
    fakes.script(DONE);
    const readOnlyPolicy: NodePolicy = { readOnly: true, deny: [], egress: [], strict: false };
    const r = await h.run({ instruction: "x", context: {}, tools: [], readOnly: true, policy: readOnlyPolicy });
    expect(r.status).toBe("success");
    expect(fakes.raw().at(-1)!.sandbox).toBe("read-only");
    const o = overrides();
    // Codex has no non-shell way to read files, so the shell must survive.
    expect(o["features.shell_tool"]).toBeUndefined();
    expect(o.web_search).toBe("disabled");
    expect(o["features.multi_agent"]).toBe(false);
    expect(o["sandbox_workspace_write.network_access"]).toBeUndefined();
    expect(r.degraded.filter((d) => d.startsWith("read-only"))).toEqual([]);
  });

  it("read-only still honors an explicit tools.deny: [shell]", async () => {
    const { h } = harness();
    fakes.script(DONE);
    const policy: NodePolicy = { readOnly: true, deny: ["shell"], egress: [], strict: false };
    const r = await h.run({ instruction: "x", context: {}, tools: [], readOnly: true, policy });
    expect(r.status).toBe("success");
    expect(fakes.raw().at(-1)!.sandbox).toBe("read-only");
    expect(overrides()["features.shell_tool"]).toBe(false);
  });

  it("auto falls back to unsandboxed with one warning; strict fails the node", async () => {
    const auto = harness({ sandbox: "auto", sandboxProbe: () => "no bwrap" });
    fakes.script(DONE);
    await auto.h.run({ instruction: "x", context: {}, tools: [] });
    await auto.h.run({ instruction: "x", context: {}, tools: [] });
    expect(fakes.raw().at(-1)!.sandbox).toBe("danger-full-access");
    expect(auto.log.warn.mock.calls.filter((c) => /unsandboxed/.test(String(c[0])))).toHaveLength(1);

    const strict = harness({ sandbox: "strict", sandboxProbe: () => "no bwrap" });
    const r = await strict.h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/SWENY_SANDBOX=strict/);
    expect(fakes.raw()).toHaveLength(0);
  });

  it("injects stdio and http MCP servers with -c mcp_servers.*, and reports what codex cannot load", async () => {
    const { h } = harness();
    fakes.script(DONE);
    const r = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      mcpServers: {
        local: { type: "stdio", command: "srv", args: ["--a"], env: { K: "v" } },
        remote: { type: "http", url: "https://mcp.example/x", headers: { Authorization: "Bearer t" } },
        broken: { type: "sse" as never },
      },
    });
    const servers = fakes.raw().at(-1)!.config.mcp_servers;
    expect(servers.local).toEqual({ command: "srv", args: ["--a"], env: { K: "v" } });
    expect(servers.remote).toEqual({ url: "https://mcp.example/x", http_headers: { Authorization: "Bearer t" } });
    expect(servers.broken).toBeUndefined();
    expect(r.degraded.some((d) => d.startsWith("mcp: codex cannot load broken"))).toBe(true);
  });

  it("gives codex its own credentials only: OPENAI_API_KEY becomes CODEX_API_KEY, Anthropic's stay out", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
    vi.stubEnv("CODEX_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-test");
    const { h } = harness();
    fakes.script(DONE);
    await h.run({ instruction: "x", context: {}, tools: [] });
    const env = fakes.raw().at(-1)!.env;
    expect(env.CODEX_API_KEY).toBe("sk-openai-test");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(env.CODEX_HOME).toBe(fakes.ambientHome);
  });
});

describe("CodexHarness policy", () => {
  it("strict: a workflow node with tools.deny: [write] fails the run, even with fail_soft", async () => {
    const { execute } = await import("../executor.js");
    const { createSkillMap } = await import("../skills/index.js");
    const { h } = harness({ policy: "strict" });
    fakes.script(DONE);
    const workflow: Workflow = {
      id: "strict",
      name: "strict",
      description: "one node",
      entry: "edit",
      nodes: {
        edit: { name: "Edit", instruction: "Change nothing", skills: [], tools: { deny: ["write"] }, fail_soft: true },
      },
      edges: [],
    };
    const silent = { info() {}, warn() {}, error() {}, debug() {} };
    const { results } = await execute(
      workflow,
      {},
      { skills: createSkillMap([]), harness: h, config: {}, logger: silent },
    );
    const r = results.get("edit")!;
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/^codex refused this node: strict policy: deny \[write\]/);
    expect(r.data.fail_soft).toBeUndefined();
    expect(fakes.raw()).toHaveLength(0);
  });

  it("strict refuses deny: [write] before codex starts, naming codex and write", async () => {
    const { h, log } = harness({ policy: "strict" });
    fakes.script(DONE);
    const r = await h.run({ instruction: "x", context: {}, tools: [], deny: ["write"] });
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/codex/);
    expect(String(r.data.error)).toMatch(/write/);
    expect(r.degraded.some((d) => d.startsWith("deny [write]"))).toBe(true);
    expect(fakes.raw()).toHaveLength(0);
    expect(log.error).toHaveBeenCalled();
  });

  it("warn runs deny: [write] and reports it; shell, net and subagent denials are native", async () => {
    const { h } = harness();
    fakes.script(DONE);
    const r = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      deny: ["write", "shell", "net", "subagent"],
    });
    expect(r.status).toBe("success");
    expect(r.degraded).toEqual([
      "deny [write]: harness can only deny [shell, net, subagent]",
      expect.stringMatching(/^max_turns: /),
    ]);
    const o = overrides();
    expect(o["features.shell_tool"]).toBe(false);
    expect(o.web_search).toBe("disabled");
    expect(o["features.multi_agent"]).toBe(false);
    expect(o["agents.enabled"]).toBe(false);
  });

  it("translates Claude Code tool names in disallowed_tools; unknown names are reported", () => {
    expect(translateDenyNames(["Bash", "WebFetch", "WebSearch", "Task"])).toEqual({
      classes: ["shell", "net", "subagent"],
      unknown: [],
    });
    expect(translateDenyNames(["Write", "Edit", "NotebookEdit"])).toEqual({ classes: ["write", "edit"], unknown: [] });
    expect(translateDenyNames(["apply_patch", "FancyTool"])).toEqual({
      classes: ["write", "edit"],
      unknown: ["FancyTool"],
    });
  });

  it("bundled triage.yml under strict: no node is refused, every opinion is enforced natively (#365)", async () => {
    const byNode: Record<string, string[]> = {};
    const { h } = harness({ policy: "strict" });
    for (const [id, node] of Object.entries(triageWorkflow.nodes)) {
      // The policy execute() builds for this node.
      const permissions = resolveNodePermissions(node, triageWorkflow);
      // Egress is its own opinion (kept by the sandbox wrapper, #360); leave it
      // out so this checks only what the workflow file itself asks for.
      const policy = buildNodePolicy({ permissions, dryRun: false, disallowedTools: node.disallowed_tools });
      fakes.script(DONE);
      const r = await h.run({
        instruction: "x",
        context: {},
        tools: [],
        policy,
        ...(policy.readOnly ? { readOnly: true } : {}),
      });
      byNode[id] = r.degraded;
      expect(r.status, `${id}: ${String(r.data.error ?? "")}`).toBe("success");
      // The turn budget is the one opinion Codex keeps by watchdog; it is reported, never refused.
      expect(
        r.degraded.filter((d) => !d.startsWith("max_turns: ")),
        id,
      ).toEqual([]);
    }
    // gather used to disallow Write/Edit/NotebookEdit, which Codex cannot deny (apply_patch)
    // and strict refused. It is now permissions: read, which Codex enforces natively.
    expect(byNode.gather.some((d) => d.startsWith("deny"))).toBe(false);
    expect(byNode.gather.some((d) => d.startsWith("read-only"))).toBe(false);
  });

  it("the turn watchdog stops a runaway run and keeps partial text", async () => {
    const { h } = harness({ maxTurns: 2 });
    fakes.script([
      { kind: "raw", event: { type: "item.completed", item: { id: "m0", type: "agent_message", text: "partial" } } },
      { kind: "tool-call", id: "a", name: "lookup", input: {} },
      { kind: "tool-call", id: "b", name: "lookup", input: {} },
      { kind: "tool-call", id: "c", name: "lookup", input: {} },
      { kind: "hang" },
    ]);
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/max_turns \(2 tool calls/);
    expect(r.data.summary).toBe("partial");
    expect(r.toolCalls).toHaveLength(3);
    expect(fakes.captured().stopped).toBe(true);
  });
});

describe("CodexHarness output", () => {
  it("maps command, patch, web search and MCP items onto toolCalls", async () => {
    const { h } = harness();
    const cmd = {
      id: "c1",
      type: "command_execution",
      command: "git log -1",
      aggregated_output: "",
      status: "in_progress",
    };
    fakes.script([
      { kind: "raw", event: { type: "item.started", item: cmd } },
      {
        kind: "raw",
        event: {
          type: "item.completed",
          item: { ...cmd, aggregated_output: "abc\n", exit_code: 0, status: "completed" },
        },
      },
      {
        kind: "raw",
        event: {
          type: "item.started",
          item: { id: "c2", type: "command_execution", command: "false", aggregated_output: "", status: "in_progress" },
        },
      },
      {
        kind: "raw",
        event: {
          type: "item.completed",
          item: {
            id: "c2",
            type: "command_execution",
            command: "false",
            aggregated_output: "",
            exit_code: 1,
            status: "failed",
          },
        },
      },
      {
        kind: "raw",
        event: {
          type: "item.completed",
          item: { id: "p1", type: "file_change", changes: [{ path: "a.ts", kind: "update" }], status: "completed" },
        },
      },
      { kind: "raw", event: { type: "item.started", item: { id: "w1", type: "web_search", query: "codex" } } },
      { kind: "raw", event: { type: "item.completed", item: { id: "w1", type: "web_search", query: "codex" } } },
      { kind: "raw", event: { type: "item.completed", item: { id: "r1", type: "reasoning", text: "thinking" } } },
      { kind: "final", text: "done" },
    ]);
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("success");
    expect(r.toolCalls).toEqual([
      { tool: "shell", input: { command: "git log -1" }, status: "success", output: "abc\n" },
      { tool: "shell", input: { command: "false" }, status: "error", output: { error: "" } },
      {
        tool: "apply_patch",
        input: { changes: [{ path: "a.ts", kind: "update" }] },
        status: "success",
        output: [{ path: "a.ts", kind: "update" }],
      },
      { tool: "web_search", input: { query: "codex" }, status: "success", output: null },
    ]);
  });

  it("falls back to prompt-only structured output when codex rejects the schema", async () => {
    const { h, log } = harness();
    fakes.scriptFor(1, [
      { kind: "raw", event: { type: "error", message: "Invalid schema for response_format 'codex_output_schema'" } },
      { kind: "raw", event: { type: "turn.failed", error: { message: "Invalid schema for response_format" } } },
    ]);
    fakes.scriptFor(2, [{ kind: "final", text: '{"ok":true}' }]);
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const r = await h.run({ instruction: "x", context: {}, tools: [], outputSchema: schema });
    expect(r.status).toBe("success");
    expect(r.data).toMatchObject({ ok: true });
    const [first, second] = fakes.raw();
    expect(first.outputSchema).toEqual(schema);
    expect(second.outputSchemaPath).toBeUndefined();
    // The schema is still in the prompt both times.
    expect(second.prompt).toContain("## Required Output");
    expect(
      r.degraded.some((d) => d.startsWith("structured_output: the output schema is not OpenAI strict-compatible")),
    ).toBe(true);
    expect(log.warn.mock.calls.some((c) => /retrying without --output-schema/.test(String(c[0])))).toBe(true);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("strict policy refuses a schema fallback before an unvalidated second run", async () => {
    const { h } = harness({ policy: "strict" });
    fakes.scriptFor(1, [
      { kind: "raw", event: { type: "turn.failed", error: { message: "Invalid schema for response_format" } } },
    ]);
    fakes.scriptFor(2, [{ kind: "final", text: '{"ok":"not-a-boolean"}' }]);
    const r = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });
    expect(r.status).toBe("failed");
    expect(r.data.refused).toBe(true);
    expect(r.data.error).toMatch(/strict.*structured.output/i);
    expect(r.degraded.some((d) => d.startsWith("structured_output:"))).toBe(true);
    expect(fakes.raw()).toHaveLength(1);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("complete() fails closed when the model tries to use a tool", async () => {
    const { h } = harness();
    fakes.script([
      { kind: "tool-call", id: "t", name: "lookup", input: {} },
      { kind: "final", text: "a" },
    ]);
    expect(await h.complete({ prompt: "p", purpose: "evaluate" })).toBeNull();
  });
});

describe("CodexHarness preflight", () => {
  it("refuses a codex older than the minimum", async () => {
    const { h } = harness();
    fakes.setVersion("0.100.0");
    const pre = await h.preflight();
    expect(pre).toMatchObject({ ok: false });
    const r = await new CodexHarness({
      logger: logger(),
      codexCommand: fakes.command,
      policy: "warn",
      sandbox: "off",
      sandboxWrapper: null,
    }).run({
      instruction: "x",
      context: {},
      tools: [],
    });
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/too old/);
  });

  it("fails with the login fix when codex is installed but not logged in (#339)", async () => {
    const { h } = harness({ authProbe: () => ({ ok: false, reason: "Codex has no login. Run `codex login`." }) });
    const pre = await h.preflight();
    expect(pre.ok).toBe(false);
    expect(!pre.ok && pre.reason).toMatch(/codex login/);
  });

  it("passes when codex is new enough and can authenticate", async () => {
    const { h } = harness({ authProbe: () => ({ ok: true, via: "OPENAI_API_KEY" }) });
    expect(await h.preflight()).toMatchObject({ ok: true });
  });

  it("names the install command when codex is missing", async () => {
    const h = new CodexHarness({ logger: logger(), codexCommand: { command: "sweny-no-such-codex-binary", args: [] } });
    const pre = await h.preflight();
    expect(pre.ok).toBe(false);
    expect(!pre.ok && pre.reason).toMatch(/npm install -g @openai\/codex/);
  });

  it("createHarness('codex') builds the Codex adapter", () => {
    expect(createHarness("codex", { logger: logger() })).toBeInstanceOf(CodexHarness);
  });
});

describe("CodexHarness helpers", () => {
  it("writes TOML values the way the official SDK does", () => {
    expect(toTomlValue('a"b')).toBe('"a\\"b"');
    expect(toTomlValue(["x", 1, true])).toBe('["x", 1, true]');
    expect(toTomlValue({ K: "v", "a.b": false })).toBe('{K = "v", "a.b" = false}');
  });

  it("lets Codex reach its own backend through the sandbox wrapper, and a gateway when set", () => {
    expect(codexBackendHosts({})).toEqual(["api.openai.com", "chatgpt.com", "auth.openai.com"]);
    expect(codexBackendHosts({ OPENAI_BASE_URL: "https://gw.example.test:8443/v1" })).toContain("gw.example.test:8443");
  });

  it("recognizes OpenAI strict-compatible schemas", () => {
    expect(isStrictCompatibleSchema({ type: "object", properties: { a: { type: "string" } } })).toBe(false);
    expect(
      isStrictCompatibleSchema({
        type: "object",
        additionalProperties: false,
        required: ["a"],
        properties: { a: { type: "array", items: { type: "string" } } },
      }),
    ).toBe(true);
  });
});

// ─── The tool bridge, end to end ─────────────────────────────────

describe.skipIf(!haveDist)("CodexHarness skill tools over the tool bridge (needs the core build)", () => {
  const shim = { command: process.execPath, args: [distCli, "tool-bridge"] };

  it("codex's MCP client lists and calls sweny skill tools; the token never touches argv", async () => {
    const calls: unknown[] = [];
    const lookup: Tool = {
      name: "lookup",
      description: "Look something up.",
      input_schema: { type: "object", properties: { q: { type: "string" } } },
      handler: async (input) => {
        calls.push(input);
        return { found: (input as { q: string }).q };
      },
    };
    const { h } = harness({ toolBridgeShim: shim });
    fakes.scriptWith(
      [
        { kind: "tool-call", id: "t1", name: "lookup", input: { q: "a" } },
        { kind: "final", text: "done" },
      ],
      { callMcp: true },
    );
    const r = await h.run({ instruction: "x", context: {}, tools: [lookup] });
    expect(r.status).toBe("success");
    const cap = fakes.raw().at(-1)!;
    expect(cap.mcpTools).toEqual({ "sweny-core": ["lookup"] });
    expect(calls).toEqual([{ q: "a" }]);
    expect(r.toolCalls).toEqual([{ tool: "lookup", input: { q: "a" }, status: "success", output: { found: "a" } }]);
    // The token reached codex's env and travels to the shim by name only.
    const token = cap.env.SWENY_TOOL_BRIDGE_TOKEN;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(cap.config.mcp_servers["sweny-core"].env_vars).toEqual(["SWENY_TOOL_BRIDGE_TOKEN"]);
    expect(cap.args.join(" ")).not.toContain(token);
    expect(cap.config.mcp_servers["sweny-core"].required).toBe(true);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("through the executor: sweny observes every bridged call, and a dry run exposes read tools only", async () => {
    const seen: string[] = [];
    const tool = (name: string, access: "read" | "write"): Tool => ({
      name,
      description: name,
      input_schema: { type: "object", properties: {} },
      access,
      handler: async () => {
        seen.push(name);
        return { ok: name };
      },
    });
    const skill: Skill = {
      id: "poster",
      name: "Poster",
      description: "reads and posts",
      category: "general",
      config: {},
      tools: [tool("get_thread", "read"), tool("post_comment", "write")],
    };
    const workflow: Workflow = {
      id: "bridge",
      name: "bridge",
      description: "one node",
      entry: "post",
      nodes: { post: { name: "Post", instruction: "Post a comment", skills: ["poster"] } },
      edges: [],
    };
    const { execute } = await import("../executor.js");
    const { createSkillMap } = await import("../skills/index.js");
    const silent = { info() {}, warn() {}, error() {}, debug() {} };

    const { h } = harness({ toolBridgeShim: shim });
    fakes.scriptWith(
      [
        { kind: "tool-call", id: "t1", name: "get_thread", input: {} },
        { kind: "tool-call", id: "t2", name: "post_comment", input: {} },
        { kind: "final", text: "done" },
      ],
      { callMcp: true },
    );
    const events: ExecutionEvent[] = [];
    const { results } = await execute(
      workflow,
      { dryRun: true },
      { skills: createSkillMap([skill]), harness: h, config: {}, logger: silent, observer: (e) => events.push(e) },
    );

    const cap = fakes.raw().at(-1)!;
    expect(cap.sandbox).toBe("read-only");
    expect(cap.mcpTools).toEqual({ "sweny-core": ["get_thread"] });
    expect(seen).toEqual(["get_thread"]);
    expect(events.filter((e) => e.type === "tool:call").map((e) => (e as { tool: string }).tool)).toEqual([
      "get_thread",
    ]);
    const post = results.get("post")!;
    expect(post.harness?.id).toBe("codex");
    expect(post.toolCalls[0]).toMatchObject({ tool: "get_thread", status: "success", output: { ok: "get_thread" } });
    expect(post.toolCalls[1]).toMatchObject({ tool: "post_comment", status: "error" });
    expect(fakes.leftovers()).toEqual([]);
  });
});

// A descendant that ignores SIGTERM and holds inherited stdout/stderr open
// exercises process-tree cleanup, not just the immediate fake CLI's exit.
describe.skipIf(process.platform === "win32")("CodexHarness descendant cleanup", () => {
  it("preserves a host once-signal handler's asynchronous graceful shutdown", async () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "sweny-codex-host-"));
    const pidFile = path.join(dir, "pids.json");
    try {
      // CI builds core before testing. Fail rather than skip if it is missing.
      const distHarness = path.resolve(here, "../../dist/harness/codex.js");
      expect(fs.existsSync(distHarness)).toBe(true);
      await new Promise<void>((resolve, reject) => {
        execFile(
          process.execPath,
          [path.join(here, "fakes/codex-descendant.mjs"), "--host", distHarness, pidFile],
          { timeout: 5000, killSignal: "SIGKILL" },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      expect(fs.readFileSync(`${pidFile}.graceful`, "utf8")).toBe("done");
      const { descendant } = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      await vi.waitFor(() => {
        let alive = true;
        try {
          process.kill(descendant, 0);
          if (process.platform === "linux") alive = !/\) Z /.test(fs.readFileSync(`/proc/${descendant}/stat`, "utf8"));
        } catch {
          alive = false;
        }
        expect(alive).toBe(false);
      });
    } finally {
      if (fs.existsSync(pidFile)) {
        const pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
        for (const pid of [pids.parent, pids.descendant]) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* already stopped */
          }
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["timeout", "signal", "exit"] as const)("bounds %s cleanup after the CLI exits first", async (mode) => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "sweny-codex-reap-"));
    const pidFile = path.join(dir, "pids.json");
    const controller = new AbortController();
    const { h } = harness({
      codexCommand: { command: process.execPath, args: [path.join(here, "fakes/codex-descendant.mjs"), pidFile, mode] },
      killGraceMs: 100,
    });
    let pids: { parent: number; descendant: number } | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const running = h.run({
      instruction: "x",
      context: {},
      tools: [],
      ...(mode === "timeout" ? { timeoutMs: 1500 } : { signal: controller.signal }),
    });
    try {
      await vi.waitFor(() => expect(fs.existsSync(pidFile)).toBe(true), { timeout: 5000 });
      pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      if (mode === "signal") controller.abort();
      const result = await Promise.race([
        running,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Codex cleanup hung on descendant-held pipes")), 4000);
        }),
      ]);
      expect(result.status).toBe("failed");
      expect(result.data.error).toMatch(
        mode === "timeout" ? /timed out/ : mode === "signal" ? /aborted/ : /without a result/,
      );
      // Linux may retain a reparented zombie until init reaps it. A zombie has
      // stopped executing and closed its pipes, so it is not a leaked process.
      await vi.waitFor(() => {
        let alive = true;
        try {
          process.kill(pids!.descendant, 0);
          if (process.platform === "linux") {
            alive = !/\) Z /.test(fs.readFileSync(`/proc/${pids!.descendant}/stat`, "utf8"));
          }
        } catch {
          alive = false;
        }
        expect(alive, "the descendant must be terminated").toBe(false);
      });
    } finally {
      if (deadline) clearTimeout(deadline);
      controller.abort();
      // Also clean up the deliberately failing regression on the old code.
      if (!pids && fs.existsSync(pidFile)) pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      for (const pid of pids ? [pids.parent, pids.descendant] : []) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already stopped */
        }
      }
      await running;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
