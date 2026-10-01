#!/usr/bin/env node
// Fake agent process for the sandbox wrapper specs (#360 step 2). No model:
// it plays a JSON plan (argv[2]) of probes and prints one JSON array of
// results on stdout. Every probe reports what happened; the spec decides what
// should have happened.
//
// Probes:
//   { kind: "http", url, via: "proxy" | "direct" }  -> { ok, status?, body?, error? }
//   { kind: "write", path }                          -> { ok, error? }
//   { kind: "read", path }                           -> { ok, error? }
//   { kind: "contains", path, needle }               -> { ok, found, error? } (read the file, search it)
//   { kind: "vcs", args, needle }                    -> { ok, found } (run git with args, search its output)
//   { kind: "env", names }                           -> { values: { name: value | null } }
//   { kind: "procScan", needle }                     -> { found, scanned }
//   { kind: "dumpEnv", path }                        -> appends {env, cwd} as one JSON line to path
//   { kind: "mcp", command, args, envFrom, call }    -> { ok, tools?, result?, error?, stderr? }
//     Starts a stdio MCP server (the tool bridge shim) the way an agent's MCP
//     client does, with env = PATH, HOME, TMPDIR plus the named vars from this
//     process, lists its tools, then makes one tools/call.
// Paths starting with "$HOME" resolve against the HOME this process sees.

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";

const TIMEOUT_MS = 5000;

function proxyUrl() {
  const raw = process.env.HTTP_PROXY || process.env.http_proxy;
  return raw ? new URL(raw) : undefined;
}

function httpProbe(url, via) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const proxy = via === "proxy" ? proxyUrl() : undefined;
    if (via === "proxy" && !proxy) return resolve({ ok: false, error: "no HTTP_PROXY in env" });
    const headers = { Host: target.host };
    if (proxy && (proxy.username || proxy.password)) {
      const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(cred).toString("base64")}`;
    }
    const req = http.request(
      proxy
        ? { host: proxy.hostname, port: Number(proxy.port || 80), path: target.href, method: "GET", headers }
        : { host: target.hostname, port: Number(target.port || 80), path: target.pathname, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: body.slice(0, 200) }));
      },
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", (err) => resolve({ ok: false, error: `${err.code ?? ""} ${err.message}`.trim() }));
    req.end();
  });
}

function tryFs(fn) {
  try {
    fn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code ?? String(err) };
  }
}

/** Read a file and say whether `needle` is in it (a masked file reads empty or fails). */
function containsProbe(p, needle) {
  try {
    return { ok: true, found: readFileSync(p, "utf8").includes(needle) };
  } catch (err) {
    return { ok: false, found: false, error: err.code ?? String(err) };
  }
}

/** Run git (as an agent's shell would) and say whether `needle` shows up in its output. */
function vcsProbe(args, needle) {
  const r = spawnSync("git", args, { encoding: "utf8", timeout: TIMEOUT_MS });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === 0, found: out.includes(needle) };
}

function procScan(needle) {
  let scanned = 0;
  let found = false;
  let pids = [];
  try {
    pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return { found: false, scanned: 0, error: "no /proc" };
  }
  for (const pid of pids) {
    try {
      const environ = readFileSync(`/proc/${pid}/environ`, "utf8");
      scanned++;
      if (environ.includes(needle)) found = true;
    } catch {
      // not readable: that is containment too
    }
  }
  return { found, scanned };
}

async function mcpProbe(p) {
  let client;
  let stderr = "";
  const withTimeout = (promise, what) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), 15_000).unref()),
    ]);
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const env = {};
    for (const k of ["PATH", "HOME", "TMPDIR", ...(p.envFrom ?? [])]) {
      if (process.env[k] !== undefined) env[k] = process.env[k];
    }
    const transport = new StdioClientTransport({ command: p.command, args: p.args ?? [], env, stderr: "pipe" });
    transport.stderr?.on("data", (c) => (stderr += c));
    client = new Client({ name: "fake-agent", version: "0.0.0" });
    await withTimeout(client.connect(transport), "connect");
    const listed = await withTimeout(client.listTools(), "tools/list");
    const result = p.call ? await withTimeout(client.callTool(p.call), "tools/call") : undefined;
    return { ok: result ? result.isError !== true : true, tools: listed.tools.map((t) => t.name), result };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), stderr: stderr.slice(0, 2000) };
  } finally {
    await client?.close().catch(() => {});
  }
}

/** A leading "$HOME" is the HOME this process sees (the scratch HOME when wrapped). */
function resolvePath(p) {
  return p.startsWith("$HOME") ? (process.env.HOME ?? "") + p.slice("$HOME".length) : p;
}

const plan = JSON.parse(process.argv[2] ?? "[]");
const results = [];
for (const p of plan) {
  if (p.kind === "http") results.push(await httpProbe(p.url, p.via));
  else if (p.kind === "write") results.push(tryFs(() => writeFileSync(resolvePath(p.path), "sweny-fake-agent\n")));
  else if (p.kind === "read") results.push(tryFs(() => readFileSync(resolvePath(p.path))));
  else if (p.kind === "contains") results.push(containsProbe(resolvePath(p.path), p.needle));
  else if (p.kind === "vcs") results.push(vcsProbe(p.args, p.needle));
  else if (p.kind === "dumpEnv")
    results.push(tryFs(() => appendFileSync(p.path, JSON.stringify({ env: process.env, cwd: process.cwd() }) + "\n")));
  else if (p.kind === "env")
    results.push({ values: Object.fromEntries(p.names.map((n) => [n, process.env[n] ?? null])) });
  else if (p.kind === "procScan") results.push(procScan(p.needle));
  else if (p.kind === "mcp") results.push(await mcpProbe(p));
  else results.push({ error: `unknown probe ${p.kind}` });
}
process.stdout.write(JSON.stringify(results) + "\n");
