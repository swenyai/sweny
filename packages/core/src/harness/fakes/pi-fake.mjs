#!/usr/bin/env node
/**
 * Scripted stand-in for the `pi` CLI in `--mode rpc` (#415). No model, no network.
 *
 *   node pi-fake.mjs --fake-dir <dir> --mode rpc --no-session ...
 *   node pi-fake.mjs --fake-dir <dir> --version
 *
 * It parses the argv the pi adapter builds the way pi does (badlogic/pi-mono
 * v0.99.2, docs/cli.md: unknown options are rejected, `--tools` is an
 * allowlist over every registered tool, `--exclude-tools` a denylist,
 * `--no-extensions` keeps only explicit `-e` extensions, and MCP servers come
 * from `mcp.json` in `$PI_CODING_AGENT_DIR`, default `~/.pi/agent`, plus a
 * project `.pi/mcp.json` unless `--no-approve`). It records what it received
 * to `<dir>/capture-<n>.json`, then speaks the RPC protocol of docs/rpc.md on
 * stdin and stdout: a `prompt` command starts the script, `abort` stops it,
 * `get_session_stats` returns usage, closing stdin ends the process.
 *
 * Script: an array of neutral steps (harness/__contract__/scenarios.ts), or
 * `{ steps, callMcp, ignoreAbort, disposition }`. With `callMcp` the fake acts
 * as pi's MCP client: it starts every configured stdio server (env resolved
 * the way docs/mcp.md says: `${VAR}` from pi's own env), lists its tools, and
 * turns each `tool-call` step into a real `tools/call`, reporting the tool
 * under pi's registered name `mcp__<server>__<tool>`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const argv = process.argv.slice(2);
const dirIdx = argv.indexOf("--fake-dir");
if (dirIdx === -1) {
  process.stderr.write("pi-fake: --fake-dir is required\n");
  process.exit(2);
}
const dir = argv[dirIdx + 1];
const args = [...argv.slice(0, dirIdx), ...argv.slice(dirIdx + 2)];

if (args.includes("--version") || args.includes("-v")) {
  let version = "0.99.2";
  try {
    version = fs.readFileSync(path.join(dir, "version"), "utf8").trim() || version;
  } catch {
    // default version
  }
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

// ─── argv ────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set([
  "--mode",
  "--model",
  "--provider",
  "--tools",
  "-t",
  "--exclude-tools",
  "-xt",
  "--extension",
  "-e",
  "--append-system-prompt",
  "--system-prompt",
]);
const BOOLEAN_FLAGS = new Set([
  "--no-session",
  "--no-context-files",
  "-nc",
  "--no-skills",
  "-ns",
  "--no-prompt-templates",
  "-np",
  "--no-themes",
  "--no-approve",
  "-na",
  "--no-extensions",
  "-ne",
  "--no-tools",
  "-nt",
  "--no-builtin-tools",
  "-nbt",
  "--offline",
]);
const opts = { flags: new Set(), values: {}, extensions: [], positional: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VALUE_FLAGS.has(a)) {
    const v = args[++i];
    if (v === undefined) {
      process.stderr.write(`pi-fake: ${a} needs a value\n`);
      process.exit(2);
    }
    if (a === "-e" || a === "--extension") opts.extensions.push(v);
    else (opts.values[a] ??= []).push(v);
  } else if (BOOLEAN_FLAGS.has(a)) {
    opts.flags.add(a);
  } else if (a.startsWith("-")) {
    process.stderr.write(`pi-fake: unknown option ${a}\n`);
    process.exit(2);
  } else {
    opts.positional.push(a);
  }
}
const has = (...names) => names.some((n) => opts.flags.has(n));
const value = (...names) => names.flatMap((n) => opts.values[n] ?? []).at(-1);
if (value("--mode") !== "rpc") {
  process.stderr.write(`pi-fake: expected --mode rpc\n`);
  process.exit(2);
}
if (opts.positional.length > 0) {
  process.stderr.write(`pi-fake: rpc mode takes no message arguments: ${JSON.stringify(opts.positional)}\n`);
  process.exit(2);
}
const csv = (v) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const toolsAllow = value("--tools", "-t") !== undefined ? csv(value("--tools", "-t")) : undefined;
const toolsExclude = csv(value("--exclude-tools", "-xt"));

// ─── What pi would load ──────────────────────────────────────────

const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || "", ".pi", "agent");
// Built-in extensions are off with --no-extensions; only explicit -e paths load.
const mcpExtensionLoaded = !has("--no-extensions", "-ne") || opts.extensions.includes("builtin:mcp");
// Anything else an extension could add (subagents, ...): only when extensions are not disabled.
const otherExtensionsLoaded = !has("--no-extensions", "-ne") || opts.extensions.some((e) => e !== "builtin:mcp");

function readMcpConfig(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}
const mcpServers = {};
if (mcpExtensionLoaded) {
  Object.assign(mcpServers, readMcpConfig(path.join(agentDir, "mcp.json")));
  // Project servers load only for a trusted project; --no-approve ignores them.
  if (!has("--no-approve", "-na"))
    Object.assign(mcpServers, readMcpConfig(path.join(process.cwd(), ".pi", "mcp.json")));
}
const mcpServerNames = Object.entries(mcpServers)
  .filter(([, s]) => s.enabled !== false)
  .map(([name]) => name);

const BUILTINS = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"];
const DEFAULT_ACTIVE = ["read", "bash", "edit", "write"];
let activeTools;
if (has("--no-tools", "-nt")) activeTools = [];
else if (toolsAllow) activeTools = toolsAllow.filter((n) => !toolsExclude.includes(n));
else activeTools = (has("--no-builtin-tools", "-nbt") ? [] : DEFAULT_ACTIVE).filter((n) => !toolsExclude.includes(n));

// ─── Script and capture ──────────────────────────────────────────

const n = fs.readdirSync(dir).filter((f) => /^capture-\d+\.json$/.test(f)).length + 1;
let script = [];
for (const name of [`script-${n}.json`, "script.json"]) {
  try {
    script = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    break;
  } catch {
    // try the next one
  }
}
const steps = Array.isArray(script) ? script : (script.steps ?? []);
const callMcp = !Array.isArray(script) && script.callMcp === true;
const ignoreAbort = !Array.isArray(script) && script.ignoreAbort === true;
const disposition = (!Array.isArray(script) && script.disposition) || "started";

let agentDirFiles = [];
try {
  agentDirFiles = fs.readdirSync(agentDir).sort();
} catch {
  // no agent dir
}

const capture = {
  pid: process.pid,
  args,
  env: { ...process.env },
  cwd: process.cwd(),
  prompt: "",
  flags: [...opts.flags],
  model: value("--model"),
  systemPrompt: value("--append-system-prompt"),
  extensions: opts.extensions,
  toolsAllow,
  toolsExclude,
  activeTools,
  builtinTools: BUILTINS,
  agentDir,
  agentDirFiles,
  mcpServersLoaded: mcpServerNames,
  mcpConfig: mcpServers,
  mcpTools: undefined,
  mcpExtensionLoaded,
  otherExtensionsLoaded,
};
const captureFile = path.join(dir, `capture-${n}.json`);
const saveCapture = () => fs.writeFileSync(captureFile, JSON.stringify(capture, null, 2));
saveCapture();

// ─── MCP client (callMcp) ────────────────────────────────────────

const DEFAULT_ENV_VARS = ["HOME", "LOGNAME", "PATH", "SHELL", "USER", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ"];
const mcpClients = new Map();
const piToolName = (server, tool) => `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");

function resolveValue(v) {
  if (typeof v !== "string") return v;
  if (v.startsWith("!")) throw new Error("pi-fake: `!command` values are not supported");
  return v.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name) => process.env[name] ?? "");
}

async function startMcp() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  capture.mcpTools = {};
  for (const name of mcpServerNames) {
    const s = mcpServers[name];
    if (!s.command) continue;
    const env = {};
    for (const k of DEFAULT_ENV_VARS) if (process.env[k] !== undefined) env[k] = process.env[k];
    for (const [k, v] of Object.entries(s.env ?? {})) env[k] = resolveValue(v);
    const client = new Client({ name: "pi-fake", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: s.command, args: s.args ?? [], env, stderr: "ignore" }));
    const listed = await client.listTools();
    capture.mcpTools[name] = listed.tools.map((t) => piToolName(name, t.name));
    mcpClients.set(name, client);
  }
  saveCapture();
}

// ─── RPC out ─────────────────────────────────────────────────────

const emit = (record) =>
  new Promise((resolve) => {
    process.stdout.write(JSON.stringify(record) + "\n", resolve);
  });

let finalUsage;
let aborted = false;
const abortWaiters = [];

function statsData() {
  const u = finalUsage;
  const tokens = {};
  if (u?.inputTokens !== undefined) tokens.input = u.inputTokens;
  if (u?.outputTokens !== undefined) tokens.output = u.outputTokens;
  if (u?.cacheReadTokens !== undefined) tokens.cacheRead = u.cacheReadTokens;
  if (u?.cacheCreationTokens !== undefined) tokens.cacheWrite = u.cacheCreationTokens;
  // pi reports zeros when the provider reported nothing.
  const zeros = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return { tokens: u ? { ...zeros, ...tokens } : zeros, cost: u?.costUsd ?? 0, toolCalls: 0 };
}

let settled = false;
const assistant = (text, stopReason, errorMessage) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "fake",
  provider: "fake",
  model: "fake",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
  stopReason,
  ...(errorMessage ? { errorMessage } : {}),
  timestamp: Date.now(),
});

async function settle(message) {
  if (settled) return;
  settled = true;
  await emit({ type: "message_end", message });
  await emit({ type: "turn_end", message, toolResults: [] });
  await emit({ type: "agent_end", messages: [message], willRetry: false });
  await emit({ type: "agent_settled" });
}

async function play() {
  if (callMcp) await startMcp();
  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  const started = new Map();
  for (const step of steps) {
    if (aborted) return settle(assistant("aborted by the client", "aborted"));
    switch (step.kind) {
      case "tool-call": {
        const client = callMcp ? mcpClients.get("sweny-core") : undefined;
        const toolName = callMcp ? piToolName("sweny-core", step.name) : step.name;
        started.set(step.id, toolName);
        await emit({ type: "tool_execution_start", toolCallId: step.id, toolName, args: step.input ?? {} });
        if (client) {
          const res = await client.callTool({ name: step.name, arguments: step.input ?? {} });
          await emit({
            type: "tool_execution_end",
            toolCallId: step.id,
            toolName,
            result: { content: res.content, details: {} },
            isError: res.isError === true,
          });
        }
        break;
      }
      case "tool-result":
        await emit({
          type: "tool_execution_end",
          toolCallId: step.id,
          toolName: started.get(step.id) ?? "?",
          result: { content: [{ type: "text", text: step.content }], details: {} },
          isError: step.isError === true,
        });
        break;
      case "raw":
        await emit(step.event);
        break;
      case "stderr":
        process.stderr.write(step.text + "\n");
        break;
      case "final":
        finalUsage = step.usage;
        return settle(step.ok === false ? assistant("", "error", step.text) : assistant(step.text, "stop"));
      case "hang":
        if (ignoreAbort) await new Promise(() => setInterval(() => {}, 1 << 30));
        else if (!aborted) await new Promise((resolve) => abortWaiters.push(resolve));
        return settle(assistant("aborted by the client", "aborted"));
      case "crash":
        await new Promise((resolve) => process.stdout.write('{"type":"tool_execution_st', resolve));
        process.stderr.write(step.message + "\n");
        process.exit(1);
        break;
      case "exit":
        process.exit(step.code);
        break;
      default:
        break;
    }
  }
  // The script ended without a result: the stream just stops and pi exits.
  for (const c of mcpClients.values()) await c.close().catch(() => {});
  process.exit(0);
}

async function onCommand(cmd) {
  switch (cmd.type) {
    case "prompt":
      capture.prompt = String(cmd.message ?? "");
      saveCapture();
      await emit({ id: cmd.id, type: "response", command: "prompt", success: true, data: { disposition } });
      if (disposition === "handled") return;
      play().catch((err) => {
        process.stderr.write(`pi-fake: ${err?.stack ?? err}\n`);
        process.exit(1);
      });
      break;
    case "abort":
      if (!ignoreAbort) {
        aborted = true;
        for (const w of abortWaiters) w();
      }
      await emit({ id: cmd.id, type: "response", command: "abort", success: true });
      break;
    case "get_session_stats":
      await emit({ id: cmd.id, type: "response", command: "get_session_stats", success: true, data: statsData() });
      break;
    default:
      await emit({
        id: cmd.id,
        type: "response",
        command: cmd.type,
        success: false,
        error: `unknown command ${cmd.type}`,
      });
  }
}

// Strict JSONL in: split on LF only.
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).replace(/\r$/, "");
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch (err) {
      emit({ type: "response", command: "parse", success: false, error: `Failed to parse command: ${err.message}` });
      continue;
    }
    onCommand(cmd);
  }
});
// Closing stdin is pi's orderly shutdown.
process.stdin.on("end", async () => {
  // A scripted pi that ignores the abort also ignores the shutdown: only a signal stops it.
  if (ignoreAbort) return;
  for (const c of mcpClients.values()) await c.close().catch(() => {});
  process.exit(0);
});
