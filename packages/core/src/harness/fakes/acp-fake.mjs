#!/usr/bin/env node
/**
 * Scripted stand-in for an ACP agent (#416). No model, no network.
 *
 *   node acp-fake.mjs --fake-dir <dir> [anything else the adapter passes, ignored]
 *
 * Speaks the raw ACP wire (Agent Client Protocol schema v1.24.1,
 * agentclientprotocol/agent-client-protocol: newline-delimited JSON-RPC 2.0 on
 * stdio), not an SDK's reading of it, so the contract suite checks the adapter
 * against the protocol itself:
 *
 *   initialize        -> protocolVersion 1, agentInfo, empty authMethods
 *   session/new       -> records cwd and mcpServers, returns a sessionId
 *   session/prompt    -> records the prompt, asks session/request_permission for
 *                        each tool class and sends fs/write_text_file once (the
 *                        "probe", so the suite can see what the adapter allows),
 *                        then plays `<dir>/script.json` as session/update
 *                        notifications and answers {stopReason}
 *   session/cancel    -> ends a hanging or playing turn with stopReason "cancelled"
 *
 * Script: an array of neutral steps (harness/__contract__/scenarios.ts), or
 * `{ steps?, turns?, callMcp?, noProbe?, ignoreCancel?, ignoreEof?, ignoreTerm? }`:
 * - `turns`: one step list per session/prompt (the last repeats), for retries.
 * - `callMcp`: start the stdio MCP servers named in session/new and turn each
 *   `tool-call` step into a real `tools/call` (the tool bridge, end to end).
 * - `ignoreCancel`, `ignoreEof`, `ignoreTerm`: an agent that does not stop
 *   when asked, so the adapter's escalation to a kill is exercised.
 * Extra steps beyond the neutral ones: `{kind:"permission", id, title, toolKind?, name?, options?}`
 * asks session/request_permission and records the answer; `{kind:"fs-write", path}` sends
 * fs/write_text_file and records the answer. Nothing is ever run or written.
 * Top-level options also include `protocolVersion`, `http` (agent supports http MCP) and
 * `authRequired` (session/new fails with -32000).
 * `script-<n>.json` scripts the n-th spawn only.
 *
 * Everything the adapter handed over is written to `<dir>/capture-<n>.json`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const argv = process.argv.slice(2);
const dirIdx = argv.indexOf("--fake-dir");
if (dirIdx === -1) {
  process.stderr.write("acp-fake: --fake-dir is required\n");
  process.exit(2);
}
const dir = argv[dirIdx + 1];

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
const opts = Array.isArray(script) ? { steps: script } : script;
const turnsOf = (i) => (opts.turns ? (opts.turns[Math.min(i, opts.turns.length - 1)] ?? []) : (opts.steps ?? []));

const capture = {
  pid: process.pid,
  args: argv,
  env: { ...process.env },
  cwd: process.cwd(),
  initialize: null,
  sessionCwd: null,
  mcpServers: [],
  mcpServersLoaded: [],
  mcpTools: undefined,
  prompts: [],
  /** Whether the adapter allowed a permission request of each class (true = selected an allow option). */
  probe: {},
  /** What the adapter answered to fs/write_text_file: "error" | "ok". */
  fsWrite: undefined,
  /** Answers to `permission` steps, in order. */
  permissions: [],
  /** Answers to `fs-write` steps, in order. */
  fsWrites: [],
  cancels: 0,
};
// Write to a temp name, then rename: the test reads capture-<n>.json while this
// process may still be saving it, and a rename is atomic, so the reader sees the
// previous complete file or the new one, never a torn write. The temp name does
// not match the reader's /^capture-\d+\.json$/ filter.
const save = () => {
  const file = path.join(dir, `capture-${n}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(capture, null, 2));
  fs.renameSync(tmp, file);
};
save();

if (opts.ignoreTerm) process.on("SIGTERM", () => {});

// ─── wire ────────────────────────────────────────────────────────

const write = (msg) =>
  new Promise((resolve) => {
    process.stdout.write(JSON.stringify(msg) + "\n", resolve);
  });
const notify = (method, params) => write({ jsonrpc: "2.0", method, params });
const respond = (id, result) => write({ jsonrpc: "2.0", id, result });
const respondError = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

let nextId = 1000;
const waiting = new Map();
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    void write({ jsonrpc: "2.0", id, method, params });
  });

const sessionId = `sess_fake_${process.pid}`;
const update = (u) => notify("session/update", { sessionId, update: u });

// ─── probe: what would the adapter let through? ──────────────────

const OPTIONS = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];
const PROBES = [
  ["shell", { kind: "execute", title: "Run a command" }],
  ["edit", { kind: "edit", title: "Edit a file" }],
  ["net", { kind: "fetch", title: "Fetch a URL" }],
  ["subagent", { kind: "other", name: "Task", title: "Task" }],
];
let probed = false;
async function probe() {
  if (probed) return;
  probed = true;
  for (const [cls, tc] of PROBES) {
    const res = await request("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: `probe-${cls}`, status: "pending", ...tc },
      options: OPTIONS,
    });
    const o = res?.result?.outcome;
    const allowed = o?.outcome === "selected" && o?.optionId === "allow";
    capture.probe[cls] = allowed;
    if (cls === "edit") capture.probe.write = allowed;
  }
  const w = await request("fs/write_text_file", {
    sessionId,
    path: path.join(dir, "probe-write.txt"),
    content: "should never be written",
  });
  capture.fsWrite = w?.error ? "error" : "ok";
  save();
}

// ─── MCP client (callMcp) ────────────────────────────────────────

const mcpClients = new Map();
async function startMcp() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  capture.mcpTools = {};
  for (const s of capture.mcpServers) {
    if (!s.command) continue;
    // Like real agents, the MCP server inherits the agent's own env (inside the
    // sandbox wrapper that carries srt's HTTP_PROXY); the listed vars add to it.
    const env = { ...process.env, ...Object.fromEntries((s.env ?? []).map((e) => [e.name, e.value])) };
    const client = new Client({ name: "acp-fake", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: s.command, args: s.args ?? [], env, stderr: "ignore" }));
    capture.mcpTools[s.name] = (await client.listTools()).tools.map((t) => t.name);
    mcpClients.set(s.name, client);
  }
  save();
}

// ─── turns ───────────────────────────────────────────────────────

let promptCount = 0;
let cancelled = false;
let wake;

const textContent = (text) => [{ type: "content", content: { type: "text", text } }];

async function playTurn(id, steps) {
  // `cancelled` is not reset here: a cancel that arrives during the probe still ends this turn.
  for (const step of steps) {
    if (cancelled) break;
    switch (step.kind) {
      case "tool-call": {
        await update({
          sessionUpdate: "tool_call",
          toolCallId: step.id,
          title: step.name,
          name: step.name,
          kind: "other",
          status: "pending",
          rawInput: step.input ?? {},
        });
        const client = opts.callMcp ? mcpClients.get("sweny-core") : undefined;
        if (client) {
          const res = await client.callTool({ name: step.name, arguments: step.input ?? {} });
          const text = (res.content ?? []).map((c) => c.text ?? "").join("");
          await update({
            sessionUpdate: "tool_call_update",
            toolCallId: step.id,
            status: res.isError === true ? "failed" : "completed",
            content: textContent(text),
          });
        }
        break;
      }
      case "tool-result":
        await update({
          sessionUpdate: "tool_call_update",
          toolCallId: step.id,
          status: step.isError ? "failed" : "completed",
          content: textContent(step.content),
        });
        break;
      case "raw":
        await write(step.event);
        break;
      case "permission": {
        // An agent asking before it runs a tool: the answer is recorded, nothing is run.
        const res = await request("session/request_permission", {
          sessionId,
          toolCall: {
            toolCallId: step.id,
            status: "pending",
            title: step.title,
            ...(step.toolKind ? { kind: step.toolKind } : {}),
            ...(step.name ? { name: step.name } : {}),
          },
          options: step.options ?? OPTIONS,
        });
        capture.permissions.push({ id: step.id, outcome: res?.result?.outcome ?? null });
        save();
        break;
      }
      case "fs-write": {
        // A client method the adapter never advertised: the answer is recorded, nothing is written.
        const res = await request("fs/write_text_file", { sessionId, path: step.path, content: step.content ?? "x" });
        capture.fsWrites.push({ path: step.path, error: res?.error?.message ?? null });
        save();
        break;
      }
      case "usage":
        // Live cost (#449): `usage_update` carries the cumulative cost so far.
        if (step.usage.costUsd !== undefined) {
          await update({
            sessionUpdate: "usage_update",
            used: 1234,
            size: 200000,
            cost: { amount: step.usage.costUsd, currency: "USD" },
          });
        }
        break;
      case "stderr":
        process.stderr.write(step.text + "\n");
        break;
      case "hang":
        await new Promise((resolve) => {
          wake = resolve;
        });
        break;
      case "crash":
        await new Promise((resolve) => process.stdout.write('{"jsonrpc":"2.0","method":"session/upd', resolve));
        process.stderr.write(step.message + "\n");
        process.exit(1);
        break;
      case "exit":
        process.exit(step.code);
        break;
      case "final": {
        if (step.ok === false) {
          await respondError(id, -32603, step.text);
          return;
        }
        const mid = Math.ceil(step.text.length / 2);
        await update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } });
        for (const part of [step.text.slice(0, mid), step.text.slice(mid)]) {
          if (part) {
            await update({
              sessionUpdate: "agent_message_chunk",
              messageId: `m${promptCount}`,
              content: { type: "text", text: part },
            });
          }
        }
        if (step.usage) {
          await update({
            sessionUpdate: "usage_update",
            used: 1234,
            size: 200000,
            ...(step.usage.costUsd !== undefined ? { cost: { amount: step.usage.costUsd, currency: "USD" } } : {}),
          });
        }
        await respond(id, { stopReason: "end_turn" });
        return;
      }
      default:
        break;
    }
  }
  if (cancelled) {
    cancelled = false;
    await respond(id, { stopReason: "cancelled" });
    return;
  }
  // The script ended without a final step: the agent goes away without answering.
  process.exit(0);
}

async function onRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      capture.initialize = params;
      save();
      await respond(id, {
        protocolVersion: opts.protocolVersion ?? 1,
        agentCapabilities: { mcpCapabilities: { http: opts.http === true, sse: false } },
        agentInfo: { name: "acp-fake", title: "ACP fake", version: "9.8.7" },
        authMethods: [],
      });
      return;
    case "session/new":
      capture.sessionCwd = params.cwd;
      capture.mcpServers = params.mcpServers ?? [];
      capture.mcpServersLoaded = capture.mcpServers.map((s) => s.name);
      save();
      if (opts.authRequired) {
        await respondError(id, -32000, "Authentication required");
        return;
      }
      if (opts.callMcp) await startMcp();
      await respond(id, { sessionId });
      return;
    case "session/prompt": {
      promptCount++;
      capture.prompts.push((params.prompt ?? []).map((b) => (b.type === "text" ? b.text : "")).join(""));
      save();
      if (!opts.noProbe) await probe();
      await playTurn(id, turnsOf(promptCount - 1));
      return;
    }
    default:
      await respondError(id, -32601, `acp-fake: method not found: ${method}`);
  }
}

function onMessage(msg) {
  if (typeof msg.method === "string") {
    if (msg.id !== undefined) void onRequest(msg);
    else if (msg.method === "session/cancel") {
      capture.cancels++;
      save();
      if (opts.ignoreCancel) return;
      cancelled = true;
      if (wake) {
        wake();
        wake = undefined;
      }
    }
    return;
  }
  const resolve = waiting.get(msg.id);
  if (resolve) {
    waiting.delete(msg.id);
    resolve(msg);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      onMessage(JSON.parse(line));
    } catch (err) {
      process.stderr.write(`acp-fake: bad line: ${err.message}\n`);
    }
  }
});
process.stdin.on("end", async () => {
  if (opts.ignoreEof) return;
  for (const c of mcpClients.values()) await c.close().catch(() => {});
  process.exit(0);
});
// An agent that ignores EOF must still be alive to be killed.
if (opts.ignoreEof || opts.ignoreCancel || opts.ignoreTerm) setInterval(() => {}, 1 << 30);
