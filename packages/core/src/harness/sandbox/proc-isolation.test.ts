/**
 * /proc isolation (#599): can an agent read the env of the process that started
 * it? sweny holds skill credentials (GITHUB_TOKEN, LINEAR_API_KEY, ...) in its
 * own env and withholds them from the agent's env, but on Linux any process of
 * the same user can read another's exec-time env through /proc/<pid>/environ.
 * Only a PID namespace (the sandbox) closes that.
 *
 * Each case starts proc-parent.mjs with a canary in its exec-time env, the way
 * sweny starts with skill credentials, and has it start one agent as its child
 * with the canary withheld from the agent's env. The agent (fake-agent.mjs,
 * `procParent`) then tries /proc/<parent pid>/environ, every ancestor up the
 * PPid chain, and a scan of every /proc entry.
 *
 * - Unsandboxed, the read is expected to succeed: that is the risk, asserted so
 *   the sandboxed cases cannot pass on a probe that never works.
 * - srt wrapper path (Codex, pi, ACP): the agent spawn prepareAgentSpawn
 *   returns, strict mode. The read must fail.
 * - Claude SDK sandbox path: sweny's own ClaudeCodeHarness (built dist) runs one
 *   node against a local fake model that asks for one Bash command, the probe.
 *   Sandbox off: the read succeeds; strict: it must fail. The same for the Read
 *   tool on /proc/<parent pid>/environ: the file tools run in the Claude Code
 *   process, outside Bash's PID namespace, so strict must refuse /proc to them.
 * - The CLI entry end to end: `sweny workflow run` with only the Action's
 *   SWENY_SANDBOX_DEFAULT=strict (no mode passed in) in a workspace whose
 *   .sweny.yml and .env both set the sandbox off. In CI they are refused and
 *   the agent's Bash runs sandboxed.
 *
 * Linux only. Skips when the host cannot sandbox, except under
 * SWENY_REQUIRE_SANDBOX_WRAPPER=1 (the `sandbox-wrapper` CI job), where a
 * missing wrapper, sandbox or dist build fails the suite. Every case logs one
 * `PROC RESULT` line with what each path could and could not read.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAgentEnv, checkSandboxSupport } from "../../agent-env.js";
import { detectSandboxWrapper, prepareAgentSpawn, type AgentSpawn } from "../sandbox-wrapper.js";
import type { HarnessCapabilities, NodePolicy } from "../types.js";

const REQUIRED = process.env.SWENY_REQUIRE_SANDBOX_WRAPPER === "1";
const LINUX = process.platform === "linux";
const FAKE_AGENT = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
const PARENT = fileURLToPath(new URL("./proc-parent.mjs", import.meta.url));
const DIST_INDEX = fileURLToPath(new URL("../../../dist/index.js", import.meta.url));
const DIST_CLI = fileURLToPath(new URL("../../../dist/cli/main.js", import.meta.url));
const CANARY_NAME = "SWENY_PROC_PARENT_SECRET";
const CANARY_VALUE = `proc-canary-${process.pid}-${Date.now()}`;

const NO_NATIVE_SANDBOX: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "skill-only",
  builtinDeny: "none",
  mcp: { inject: true, exclusive: "none" },
  sandbox: { fs: false, network: false },
  readOnly: "none",
  turnLimit: "watchdog",
  usage: { tokens: false, costUsd: false, live: false },
  cancel: "kill",
  resume: false,
};

interface Environ {
  pid: number;
  readable: boolean;
  found: boolean;
  error?: string;
}

interface ProcParentResult {
  pid: number;
  pidNs: string | null;
  self: boolean;
  target: Environ;
  ancestors: Environ[];
  scan: { found: boolean; scanned: number };
}

const PLAN = JSON.stringify([{ kind: "procParent", pid: "__PARENT_PID__", needle: CANARY_VALUE }]);

/** Did the agent get the parent's secret by any /proc route? */
function leaked(r: ProcParentResult): boolean {
  return r.target.found || r.ancestors.some((a) => a.found) || r.scan.found;
}

function summary(label: string, r: ProcParentResult): string {
  const anc = r.ancestors.map((a) => `${a.pid}:${a.readable ? (a.found ? "LEAK" : "read") : (a.error ?? "denied")}`);
  return (
    `PROC RESULT ${label}: leaked=${leaked(r)} self=${r.self} pidNs=${r.pidNs} ` +
    `target(${r.target.pid})=${r.target.readable ? (r.target.found ? "LEAK" : "read, no canary") : `unreadable (${r.target.error})`} ` +
    `ancestors=[${anc.join(" ")}] scan=${r.scan.found ? "LEAK" : "clean"}/${r.scan.scanned}`
  );
}

function parseProbe(text: string): ProcParentResult {
  const line = text
    .split("\n")
    .reverse()
    .find((l) => l.trim().startsWith("["));
  if (!line) throw new Error(`the probe printed no results:\n${text}`);
  return (JSON.parse(line.trim()) as ProcParentResult[])[0];
}

/** Start proc-parent.mjs with the canary in its exec-time env. */
function runParent(
  cfg: Record<string, unknown>,
  env: Record<string, string>,
  onSpawn?: (pid: number) => void,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PARENT, JSON.stringify(cfg)], {
      env: { ...env, [CANARY_NAME]: CANARY_VALUE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) onSpawn?.(child.pid);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "TMPDIR", "LANG"]) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}

// ─── srt wrapper path ────────────────────────────────────────────

const root = await mkdtemp(path.join(tmpdir(), "sweny-proc-"));
const workspace = path.join(root, "workspace");
await mkdir(workspace, { recursive: true });

const detection = LINUX ? await detectSandboxWrapper() : { wrapper: undefined, reason: "not Linux" };
const wrapper = detection.wrapper;

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The agent's env as an adapter hands it over: scoped, so the canary is not in it. */
function agentEnv(): Record<string, string> {
  return buildAgentEnv({ ...process.env, [CANARY_NAME]: CANARY_VALUE });
}

async function srtAgent(wrapped: boolean): Promise<ProcParentResult> {
  let s: AgentSpawn = { command: process.execPath, args: [FAKE_AGENT, PLAN], env: agentEnv(), cwd: workspace };
  let cleanup = async () => {};
  if (wrapped) {
    const policy: NodePolicy = { readOnly: false, deny: [], egress: [], strict: false, sandbox: "strict" };
    const prep = await prepareAgentSpawn({ caps: NO_NATIVE_SANDBOX, policy, wrapper, env: {}, spawn: s });
    expect(prep.refuse).toBeUndefined();
    expect(prep.wrappedBy).toBe("srt");
    s = prep.spawn;
    cleanup = prep.cleanup;
  }
  expect(s.env[CANARY_NAME], "the parent withholds the canary from the agent's env").toBeUndefined();
  try {
    const r = await runParent({ kind: "spawn", spawn: s }, baseEnv());
    return parseProbe(r.stdout + "\n" + r.stderr);
  } finally {
    await cleanup();
  }
}

if (LINUX && !wrapper && REQUIRED) {
  describe("/proc isolation, srt wrapper (required)", () => {
    it("a working wrapper is available on this host", () => {
      throw new Error(`SWENY_REQUIRE_SANDBOX_WRAPPER=1 but no wrapper: ${detection.reason}`);
    });
  });
}

describe.skipIf(!LINUX || !wrapper)("/proc isolation, srt wrapper path", () => {
  it("unsandboxed: the agent reads its parent's env through /proc (the risk)", async () => {
    const r = await srtAgent(false);
    console.log(summary("srt path, unsandboxed", r));
    expect(r.self).toBe(false);
    expect(r.target.found, "unsandboxed, /proc/<parent>/environ holds the canary").toBe(true);
  }, 60_000);

  it("strict: the wrapped agent cannot read its parent's env by any /proc route", async () => {
    const r = await srtAgent(true);
    console.log(summary("srt path, strict", r));
    expect(r.self).toBe(false);
    expect(r.target.found).toBe(false);
    expect(r.ancestors.filter((a) => a.found)).toEqual([]);
    expect(r.scan.found).toBe(false);
  }, 60_000);
});

// ─── Claude SDK sandbox path ─────────────────────────────────────

const TOOL_ID = "toolu_sweny_proc_probe";

/** One tool call the fake model asks for. */
interface ToolCall {
  name: "Bash" | "Read";
  input: Record<string, unknown>;
}

interface ToolResult {
  text: string;
  isError: boolean;
}

interface FakeModel {
  url: string;
  /** Results of the probe tool call the model received, in order. */
  toolResults: ToolResult[];
  /** The call to ask for, set once the parent's pid is known. */
  call?: ToolCall;
  close(): Promise<void>;
}

function sse(res: http.ServerResponse, events: Array<Record<string, unknown>>): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function reply(res: http.ServerResponse, stream: boolean, model: string, block: Record<string, unknown>): void {
  const stop = block.type === "tool_use" ? "tool_use" : "end_turn";
  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model,
    content: [block],
    stop_reason: stop,
    stop_sequence: null,
    usage: USAGE,
  };
  if (!stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(message));
    return;
  }
  const start = block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" };
  const delta =
    block.type === "tool_use"
      ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      : { type: "text_delta", text: block.text };
  sse(res, [
    { type: "message_start", message: { ...message, content: [], stop_reason: null } },
    { type: "content_block_start", index: 0, content_block: start },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ]);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("\n");
  }
  return "";
}

/**
 * A model that asks for one tool call (the probe), records its result, then
 * ends the turn. Any request that does not offer that tool (Claude Code's side
 * calls) gets a plain "ok".
 */
async function startFakeModel(): Promise<FakeModel> {
  const fake: FakeModel = { url: "", toolResults: [], close: async () => {} };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v1/messages/count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      if (req.method !== "POST" || !url.startsWith("/v1/messages")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: url } }));
        return;
      }
      let body: {
        model?: string;
        stream?: boolean;
        tools?: Array<{ name?: string }>;
        messages?: Array<{ content?: unknown }>;
      } = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // fall through with an empty body
      }
      const model = body.model ?? "claude-sonnet-4-5";
      const stream = body.stream === true;
      let result: ToolResult | undefined;
      for (const m of body.messages ?? []) {
        if (!Array.isArray(m.content)) continue;
        for (const c of m.content as Array<Record<string, unknown>>) {
          if (c?.type === "tool_result" && c.tool_use_id === TOOL_ID) {
            result = { text: textOf(c.content), isError: c.is_error === true };
          }
        }
      }
      const call = fake.call;
      if (result !== undefined) {
        fake.toolResults.push(result);
        reply(res, stream, model, { type: "text", text: "done" });
      } else if (call && (body.tools ?? []).some((t) => t?.name === call.name)) {
        reply(res, stream, model, { type: "tool_use", id: TOOL_ID, name: call.name, input: call.input });
      } else {
        reply(res, stream, model, { type: "text", text: "ok" });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The Bash call that runs the probe against the parent `pid`. */
function bashProbe(pid: number): ToolCall {
  const plan = PLAN.split("__PARENT_PID__").join(String(pid));
  return {
    name: "Bash",
    input: { command: `${shq(process.execPath)} ${shq(FAKE_AGENT)} ${shq(plan)}`, description: "sweny /proc probe" },
  };
}

/** The Read call on the parent's environ: the file tools run outside Bash's PID namespace. */
function readProbe(pid: number): ToolCall {
  return { name: "Read", input: { file_path: `/proc/${pid}/environ` } };
}

const claudeSandboxReason = LINUX ? checkSandboxSupport() : "not Linux";
const claudeReady = LINUX && existsSync(DIST_INDEX) && existsSync(DIST_CLI) && !claudeSandboxReason;

if (LINUX && REQUIRED && !claudeReady) {
  describe("/proc isolation, Claude SDK sandbox (required)", () => {
    it("the Claude Code sandbox and the built dist are available on this host", () => {
      throw new Error(
        `SWENY_REQUIRE_SANDBOX_WRAPPER=1 but: ${existsSync(DIST_INDEX) ? "" : `no ${DIST_INDEX} (build core first); `}` +
          `${claudeSandboxReason ?? ""}`,
      );
    });
  });
}

describe.skipIf(!claudeReady)("/proc isolation, Claude SDK sandbox path", () => {
  let fake: FakeModel;
  let home: string;

  beforeAll(async () => {
    fake = await startFakeModel();
    home = await mkdtemp(path.join(root, "home-"));
  });

  afterAll(async () => {
    await fake?.close();
  });

  function modelEnv(): Record<string, string> {
    return {
      ...baseEnv(),
      HOME: home,
      CI: "true",
      ANTHROPIC_BASE_URL: fake.url,
      ANTHROPIC_API_KEY: "sk-ant-sweny-proc-isolation-fake",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
    };
  }

  function lastResult(what: string, detail: string): ToolResult {
    if (fake.toolResults.length === 0) throw new Error(`the agent never returned the ${what} result.\n${detail}`);
    return fake.toolResults[fake.toolResults.length - 1];
  }

  /** One node on sweny's ClaudeCodeHarness, started by a parent that holds the canary. */
  async function claudeAgent(
    sandbox: "off" | "strict",
    callFor: (pid: number) => ToolCall,
  ): Promise<{ result: ToolResult; contained: unknown }> {
    fake.toolResults = [];
    fake.call = undefined;
    const r = await runParent({ kind: "claude", dist: DIST_INDEX, cwd: workspace, sandbox }, modelEnv(), (pid) => {
      fake.call = callFor(pid);
    });
    const line = r.stdout.split("\n").find((l) => l.startsWith("PARENT_RESULT "));
    const parent = line ? JSON.parse(line.slice("PARENT_RESULT ".length)) : undefined;
    const called = fake.call as ToolCall | undefined;
    const result = lastResult(
      called?.name ?? "tool",
      `parent: ${JSON.stringify(parent)}\nstderr: ${r.stderr.slice(-4000)}`,
    );
    return { result, contained: parent?.contained };
  }

  it("sandbox off: the agent's Bash reads sweny's env through /proc (the risk)", async () => {
    const { result, contained } = await claudeAgent("off", bashProbe);
    const probe = parseProbe(result.text);
    console.log(summary("Claude SDK path, off", probe));
    expect(contained).toBe(false);
    expect(probe.self).toBe(false);
    expect(leaked(probe), "unsandboxed, an ancestor's environ holds the canary").toBe(true);
    expect(probe.target.found).toBe(true);
  }, 180_000);

  it("strict: the sandboxed Bash cannot read sweny's env by any /proc route", async () => {
    const { result, contained } = await claudeAgent("strict", bashProbe);
    const probe = parseProbe(result.text);
    console.log(summary("Claude SDK path, strict", probe));
    expect(contained).toBe(true);
    expect(probe.self).toBe(false);
    expect(probe.target.found).toBe(false);
    expect(probe.ancestors.filter((a) => a.found)).toEqual([]);
    expect(probe.scan.found).toBe(false);
  }, 180_000);

  it("sandbox off: the Read tool reads sweny's env from /proc/<pid>/environ (the risk)", async () => {
    const { result, contained } = await claudeAgent("off", readProbe);
    console.log(
      `PROC RESULT Claude Read tool, off: isError=${result.isError} leaked=${result.text.includes(CANARY_VALUE)}`,
    );
    expect(contained).toBe(false);
    expect(result.text).toContain(CANARY_VALUE);
  }, 180_000);

  it("strict: the Read tool is refused /proc, so it cannot read sweny's env (#599)", async () => {
    const { result, contained } = await claudeAgent("strict", readProbe);
    console.log(
      `PROC RESULT Claude Read tool, strict: isError=${result.isError} leaked=${result.text.includes(CANARY_VALUE)} ` +
        `result=${JSON.stringify(result.text.slice(0, 200))}`,
    );
    expect(contained).toBe(true);
    expect(result.text).not.toContain(CANARY_VALUE);
    expect(result.isError).toBe(true);
  }, 180_000);

  // #599 end to end: the CLI entry, with nothing but the Action's env default
  // (SWENY_SANDBOX_DEFAULT=strict, no SWENY_SANDBOX, no mode passed in), and a
  // workspace whose .sweny.yml and .env both try to turn the sandbox off.
  it("the CLI under the Action's default sandboxes the agent; .sweny.yml and .env cannot turn it off in CI", async () => {
    fake.toolResults = [];
    fake.call = undefined;
    const ws = await mkdtemp(path.join(root, "cli-ws-"));
    await writeFile(
      path.join(ws, "wf.yml"),
      [
        "id: proc-probe",
        "name: proc probe",
        "description: d",
        "entry: probe",
        "permissions: write",
        "nodes:",
        "  probe:",
        "    name: Probe",
        "    instruction: Run the probe command with Bash.",
        "edges: []",
        "",
      ].join("\n"),
    );
    await writeFile(path.join(ws, ".sweny.yml"), "sandbox: off\n");
    await writeFile(path.join(ws, ".env"), "SWENY_SANDBOX=off\n");
    const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [DIST_CLI, "workflow", "run", "wf.yml"], {
        cwd: ws,
        env: { ...modelEnv(), NO_COLOR: "1", SWENY_SANDBOX_DEFAULT: "strict", [CANARY_NAME]: CANARY_VALUE },
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (child.pid) fake.call = bashProbe(child.pid);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
    const out = r.stdout + r.stderr;
    const probe = parseProbe(lastResult("Bash", `exit ${r.code}\n${out.slice(-4000)}`).text);
    console.log(summary("CLI, Action default, repo files say off", probe));
    expect(out).toContain(".env sets SWENY_SANDBOX, which would lower the agent sandbox from strict to off");
    expect(out).toContain(".sweny.yml sets SWENY_SANDBOX, which would lower the agent sandbox from strict to off");
    expect(probe.self).toBe(false);
    expect(leaked(probe)).toBe(false);
    expect(probe.target.readable).toBe(false);
  }, 180_000);
});
