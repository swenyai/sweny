/**
 * PiHarness specifics beyond the shared contract suite (#415): the argv and
 * config it builds, strict refusal, process lifecycle, usage mapping, the tool
 * bridge end to end, and preflight. Every test drives the scripted fake `pi`
 * process (fakes/pi-fake.mjs); nothing calls a model.
 */
import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createPiProcessFake } from "./__contract__/fakes.js";
import { createRecordingWrapper } from "./__contract__/sandbox.js";
import {
  PiHarness,
  PI_BRIDGE_SERVER,
  bridgeToolNames,
  mapStats,
  piBackendHosts,
  piMcpServers,
  piMcpToolName,
  translateDenyNames,
  type PiHarnessOptions,
} from "./pi.js";
import { PI_CAPABILITIES } from "./capabilities.js";
import { createHarness } from "./index.js";
import { nativeDenyClasses } from "./policy.js";
import type { Tool } from "../types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(here, "../../dist/cli/main.js");
const haveDist = fs.existsSync(distCli);

// These tests spawn the fake pi (and, for the bridge, the real shim); give a loaded CI runner room.
vi.setConfig({ testTimeout: 60_000 });

const fakes = createPiProcessFake();
afterAll(() => fakes.destroy());
afterEach(async () => {
  vi.unstubAllEnvs();
  await fakes.dispose();
});

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function harness(over: Partial<PiHarnessOptions> = {}) {
  fakes.reset();
  const log = logger();
  const h = new PiHarness({
    logger: log,
    envScope: true,
    sandbox: "off",
    policy: "warn",
    piCommand: fakes.command,
    cwd: fakes.projectDir,
    abortGraceMs: 500,
    killGraceMs: 500,
    sandboxWrapper: null,
    ...over,
  });
  return { h, log };
}

const DONE = [{ kind: "final" as const, text: "done" }];

const lookup: Tool = {
  name: "lookup",
  description: "Look something up.",
  input_schema: { type: "object", properties: { q: { type: "string" } } },
  handler: async (input) => ({ found: (input as { q: string }).q }),
};

describe("PiHarness capabilities", () => {
  it("declares what the docs and the adapter say, and denies exactly the classes it can", () => {
    expect(PI_CAPABILITIES.sandbox).toEqual({ fs: false, network: false });
    expect(PI_CAPABILITIES.structuredOutput).toBe("prompt");
    expect(PI_CAPABILITIES.turnLimit).toBe("watchdog");
    expect(PI_CAPABILITIES.cancel).toBe("rpc");
    // pi has no built-in network tool, so net is not deniable as a class.
    expect(nativeDenyClasses(PI_CAPABILITIES)).toEqual(["shell", "write", "edit", "subagent"]);
  });

  it("createHarness builds it", () => {
    expect(createHarness("pi", { logger: logger() })).toBeInstanceOf(PiHarness);
  });
});

describe("PiHarness argv", () => {
  it("runs pi --mode rpc, isolated from the operator's and the project's setup, prompt over RPC", async () => {
    const { h } = harness({ model: "openrouter/some-model:high" });
    fakes.script(DONE);
    const r = await h.run({ instruction: "Do the thing.", context: {}, tools: [] });
    expect(r.status).toBe("success");
    expect(r.harness).toEqual({ id: "pi", version: "0.99.2" });
    const cap = fakes.raw().at(-1)!;
    expect(cap.args).toEqual(
      expect.arrayContaining([
        "--mode",
        "rpc",
        "--no-session",
        "--no-context-files",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-approve",
        "--no-extensions",
        "--model",
        "openrouter/some-model:high",
      ]),
    );
    // Nothing needs MCP here, so the MCP extension is not loaded either.
    expect(cap.extensions).toEqual([]);
    expect(cap.systemPrompt).toMatch(/step in an automated workflow/);
    // The prompt is an RPC command, never argv (argv is visible to every process).
    expect(cap.prompt).toContain("Do the thing.");
    expect(cap.args.join(" ")).not.toContain("Do the thing.");
    // The project's own .pi/mcp.json never loads, and neither does the operator's.
    expect(cap.mcpServersLoaded).toEqual([]);
  });

  it("a per-run model wins over the harness model, and pi's own model is used when neither is set", async () => {
    const { h } = harness({ model: "a/one" });
    fakes.script(DONE);
    await h.run({ instruction: "x", context: {}, tools: [], model: "b/two" });
    expect(fakes.raw().at(-1)!.model).toBe("b/two");
    fakes.reset();
    const bare = harness().h;
    fakes.script(DONE);
    await bare.run({ instruction: "x", context: {}, tools: [] });
    expect(fakes.raw().at(-1)!.args).not.toContain("--model");
  });

  it("sets pi's process variables, scopes the env, and keeps provider keys only by name", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("UNRELATED_SECRET", "nope");
    const { h } = harness();
    fakes.script(DONE);
    await h.run({ instruction: "x", context: {}, tools: [] });
    const env = fakes.raw().at(-1)!.env;
    expect(env.OPENROUTER_API_KEY).toBe("or-key");
    expect(env.UNRELATED_SECRET).toBeUndefined();
    expect(env.PI_OFFLINE).toBe("1");
    expect(env.PI_SKIP_VERSION_CHECK).toBe("1");
    expect(env.PI_TELEMETRY).toBe("0");
    // A scratch agent dir, never the operator's own.
    expect(env.PI_CODING_AGENT_DIR).toBeTruthy();
    expect(env.PI_CODING_AGENT_DIR).not.toContain(fakes.ambientHome);
  });

  it("copies a models.json into the scratch agent dir and nothing else from the operator's setup", async () => {
    const dir = fs.mkdtempSync(path.join(fakes.projectDir, "models-"));
    const modelsFile = path.join(dir, "models.json");
    fs.writeFileSync(modelsFile, JSON.stringify({ providers: {} }));
    const { h } = harness({ modelsFile });
    fakes.script(DONE);
    await h.run({ instruction: "x", context: {}, tools: [] });
    expect(fakes.raw().at(-1)!.agentDirFiles).toEqual(["models.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("every injected MCP server is declared directly, and the agent dir holds only the generated mcp.json", async () => {
    const { h } = harness();
    fakes.script(DONE);
    await h.run({
      instruction: "x",
      context: {},
      tools: [],
      mcpServers: {
        docs: { type: "http", url: "https://example.test/mcp", headers: { "X-Key": "k" } },
        local: { type: "stdio", command: "local-server", args: ["--flag"], env: { A: "1" } },
      },
    });
    const cap = fakes.raw().at(-1)!;
    expect(cap.extensions).toEqual(["builtin:mcp"]);
    expect(cap.agentDirFiles).toEqual(["mcp.json"]);
    expect(cap.mcpServersLoaded.sort()).toEqual(["docs", "local"]);
    expect(cap.mcpConfig).toMatchObject({
      docs: { url: "https://example.test/mcp", headers: { "X-Key": "k" }, exposure: "direct" },
      local: { command: "local-server", args: ["--flag"], env: { A: "1" }, exposure: "direct" },
    });
  });

  it("refuses to write MCP config values that use pi's own command or variable syntax, and says so", async () => {
    const { h, log } = harness();
    fakes.script(DONE);
    const r = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      mcpServers: {
        bad: { type: "stdio", command: "srv", env: { K: "!cat /etc/passwd" } },
        bad2: { type: "http", url: "https://example.test/mcp", headers: { Authorization: "Bearer ${SECRET}" } },
        ok: { type: "stdio", command: "ok-server" },
      },
    });
    expect(fakes.raw().at(-1)!.mcpServersLoaded).toEqual(["ok"]);
    expect(r.degraded.some((d) => d.startsWith("mcp: pi cannot load bad (value uses pi config syntax)"))).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe("PiHarness tool policy", () => {
  it("a dry run is an allowlist: reading tools plus sweny's own, no external MCP server", async () => {
    const { h } = harness();
    fakes.script(DONE);
    await h.run({
      instruction: "x",
      context: {},
      tools: [lookup],
      readOnly: true,
      mcpServers: { injected: { type: "stdio", command: "injected-server" } },
    });
    const cap = fakes.raw().at(-1)!;
    expect(cap.toolsAllow).toEqual(["read", "grep", "find", "ls", "mcp__sweny_core__lookup"]);
    expect(cap.activeTools).toEqual(cap.toolsAllow);
    expect(cap.mcpServersLoaded).toEqual([PI_BRIDGE_SERVER]);
  });

  it("a normal run denies built-ins by name and keeps every MCP tool", async () => {
    const { h } = harness();
    fakes.script(DONE);
    await h.run({
      instruction: "x",
      context: {},
      tools: [],
      policy: { readOnly: false, deny: ["shell", "edit"], egress: [], strict: false },
    });
    const cap = fakes.raw().at(-1)!;
    expect(cap.toolsAllow).toBeUndefined();
    expect(cap.toolsExclude.sort()).toEqual(["bash", "edit", "powershell"]);
    expect(cap.activeTools.sort()).toEqual(["read", "write"]);
  });

  it("translates disallowed_tools: Claude and pi names become classes and tools, unknown names are degraded", async () => {
    expect(
      translateDenyNames(["Bash", "Read", "Glob", "write", "NotebookEdit", "Task", "WebFetch", "Frobnicate"]),
    ).toEqual({
      classes: ["shell", "write", "subagent", "net"],
      piTools: ["read", "find"],
      unknown: ["Frobnicate"],
    });
    const { h } = harness();
    fakes.script(DONE);
    const r = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      disallowedTools: ["Bash", "Read", "Frobnicate"],
    });
    const cap = fakes.raw().at(-1)!;
    expect(cap.toolsExclude.sort()).toEqual(["bash", "powershell", "read"]);
    expect(r.degraded.some((d) => d.startsWith("disallowed_tools [Frobnicate]"))).toBe(true);
    // net has no tool in pi: a denied WebFetch is reported, not assumed.
    fakes.script(DONE);
    const net = await h.run({ instruction: "x", context: {}, tools: [], disallowedTools: ["WebFetch"] });
    expect(net.degraded.some((d) => d.startsWith("deny [net]"))).toBe(true);
  });

  it("the watchdog stops a run over its tool-call budget, and keeps partial text for fail_soft", async () => {
    const { h } = harness();
    fakes.script([
      { kind: "tool-call", id: "a", name: "lookup", input: {} },
      { kind: "tool-call", id: "b", name: "lookup", input: {} },
      { kind: "final", text: "done" },
    ]);
    const r = await h.run({ instruction: "x", context: {}, tools: [], maxTurns: 1 });
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/max_turns \(1 tool calls; stopped by the sweny watchdog\)/);
    expect(r.degraded.some((d) => d.startsWith("max_turns"))).toBe(true);
  });
});

describe("PiHarness strict sandbox", () => {
  it("harness policy strict with the sandbox on and no wrapper refuses before pi starts, naming the sandbox", async () => {
    const { h } = harness({ policy: "strict", sandbox: "auto" });
    fakes.script(DONE);
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(r.data.refused).toBe(true);
    expect(String(r.data.error)).toMatch(/pi refused this node: strict policy: sandbox:/);
    expect(fakes.raw()).toHaveLength(0);
  });

  it("with the wrapper, the same node runs, and pi's agent dir lives in the wrapper's scratch HOME", async () => {
    const rec = createRecordingWrapper();
    const { h } = harness({ policy: "strict", sandbox: "auto", sandboxWrapper: rec });
    fakes.script(DONE);
    const r = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      agentAccess: { envVars: [], domains: ["x.test"] },
    });
    expect(r.status).toBe("success");
    expect(r.degraded.filter((d) => /sandbox|egress/.test(d))).toEqual([]);
    const cap = fakes.raw().at(-1)!;
    expect(cap.env.PI_CODING_AGENT_DIR.startsWith(rec.requests[0].cwd)).toBe(true);
    expect(rec.requests[0].egress).toContain("x.test");
    // Gone after the run.
    expect(fs.existsSync(cap.env.PI_CODING_AGENT_DIR)).toBe(false);
  });

  it("the model's API host is allowed through the wrapper", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    const rec = createRecordingWrapper();
    const { h } = harness({ sandbox: "auto", sandboxWrapper: rec, model: "openrouter/m" });
    fakes.script(DONE);
    await h.run({ instruction: "x", context: {}, tools: [] });
    expect(rec.requests[0].egress).toEqual(expect.arrayContaining(["api.openai.com", "openrouter.ai"]));
  });

  it("piBackendHosts reads the provider keys and the model prefix", () => {
    expect(piBackendHosts({ ANTHROPIC_API_KEY: "k" })).toEqual(["api.anthropic.com"]);
    expect(piBackendHosts({}, "groq/llama")).toEqual(["api.groq.com"]);
    expect(piBackendHosts({}, "sonnet:high")).toEqual([]);
  });
});

describe("PiHarness process lifecycle", () => {
  it("a pi that ignores the abort command is killed after the grace period", async () => {
    const { h } = harness({ abortGraceMs: 200, killGraceMs: 200 });
    fakes.scriptWith([{ kind: "hang" }], { ignoreAbort: true });
    const t0 = Date.now();
    const r = await h.run({ instruction: "x", context: {}, tools: [], timeoutMs: 100 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/timed out after 100ms/);
    expect(fakes.captured().stopped).toBe(true);
    expect(fakes.leftovers()).toEqual([]);
  });

  it("a prompt pi consumed as a command is a failure, not a success with no output", async () => {
    const { h } = harness();
    fakes.scriptWith([], { disposition: "handled" });
    const r = await h.run({ instruction: "/mcp", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(String(r.data.error)).toMatch(/handled the prompt as a command/);
    expect(fakes.captured().stopped).toBe(true);
  });

  it("complete() fails closed when the model tries to call a tool", async () => {
    const { h, log } = harness();
    fakes.script([
      { kind: "tool-call", id: "a", name: "bash", input: {} },
      { kind: "final", text: "x" },
    ]);
    expect(await h.complete({ prompt: "p", purpose: "evaluate" })).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/pi\.evaluate: the model tried to call a tool/));
    expect(fakes.captured().stopped).toBe(true);
  });
});

describe("PiHarness usage", () => {
  it("maps tokens and cost from get_session_stats, and reports no cost for an unpriced model", () => {
    expect(mapStats({ tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 1, total: 19 }, cost: 0.02 })).toEqual({
      costUsd: 0.02,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheCreationTokens: 1,
    });
    expect(mapStats({ tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, cost: 0 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(mapStats({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 })).toBeUndefined();
    expect(mapStats(undefined)).toBeUndefined();
  });

  it("a failed run still carries the usage pi reported", async () => {
    const { h } = harness();
    fakes.script([
      { kind: "final", text: "boom", ok: false, usage: { inputTokens: 7, outputTokens: 2, costUsd: 0.1 } },
    ]);
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(r.usage).toEqual({ costUsd: 0.1, inputTokens: 7, outputTokens: 2 });
  });
});

describe("pi MCP names and config", () => {
  it("names tools the way pi registers them, shortening with a hash when too long", () => {
    expect(piMcpToolName("sweny-core", "lookup")).toBe("mcp__sweny_core__lookup");
    expect(piMcpToolName("sweny-core", "a-b")).toBe("mcp__sweny_core__a_b");
    const long = piMcpToolName("sweny-core", "x".repeat(80));
    expect(long).toHaveLength(64);
    expect(long).toMatch(/_[0-9a-f]{8}$/);
    const { names, back } = bridgeToolNames([lookup, { ...lookup, name: "get-thing" }]);
    expect(names).toEqual(["mcp__sweny_core__lookup", "mcp__sweny_core__get_thing"]);
    expect(back.get("mcp__sweny_core__get_thing")).toBe("get-thing");
  });

  it("skips servers whose name pi rejects or whose namespace clashes with the bridge", () => {
    const { entries, unsupported } = piMcpServers({
      "bad name": { type: "stdio", command: "a" },
      sweny_core: { type: "stdio", command: "b" },
      fine: { type: "stdio", command: "c" },
      "a-b": { type: "stdio", command: "d" },
      a_b: { type: "stdio", command: "e" },
    });
    expect(Object.keys(entries)).toEqual(["fine", "a-b"]);
    expect(unsupported).toHaveLength(3);
  });
});

describe("PiHarness preflight", () => {
  it("accepts the minimum version and records it", async () => {
    const { h } = harness();
    expect(await h.preflight()).toEqual({ ok: true, version: "0.99.2" });
  });

  it("refuses a pi older than the one the adapter was written against", async () => {
    const { h } = harness();
    fakes.setVersion("0.50.0");
    const pre = await h.preflight();
    expect(pre.ok).toBe(false);
    expect(pre.ok === false && pre.reason).toMatch(/pi 0.50.0 is too old; sweny needs >= 0.99.2/);
    // And a run fails with that reason instead of starting pi.
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(fakes.raw()).toHaveLength(0);
  });

  it("names the install command when pi is missing", async () => {
    const { h } = harness({ piCommand: { command: path.join(fakes.ambientHome, "no-such-pi"), args: [] } });
    const pre = await h.preflight();
    expect(pre.ok).toBe(false);
    expect(pre.ok === false && pre.reason).toMatch(
      /pi CLI not found .*npm install -g @earendil-works\/pi-coding-agent/,
    );
  });
});

// ─── The tool bridge, end to end ─────────────────────────────────

describe.skipIf(!haveDist)("PiHarness skill tools over the tool bridge (needs the core build)", () => {
  const shim = { command: process.execPath, args: [distCli, "tool-bridge"] };

  it("pi's MCP client lists and calls sweny skill tools; the token never touches argv or a file", async () => {
    const calls: unknown[] = [];
    const tool: Tool = {
      ...lookup,
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
    const r = await h.run({ instruction: "x", context: {}, tools: [tool] });
    expect(r.status).toBe("success");
    const cap = fakes.raw().at(-1)!;
    expect(cap.mcpTools).toEqual({ [PI_BRIDGE_SERVER]: ["mcp__sweny_core__lookup"] });
    expect(calls).toEqual([{ q: "a" }]);
    // pi reports the tool as mcp__sweny_core__lookup; the trace keeps sweny's name.
    expect(r.toolCalls).toEqual([{ tool: "lookup", input: { q: "a" }, status: "success", output: { found: "a" } }]);
    const token = cap.env.SWENY_TOOL_BRIDGE_TOKEN;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(cap.args.join(" ")).not.toContain(token);
    expect(JSON.stringify(cap.mcpConfig)).not.toContain(token);
    expect((cap.mcpConfig[PI_BRIDGE_SERVER] as { env: Record<string, string> }).env.SWENY_TOOL_BRIDGE_TOKEN).toBe(
      "${SWENY_TOOL_BRIDGE_TOKEN}",
    );
    expect(fakes.leftovers()).toEqual([]);
  });
});
