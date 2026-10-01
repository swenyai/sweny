/**
 * Real containment (#360 step 2): the fake agent runs under srt through
 * `prepareAgentSpawn`, exactly as a pi or ACP adapter would spawn its agent.
 *
 * Needs srt on PATH (plus bubblewrap, socat and ripgrep on Linux). Skips when
 * no working wrapper is found, except under SWENY_REQUIRE_SANDBOX_WRAPPER=1
 * (the `sandbox-wrapper` CI job), where a missing wrapper fails the suite.
 *
 * Every "blocked" assertion has an unwrapped control run proving the probe
 * itself works, so a pass can never come from a broken probe. No external
 * network: the allowlisted and blocked hosts are two local HTTP servers.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAgentEnv } from "../../agent-env.js";
import { gitCredentialMask } from "../../git-credentials.js";
import {
  detectSandboxWrapper,
  prepareAgentSpawn,
  SrtSandboxWrapper,
  type AgentSpawn,
  type SandboxWrapper,
} from "../sandbox-wrapper.js";
import { TOKEN_ENV } from "../tool-bridge/protocol.js";
import { startToolBridge, type ToolBridge } from "../tool-bridge/server.js";
import type { HarnessCapabilities, NodePolicy } from "../types.js";
import type { Tool } from "../../types.js";

const REQUIRED = process.env.SWENY_REQUIRE_SANDBOX_WRAPPER === "1";
const FAKE_AGENT = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
const DIST_CLI = fileURLToPath(new URL("../../../dist/cli/main.js", import.meta.url));
const CANARY_NAME = "SWENY_WRAP_CANARY";
const CANARY_VALUE = `canary-${process.pid}-${Date.now()}`;

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

// Scratch laid out before detection so the credential file can be denied.
const root = await mkdtemp(path.join(tmpdir(), "sweny-contained-"));
const workspace = path.join(root, "workspace");
const outside = path.join(root, "outside");
const credential = path.join(root, "operator-credential.json");
await mkdir(workspace, { recursive: true });
await mkdir(outside, { recursive: true });
await writeFile(credential, '{"token":"operator-secret"}');

const detection = await detectSandboxWrapper({ wrapper: { credentialPaths: [credential] } });
const wrapper: SandboxWrapper | undefined = detection.wrapper;

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

type Probe =
  | { kind: "http"; url: string; via: "proxy" | "direct" }
  | { kind: "write"; path: string }
  | { kind: "read"; path: string }
  | { kind: "contains"; path: string; needle: string }
  | { kind: "vcs"; args: string[]; needle: string }
  | { kind: "env"; names: string[] }
  | { kind: "procScan"; needle: string }
  | {
      kind: "mcp";
      command: string;
      args: string[];
      envFrom: string[];
      call: { name: string; arguments: Record<string, unknown> };
    };

interface ProbeResult {
  ok?: boolean;
  status?: number;
  error?: string;
  stderr?: string;
  tools?: string[];
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  values?: Record<string, string | null>;
  found?: boolean;
  scanned?: number;
}

function scopedEnv(): Record<string, string> {
  // The adapter's env is already scoped: the canary is withheld, the node's var passes.
  return buildAgentEnv(
    { ...process.env, [CANARY_NAME]: CANARY_VALUE, NODE_SCOPED_VAR: "node-scoped" },
    { extraVars: ["NODE_SCOPED_VAR"] },
  );
}

function runChild(s: AgentSpawn): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(s.command, s.args, { cwd: s.cwd, env: s.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseResults(stdout: string, stderr: string): ProbeResult[] {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("["));
  if (!line) throw new Error(`fake agent printed no results.\nstdout: ${stdout}\nstderr: ${stderr}`);
  return JSON.parse(line) as ProbeResult[];
}

/** The fake agent, unwrapped: the control that proves each probe can succeed. */
async function runUnwrapped(
  plan: Probe[],
  extraEnv: Record<string, string> = {},
  cwd: string = workspace,
): Promise<ProbeResult[]> {
  const r = await runChild({
    command: process.execPath,
    args: [FAKE_AGENT, JSON.stringify(plan)],
    env: { ...scopedEnv(), [CANARY_NAME]: CANARY_VALUE, ...extraEnv },
    cwd,
  });
  return parseResults(r.stdout, r.stderr);
}

/** The fake agent through prepareAgentSpawn with the host's wrapper, strict sandbox mode. */
async function runWrapped(
  plan: Probe[],
  opts: {
    egress?: string[];
    readOnly?: boolean;
    extraEnv?: Record<string, string>;
    cwd?: string;
    gitCredentials?: string[];
  } = {},
): Promise<{ results: ProbeResult[]; home?: string; homeExistsAfterCleanup: boolean }> {
  const policy: NodePolicy = {
    readOnly: opts.readOnly ?? false,
    deny: [],
    egress: opts.egress ?? [],
    strict: false,
    sandbox: "strict",
    ...(opts.gitCredentials ? { gitCredentials: opts.gitCredentials } : {}),
  };
  const prep = await prepareAgentSpawn({
    caps: NO_NATIVE_SANDBOX,
    policy,
    wrapper,
    env: {},
    spawn: {
      command: process.execPath,
      args: [FAKE_AGENT, JSON.stringify(plan)],
      env: { ...scopedEnv(), ...opts.extraEnv },
      cwd: opts.cwd ?? workspace,
    },
  });
  expect(prep.refuse).toBeUndefined();
  expect(prep.wrappedBy).toBe("srt");
  let r: Awaited<ReturnType<typeof runChild>>;
  try {
    r = await runChild(prep.spawn);
  } finally {
    await prep.cleanup();
  }
  return {
    results: parseResults(r.stdout, r.stderr),
    home: prep.home,
    homeExistsAfterCleanup: prep.home ? existsSync(prep.home) : false,
  };
}

if (!wrapper && REQUIRED) {
  describe("sandbox wrapper (required)", () => {
    it("a working wrapper is available on this host", () => {
      throw new Error(`SWENY_REQUIRE_SANDBOX_WRAPPER=1 but no wrapper: ${detection.reason}`);
    });
  });
}

describe.skipIf(!wrapper)(`wrapped fake agent (${process.platform}, srt)`, () => {
  let allowed: http.Server;
  let blocked: http.Server;
  let hits = { allowed: 0, blocked: 0 };
  let allowedUrl = "";
  let blockedUrl = "";
  let decoy: ChildProcess | undefined;

  const listen = (onHit: () => void) =>
    new Promise<http.Server>((resolve) => {
      const s = http.createServer((_req, res) => {
        onHit();
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("reached");
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
    });

  beforeAll(async () => {
    allowed = await listen(() => hits.allowed++);
    blocked = await listen(() => hits.blocked++);
    allowedUrl = `http://127.0.0.1:${(allowed.address() as AddressInfo).port}/`;
    blockedUrl = `http://127.0.0.1:${(blocked.address() as AddressInfo).port}/`;
    // A host process whose initial env holds the canary: what a wrapped agent
    // must not be able to read through /proc/<pid>/environ.
    decoy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      env: { ...process.env, [CANARY_NAME]: CANARY_VALUE },
      stdio: "ignore",
    });
  });

  afterAll(async () => {
    decoy?.kill("SIGKILL");
    await new Promise((r) => allowed?.close(r));
    await new Promise((r) => blocked?.close(r));
  });

  it("reaches an allowlisted host", async () => {
    hits = { allowed: 0, blocked: 0 };
    const allowedHost = new URL(allowedUrl).host; // 127.0.0.1:<port>
    const { results } = await runWrapped([{ kind: "http", url: allowedUrl, via: "proxy" }], {
      egress: [allowedHost],
    });
    expect(results[0], JSON.stringify(results[0])).toMatchObject({ ok: true, status: 200 });
    expect(hits.allowed).toBe(1);
  });

  it("cannot reach a non-allowlisted host, through the proxy or directly", async () => {
    // Control: unwrapped, the blocked server answers.
    hits = { allowed: 0, blocked: 0 };
    const control = await runUnwrapped([{ kind: "http", url: blockedUrl, via: "direct" }]);
    expect(control[0]).toMatchObject({ ok: true, status: 200 });
    expect(hits.blocked).toBe(1);

    hits = { allowed: 0, blocked: 0 };
    const allowedHost = new URL(allowedUrl).host;
    const { results } = await runWrapped(
      [
        { kind: "http", url: blockedUrl, via: "proxy" },
        { kind: "http", url: blockedUrl, via: "direct" },
      ],
      { egress: [allowedHost] },
    );
    expect(results[0].ok, `via proxy: ${JSON.stringify(results[0])}`).toBe(false);
    expect(results[1].ok, `direct: ${JSON.stringify(results[1])}`).toBe(false);
    expect(hits.blocked, "the blocked server saw no request").toBe(0);
  });

  it("cannot read an env var outside its scope", async () => {
    const plan: Probe[] = [
      { kind: "env", names: [CANARY_NAME, "NODE_SCOPED_VAR", "HOME"] },
      { kind: "procScan", needle: CANARY_VALUE },
    ];
    // Control: /proc is readable and the decoy's env holds the canary.
    if (process.platform === "linux") {
      const control = await runUnwrapped(plan);
      expect(control[1].found, "control: the canary is visible through /proc unwrapped").toBe(true);
    }

    const { results, home } = await runWrapped(plan);
    const env = results[0].values ?? {};
    expect(env[CANARY_NAME]).toBeNull();
    expect(env.NODE_SCOPED_VAR).toBe("node-scoped");
    expect(env.HOME, "scratch HOME, not the operator's").toBe(home);
    expect(env.HOME).not.toBe(homedir());
    if (process.platform === "linux") {
      expect(results[1].found, "no process visible to the agent carries the canary").toBe(false);
    }
  });

  it("cannot write outside the workspace; can write the workspace and its scratch HOME", async () => {
    const inside = path.join(workspace, `inside-${Date.now()}.txt`);
    const escaped = path.join(outside, `escaped-${Date.now()}.txt`);
    const operatorHome = path.join(homedir(), `.sweny-escape-${process.pid}-${Date.now()}`);
    // Control: unwrapped, the outside dir is writable.
    const control = await runUnwrapped([{ kind: "write", path: path.join(outside, "control.txt") }]);
    expect(control[0].ok).toBe(true);

    const { results, homeExistsAfterCleanup } = await runWrapped([
      { kind: "write", path: inside },
      { kind: "write", path: escaped },
      { kind: "write", path: operatorHome },
      { kind: "write", path: "$HOME/scratch.txt" },
    ]);
    expect(results[0], "workspace write").toMatchObject({ ok: true });
    expect(existsSync(inside)).toBe(true);
    expect(results[1].ok, `outside write: ${JSON.stringify(results[1])}`).toBe(false);
    expect(existsSync(escaped)).toBe(false);
    expect(results[2].ok, `operator HOME write: ${JSON.stringify(results[2])}`).toBe(false);
    expect(existsSync(operatorHome)).toBe(false);
    expect(results[3], "scratch HOME write").toMatchObject({ ok: true });
    expect(homeExistsAfterCleanup, "scratch HOME removed by cleanup").toBe(false);
  });

  it("cannot read the operator's credential files", async () => {
    const control = await runUnwrapped([{ kind: "read", path: credential }]);
    expect(control[0].ok).toBe(true);
    const { results } = await runWrapped([{ kind: "read", path: credential }]);
    expect(results[0].ok, JSON.stringify(results[0])).toBe(false);
  });

  it.each(["default", "inside-workspace"])("isolates sibling scratch credentials (%s root)", async (placement) => {
    // The custom placement also proves a writable workspace does not reopen
    // the denied scratch subtree. Both adapters must use the same root.
    const scratchRoot = placement === "inside-workspace" ? workspace : undefined;
    const detected = await detectSandboxWrapper({ wrapper: { scratchRoot } });
    expect(detected.wrapper, detected.reason).toBeDefined();
    const request = {
      command: process.execPath,
      args: [FAKE_AGENT, "[]"],
      env: scopedEnv(),
      cwd: workspace,
      egress: [],
    };
    const first = await detected.wrapper!.wrap(request);
    // Create the sibling AFTER the first policy is written. Enumerating the
    // currently existing homes would miss this sibling.
    const otherWrapper = new SrtSandboxWrapper({ srtPath: first.command, scratchRoot });
    const second = await otherWrapper.wrap(request).catch(async (error) => {
      await first.cleanup();
      throw error;
    });
    const firstCredential = path.join(first.home, "auth.json");
    const secondCredential = path.join(second.home, "auth.json");
    try {
      await writeFile(firstCredential, '{"token":"first-canary"}');
      await writeFile(secondCredential, '{"token":"second-canary"}');
      const control = await runUnwrapped([
        { kind: "read", path: firstCredential },
        { kind: "read", path: secondCredential },
      ]);
      expect(control).toEqual([{ ok: true }, { ok: true }]);

      for (const [current, ownCredential, siblingCredential] of [
        [first, firstCredential, secondCredential],
        [second, secondCredential, firstCredential],
      ] as const) {
        current.args[current.args.length - 1] = JSON.stringify([
          { kind: "read", path: ownCredential },
          { kind: "read", path: siblingCredential },
          { kind: "write", path: "$HOME/still-writable.txt" },
        ]);
        const child = await runChild(current);
        expect(child.code, child.stderr).toBe(0);
        const results = parseResults(child.stdout, child.stderr);
        expect(results[0], "own credential remains readable").toEqual({ ok: true });
        expect(results[1], "sibling credential must be unreadable").toMatchObject({ ok: false });
        expect(results[2], "own HOME remains writable").toEqual({ ok: true });
      }
      await first.cleanup();
      expect(existsSync(first.home)).toBe(false);
      expect(existsSync(secondCredential), "cleanup must preserve the sibling").toBe(true);
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
    expect(existsSync(second.home)).toBe(false);
    expect(existsSync(scratchRoot ?? tmpdir()), "caller scratch parent must survive cleanup").toBe(true);
  });

  // #439: pi and ACP get skill tools through the tool bridge shim, which the
  // agent starts inside the sandbox and which must reach the bridge the sweny
  // process serves outside it.
  describe("tool bridge from inside the sandbox", () => {
    const calls: string[] = [];
    const echo: Tool = {
      name: "echo",
      description: "Echo text back",
      access: "read",
      input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      handler: async (input: any) => {
        calls.push(String(input.text));
        return `echo ${input.text}`;
      },
    };
    const silent = { info() {}, warn() {}, error() {}, debug() {} };
    const start = (tcp: boolean) =>
      startToolBridge({
        tools: [echo],
        context: { config: {}, logger: silent },
        logger: silent,
        tcp,
        // The shipped shim (`sweny tool-bridge`) from the core build; the job builds core first.
        shimCommand: { command: process.execPath, args: [DIST_CLI, "tool-bridge"] },
      });
    // What an agent's MCP client hands the shim: the server's env, plus the
    // proxy variables srt set for the agent (pi forwards them by reference).
    const probe = (bridge: ToolBridge, text: string): Probe => ({
      kind: "mcp",
      command: bridge.mcpServer.command!,
      args: bridge.mcpServer.args ?? [],
      envFrom: [TOKEN_ENV, "SWENY_NO_UPDATE_CHECK", "HTTP_PROXY", "http_proxy"],
      call: { name: "echo", arguments: { text } },
    });
    const tokenEnv = (bridge: ToolBridge) => ({ [TOKEN_ENV]: bridge.token, SWENY_NO_UPDATE_CHECK: "1" });

    it("the unix socket is out of reach: srt blocks AF_UNIX sockets", async () => {
      calls.length = 0;
      const bridge = await start(false);
      try {
        const control = await runUnwrapped([probe(bridge, "control")], tokenEnv(bridge));
        expect(control[0], JSON.stringify(control[0])).toMatchObject({ ok: true, tools: ["echo"] });
        const { results } = await runWrapped([probe(bridge, "wrapped")], { extraEnv: tokenEnv(bridge) });
        expect(results[0].ok, JSON.stringify(results[0])).toBe(false);
        expect(calls).toEqual(["control"]);
      } finally {
        await bridge.close();
      }
    }, 60_000);

    it.each([false, true])(
      "lists and calls a tool over the bridge's allowlisted loopback port (readOnly %s)",
      async (readOnly) => {
        calls.length = 0;
        const bridge = await start(true);
        try {
          expect(bridge.egress).toEqual([`127.0.0.1:${bridge.tcp!.port}`]);
          // Control: unwrapped, the shim connects straight to the port.
          const control = await runUnwrapped([probe(bridge, "control")], tokenEnv(bridge));
          expect(control[0], JSON.stringify(control[0])).toMatchObject({ ok: true, tools: ["echo"] });

          const { results } = await runWrapped([probe(bridge, "wrapped")], {
            readOnly,
            egress: bridge.egress,
            extraEnv: tokenEnv(bridge),
          });
          expect(results[0], JSON.stringify(results[0])).toMatchObject({ ok: true, tools: ["echo"] });
          expect(results[0].result?.content?.[0]?.text).toContain("echo wrapped");
          // The handler ran here, in the sweny process, not inside the sandbox.
          expect(calls).toEqual(["control", "wrapped"]);
        } finally {
          await bridge.close();
        }
      },
      60_000,
    );

    it("without the bridge's egress entry the port stays unreachable", async () => {
      calls.length = 0;
      const bridge = await start(true);
      try {
        const { results } = await runWrapped([probe(bridge, "wrapped")], { extraEnv: tokenEnv(bridge) });
        expect(results[0].ok, JSON.stringify(results[0])).toBe(false);
        expect(calls).toEqual([]);
      } finally {
        await bridge.close();
      }
    }, 60_000);
  });

  // #473: actions/checkout persists the job token in `.git/config` (v4, v5)
  // or in an included file (v6+). A read-only or staged node must not read it,
  // by any route: the file itself, the included file, or git.
  it("a persisted git credential is unreadable to a read-only node, by file or by git", async () => {
    const repo = path.join(root, "checkout");
    const header = `AUTHORIZATION: basic ${CANARY_VALUE}-header`;
    const included = path.join(outside, "git-credentials-test.config");
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(root, "no-global") };
    const g = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });
    await mkdir(repo, { recursive: true });
    await writeFile(gitEnv.GIT_CONFIG_GLOBAL, "");
    expect(g(["init", "-q"]).status).toBe(0);
    expect(g(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]).status).toBe(0);
    expect(g(["config", "http.https://github.com/.extraheader", header]).status).toBe(0);
    await writeFile(included, `[http "https://example.test/"]\n\textraheader = ${header}-included\n`);
    expect(g(["config", "include.path", included]).status).toBe(0);
    const files = gitCredentialMask(repo, { readOnly: true, staged: false }, { env: { HOME: root } });
    expect(files.length, `scan: ${files.join(", ")}`).toBe(2);

    const plan: Probe[] = [
      { kind: "contains", path: path.join(repo, ".git", "config"), needle: CANARY_VALUE },
      { kind: "contains", path: included, needle: CANARY_VALUE },
      { kind: "vcs", args: ["config", "--show-origin", "--list"], needle: CANARY_VALUE },
    ];
    // Control: unwrapped, every route shows the canary.
    const control = await runUnwrapped(plan, {}, repo);
    expect(
      control.map((r) => r.found),
      JSON.stringify(control),
    ).toEqual([true, true, true]);

    const { results } = await runWrapped(plan, { readOnly: true, cwd: repo, gitCredentials: files });
    expect(
      results.map((r) => r.found),
      JSON.stringify(results),
    ).toEqual([false, false, false]);
  });

  it("a dry run cannot write the workspace either", async () => {
    const target = path.join(workspace, `dry-run-${Date.now()}.txt`);
    const { results } = await runWrapped([{ kind: "write", path: target }], { readOnly: true });
    expect(results[0].ok, JSON.stringify(results[0])).toBe(false);
    expect(existsSync(target)).toBe(false);
  });
});
