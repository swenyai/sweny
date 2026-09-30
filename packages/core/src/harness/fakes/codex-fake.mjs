#!/usr/bin/env node
/**
 * Scripted stand-in for the `codex` CLI (#331). No model, no network.
 *
 *   node codex-fake.mjs --fake-dir <dir> exec --json ... -
 *   node codex-fake.mjs --fake-dir <dir> --version
 *
 * It parses the argv the Codex adapter builds the way `codex exec` would
 * (openai/codex rust-v0.159.2, codex-rs/exec/src/cli.rs and
 * codex-rs/utils/cli/src/config_override.rs), records what it received to
 * `<dir>/capture-<n>.json`, then plays `<dir>/script.json` as JSONL on stdout
 * in the `codex exec --json` event schema (codex-rs/exec/src/exec_events.rs).
 *
 * Script: an array of neutral steps (harness/__contract__/scenarios.ts), or
 * `{ steps, callMcp: true }`. With `callMcp` the fake acts as Codex's MCP
 * client: it starts every configured stdio MCP server with the env Codex
 * would give it (a small default set, inline `env`, and the names listed in
 * `env_vars`, per codex-rs/rmcp-client/src/utils.rs), lists its tools, and
 * turns each `tool-call` step into a real `tools/call`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const argv = process.argv.slice(2);
const dirIdx = argv.indexOf("--fake-dir");
if (dirIdx === -1) {
  process.stderr.write("codex-fake: --fake-dir is required\n");
  process.exit(2);
}
const dir = argv[dirIdx + 1];
const args = [...argv.slice(0, dirIdx), ...argv.slice(dirIdx + 2)];

if (args.includes("--version")) {
  let version = "0.159.2";
  try {
    version = fs.readFileSync(path.join(dir, "version"), "utf8").trim() || version;
  } catch {
    // default version
  }
  process.stdout.write(`codex-cli ${version}\n`);
  process.exit(0);
}

// ─── argv ────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set([
  "--color",
  "--cd",
  "-C",
  "--sandbox",
  "-s",
  "--model",
  "-m",
  "--output-schema",
  "-o",
  "-c",
  "--config",
]);
const opts = { overrides: [], flags: new Set(), positional: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VALUE_FLAGS.has(a)) {
    const v = args[++i];
    if (a === "-c" || a === "--config") opts.overrides.push(v);
    else opts[a.replace(/^-+/, "")] = v;
  } else if (a.startsWith("-") && a !== "-") {
    opts.flags.add(a);
  } else {
    opts.positional.push(a);
  }
}
if (opts.positional[0] !== "exec") {
  process.stderr.write(`codex-fake: expected "exec", got ${JSON.stringify(opts.positional)}\n`);
  process.exit(2);
}

// ─── TOML values for -c key=value (strings, numbers, booleans, arrays, inline tables) ─

function parseToml(src) {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      const s = JSON.parse(src.slice(i, j + 1));
      i = j + 1;
      return s;
    }
    if (c === "[") {
      i++;
      const out = [];
      ws();
      if (src[i] === "]") {
        i++;
        return out;
      }
      for (;;) {
        out.push(value());
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "]") {
          i++;
          return out;
        }
        throw new Error(`bad array at ${i} in ${src}`);
      }
    }
    if (c === "{") {
      i++;
      const out = {};
      ws();
      if (src[i] === "}") {
        i++;
        return out;
      }
      for (;;) {
        ws();
        let key;
        if (src[i] === '"') key = value();
        else {
          const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i));
          if (!m) throw new Error(`bad key at ${i} in ${src}`);
          key = m[0];
          i += key.length;
        }
        ws();
        if (src[i] !== "=") throw new Error(`expected = at ${i} in ${src}`);
        i++;
        out[key] = value();
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "}") {
          i++;
          return out;
        }
        throw new Error(`bad table at ${i} in ${src}`);
      }
    }
    const m = /^(true|false|-?\d+(\.\d+)?)/.exec(src.slice(i));
    if (!m) throw new Error(`bad value at ${i} in ${src}`);
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : Number(m[0]);
  };
  const v = value();
  ws();
  if (i !== src.length) throw new Error(`trailing input in ${src}`);
  return v;
}

function splitKey(key) {
  const parts = [];
  let i = 0;
  while (i < key.length) {
    if (key[i] === '"') {
      let j = i + 1;
      while (j < key.length && key[j] !== '"') j += key[j] === "\\" ? 2 : 1;
      parts.push(JSON.parse(key.slice(i, j + 1)));
      i = j + 2;
    } else {
      const j = key.indexOf(".", i);
      parts.push(key.slice(i, j === -1 ? key.length : j));
      i = j === -1 ? key.length : j + 1;
    }
  }
  return parts;
}

const config = {};
for (const raw of opts.overrides) {
  const eq = raw.indexOf("=");
  if (eq === -1) {
    process.stderr.write(`Invalid override (missing '='): ${raw}\n`);
    process.exit(2);
  }
  const keys = splitKey(raw.slice(0, eq).trim());
  let v;
  try {
    v = parseToml(raw.slice(eq + 1).trim());
  } catch (err) {
    process.stderr.write(`codex-fake: ${err.message}\n`);
    process.exit(2);
  }
  let node = config;
  for (const k of keys.slice(0, -1)) node = node[k] ??= {};
  node[keys.at(-1)] = v;
}

// ─── What Codex would load ───────────────────────────────────────

const ignoreUserConfig = opts.flags.has("--ignore-user-config");
const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex");
const ambientServers = [];
if (!ignoreUserConfig) {
  try {
    const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    for (const m of toml.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)) ambientServers.push(m[1].replace(/"/g, ""));
  } catch {
    // no user config
  }
}

let outputSchema;
if (opts["output-schema"]) {
  try {
    outputSchema = JSON.parse(fs.readFileSync(opts["output-schema"], "utf8"));
  } catch (err) {
    process.stderr.write(`codex-fake: cannot read --output-schema: ${err.message}\n`);
    process.exit(2);
  }
}

const prompt = opts.positional.at(-1) === "-" ? fs.readFileSync(0, "utf8") : (opts.positional[1] ?? "");

const n = fs.readdirSync(dir).filter((f) => /^capture-\d+\.json$/.test(f)).length + 1;

// `script-<n>.json` scripts the n-th invocation only; `script.json` is the default.
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
const capture = {
  pid: process.pid,
  args,
  env: { ...process.env },
  prompt,
  config,
  sandbox: opts.sandbox,
  model: opts.model,
  cd: opts.cd,
  flags: [...opts.flags],
  outputSchemaPath: opts["output-schema"],
  outputSchema,
  mcpServersLoaded: [...Object.keys(config.mcp_servers ?? {}), ...ambientServers],
  mcpTools: undefined,
};
const captureFile = path.join(dir, `capture-${n}.json`);
const saveCapture = () => fs.writeFileSync(captureFile, JSON.stringify(capture, null, 2));
saveCapture();

// ─── MCP client (callMcp) ────────────────────────────────────────

const DEFAULT_ENV_VARS = ["HOME", "LOGNAME", "PATH", "SHELL", "USER", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ"];
const mcpClients = new Map();

async function startMcp() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  capture.mcpTools = {};
  for (const [name, s] of Object.entries(config.mcp_servers ?? {})) {
    if (!s.command) continue;
    const env = {};
    for (const k of [...DEFAULT_ENV_VARS, ...(s.env_vars ?? []).map((e) => (typeof e === "string" ? e : e.name))]) {
      if (process.env[k] !== undefined) env[k] = process.env[k];
    }
    Object.assign(env, s.env ?? {});
    const client = new Client({ name: "codex-fake", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: s.command, args: s.args ?? [], env, stderr: "ignore" }));
    const listed = await client.listTools();
    capture.mcpTools[name] = listed.tools.map((t) => t.name);
    mcpClients.set(name, client);
  }
  saveCapture();
}

// ─── JSONL out ───────────────────────────────────────────────────

const emit = (event) =>
  new Promise((resolve) => {
    process.stdout.write(JSON.stringify(event) + "\n", resolve);
  });
const started = new Map();

function usageOf(u) {
  const out = {};
  if (u?.inputTokens !== undefined) out.input_tokens = u.inputTokens;
  if (u?.outputTokens !== undefined) out.output_tokens = u.outputTokens;
  if (u?.cacheReadTokens !== undefined) out.cached_input_tokens = u.cacheReadTokens;
  if (u?.cacheCreationTokens !== undefined) out.cache_write_input_tokens = u.cacheCreationTokens;
  // costUsd and numTurns have no field in Codex's Usage; they are dropped.
  return out;
}

async function main() {
  if (callMcp) await startMcp();
  await emit({ type: "thread.started", thread_id: "fake-thread" });
  await emit({ type: "turn.started" });
  let msg = 0;
  for (const step of steps) {
    switch (step.kind) {
      case "tool-call": {
        const item = {
          id: step.id,
          type: "mcp_tool_call",
          server: "sweny-core",
          tool: step.name,
          arguments: step.input ?? {},
          result: null,
          error: null,
          status: "in_progress",
        };
        started.set(step.id, item);
        await emit({ type: "item.started", item });
        const client = callMcp ? mcpClients.get("sweny-core") : undefined;
        if (client) {
          const res = await client.callTool({ name: step.name, arguments: step.input ?? {} });
          const failed = res.isError === true;
          await emit({
            type: "item.completed",
            item: {
              ...item,
              status: failed ? "failed" : "completed",
              result: failed ? null : { content: res.content, structured_content: res.structuredContent ?? null },
              error: failed ? { message: res.content?.map((c) => c.text ?? "").join("") } : null,
            },
          });
        }
        break;
      }
      case "tool-result": {
        const item = started.get(step.id) ?? {
          id: step.id,
          type: "mcp_tool_call",
          server: "sweny-core",
          tool: "?",
          arguments: {},
        };
        await emit({
          type: "item.completed",
          item: {
            ...item,
            status: step.isError ? "failed" : "completed",
            result: step.isError ? null : { content: [{ type: "text", text: step.content }], structured_content: null },
            error: step.isError ? { message: step.content } : null,
          },
        });
        break;
      }
      case "raw":
        await emit(step.event);
        break;
      case "stderr":
        process.stderr.write(step.text + "\n");
        break;
      case "final":
        if (step.ok === false) {
          await emit({ type: "turn.failed", error: { message: step.text } });
        } else {
          await emit({ type: "item.completed", item: { id: `msg_${++msg}`, type: "agent_message", text: step.text } });
          await emit({ type: "turn.completed", usage: usageOf(step.usage) });
        }
        break;
      case "hang":
        await new Promise(() => setInterval(() => {}, 1 << 30));
        break;
      case "crash":
        await new Promise((resolve) => process.stdout.write('{"type":"item.sta', resolve));
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
  for (const c of mcpClients.values()) await c.close().catch(() => {});
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`codex-fake: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
