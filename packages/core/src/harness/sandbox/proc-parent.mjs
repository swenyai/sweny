#!/usr/bin/env node
// The process that holds the secret, for proc-isolation.test.ts (#599). The spec
// starts it with a canary in its exec-time env, the way sweny starts with skill
// credentials in its env, then has it start one agent as its child:
//
//   argv[2] = {"kind":"spawn","spawn":{command,args,env,cwd}}
//     Spawn exactly that (the fake agent unwrapped, or the srt-wrapped spawn
//     prepareAgentSpawn returned), with exactly that env, stdio inherited.
//   argv[2] = {"kind":"claude","dist","cwd","sandbox"}
//     Run one node on sweny's own ClaudeCodeHarness (built dist), env scoped,
//     sandbox mode as given. The spec's fake model server drives its Bash tool.
//     Prints one line: PARENT_RESULT <json>.
//
// "__PARENT_PID__" in a spawn arg becomes this process's pid: the agent is told
// where its parent is, as an attacker could learn it from its own /proc/self/status.

import { spawn } from "node:child_process";
import { readlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

const cfg = JSON.parse(process.argv[2] ?? "{}");

function pidNs() {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
}

if (cfg.kind === "spawn") {
  const s = cfg.spawn;
  const args = s.args.map((a) => a.split("__PARENT_PID__").join(String(process.pid)));
  process.stderr.write(`PARENT pid=${process.pid} pidNs=${pidNs()}\n`);
  const child = spawn(s.command, args, { cwd: s.cwd, env: s.env, stdio: ["ignore", "inherit", "inherit"] });
  child.on("error", (err) => {
    process.stderr.write(`PARENT spawn failed: ${err.message}\n`);
    process.exit(127);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
} else if (cfg.kind === "claude") {
  const { ClaudeCodeHarness } = await import(pathToFileURL(cfg.dist).href);
  const logs = [];
  const keep = (level) => (msg) => logs.push(`${level}: ${String(msg)}`);
  const harness = new ClaudeCodeHarness({
    cwd: cfg.cwd,
    sandbox: cfg.sandbox,
    envScope: true,
    maxTurns: 4,
    model: "claude-sonnet-4-5",
    logger: { info: () => {}, debug: () => {}, warn: keep("warn"), error: keep("error") },
  });
  let result;
  try {
    const r = await harness.run({ instruction: "Run the probe command with Bash.", context: {}, tools: [] });
    result = { status: r.status, contained: r.contained, data: r.data, pid: process.pid, pidNs: pidNs(), logs };
  } catch (err) {
    result = { status: "threw", error: String(err?.stack ?? err), pid: process.pid, pidNs: pidNs(), logs };
  }
  process.stdout.write(`PARENT_RESULT ${JSON.stringify(result)}\n`);
  process.exit(0);
} else {
  process.stderr.write(`unknown kind ${cfg.kind}\n`);
  process.exit(2);
}
