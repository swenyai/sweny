import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX_DOMAINS } from "../agent-env.js";
import { CLAUDE_CODE_CAPABILITIES } from "./capabilities.js";
import { createRecordingWrapper } from "./__contract__/sandbox.js";
import {
  buildSrtSettings,
  detectSandboxWrapper,
  isSrtDomainPattern,
  prepareAgentSpawn,
  scratchEnv,
  SrtSandboxWrapper,
} from "./sandbox-wrapper.js";
import type { HarnessCapabilities, NodePolicy } from "./types.js";

const WEAK: HarnessCapabilities = {
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

const SPAWN = { command: "/bin/agent", args: ["--rpc"], env: { PATH: "/usr/bin", HOME: "/home/op" }, cwd: "/work" };

function policy(over: Partial<NodePolicy> = {}): NodePolicy {
  return { readOnly: false, deny: [], egress: ["api.linear.app"], strict: false, ...over };
}

describe("isSrtDomainPattern", () => {
  it.each([
    "example.com",
    "api.github.com",
    "*.githubusercontent.com",
    "localhost",
    "127.0.0.1",
    "127.0.0.1:8080",
    "example.com:443",
    "[::1]",
    "[::1]:443",
  ])("accepts %s", (d) => expect(isSrtDomainPattern(d)).toBe(true));

  it.each([
    "",
    "*",
    "*.com",
    "https://example.com",
    "example.com/path",
    "a b.com",
    "exa*mple.com",
    "com",
    "::1",
    "x.com:99999",
    "user@example.com",
  ])("rejects %j", (d) => expect(isSrtDomainPattern(d)).toBe(false));
});

describe("buildSrtSettings", () => {
  const exists = (p: string) => p === "/home/op/.ssh" || p === "/home/op/.npmrc";

  it("allows only the valid egress hosts, deduped, and denies every other host", () => {
    const s = buildSrtSettings(
      { cwd: "/work", egress: ["api.github.com", "api.github.com", "*", "https://evil.test", "sentry.io"] },
      { home: "/scratch/home", credentialHome: "/home/op", exists },
    );
    expect(s.network).toEqual({
      allowedDomains: ["api.github.com", "sentry.io"],
      deniedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: false,
    });
  });

  it("makes the workspace and the scratch HOME writable, nothing else", () => {
    const s = buildSrtSettings(
      { cwd: "/work", egress: [] },
      { home: "/scratch/home", credentialHome: "/home/op", exists },
    );
    expect(s.filesystem.allowWrite).toEqual(["/work", "/scratch/home"]);
    expect(s.filesystem.denyWrite).toEqual([]);
  });

  it("dry run: only the scratch HOME is writable", () => {
    const s = buildSrtSettings(
      { cwd: "/work", egress: [], readOnly: true },
      { home: "/scratch/home", credentialHome: "/home/op", exists },
    );
    expect(s.filesystem.allowWrite).toEqual(["/scratch/home"]);
  });

  it("denies reading the operator's existing credential files only", () => {
    const s = buildSrtSettings(
      { cwd: "/work", egress: [] },
      { home: "/scratch/home", credentialHome: "/home/op", exists },
    );
    expect(s.filesystem.denyRead).toEqual(["/home/op/.ssh", "/home/op/.npmrc"]);
    expect(s.filesystem.allowRead).toEqual([]);
  });
});

describe("scratchEnv", () => {
  it("moves HOME, XDG and temp dirs into the scratch HOME and keeps everything else", () => {
    const env = scratchEnv({ PATH: "/usr/bin", HOME: "/home/op", NODE_TOKEN: "t" }, "/scratch/home");
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      NODE_TOKEN: "t",
      HOME: "/scratch/home",
      XDG_CONFIG_HOME: "/scratch/home/.config",
      XDG_CACHE_HOME: "/scratch/home/.cache",
      XDG_DATA_HOME: path.join("/scratch/home", ".local", "share"),
      TMPDIR: "/scratch/home/tmp",
      CLAUDE_CODE_TMPDIR: "/scratch/home/tmp",
    });
  });
});

describe("SrtSandboxWrapper", () => {
  it("wraps the argv after --, writes the settings, and cleans up its scratch", async () => {
    const w = new SrtSandboxWrapper({ srtPath: "/opt/srt", credentialHome: "/nonexistent-home" });
    expect(w.provides).toEqual({ sandbox: true, egress: true, readOnlyMount: true });
    const wrapped = await w.wrap({ ...SPAWN, cwd: process.cwd(), egress: ["api.linear.app"] });
    try {
      expect(wrapped.command).toBe("/opt/srt");
      const [flag, settingsPath, sep, ...rest] = wrapped.args;
      expect(flag).toBe("--settings");
      expect(sep).toBe("--");
      expect(rest).toEqual(["/bin/agent", "--rpc"]);
      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      expect(settings.network.allowedDomains).toEqual(["api.linear.app"]);
      expect(settings.filesystem.allowWrite).toContain(wrapped.home);
      expect(settings.filesystem.denyRead).toContain(path.dirname(path.dirname(wrapped.home)));
      expect(settings.filesystem.allowRead).toEqual([wrapped.home]);
      expect(wrapped.env.HOME).toBe(wrapped.home);
      expect(existsSync(wrapped.home)).toBe(true);
    } finally {
      await wrapped.cleanup();
      await wrapped.cleanup(); // idempotent
    }
    expect(existsSync(wrapped.home)).toBe(false);
  });

  it("keeps custom scratch parents and siblings when cleaning up a run", async () => {
    const scratchRoot = await mkdtemp(path.join(tmpdir(), "sweny-scratch-parent-"));
    const sentinel = path.join(scratchRoot, "caller-owned.txt");
    await writeFile(sentinel, "keep");
    try {
      const w = new SrtSandboxWrapper({ srtPath: "/opt/srt", scratchRoot });
      const first = await w.wrap({ ...SPAWN, cwd: process.cwd(), egress: [] });
      try {
        const second = await w.wrap({ ...SPAWN, cwd: process.cwd(), egress: [] });
        try {
          const isolationRoot = path.join(realpathSync(scratchRoot), `sweny-sandbox-${process.getuid?.() ?? "user"}`);
          expect(path.dirname(path.dirname(first.home))).toBe(isolationRoot);
          expect(path.dirname(path.dirname(second.home))).toBe(isolationRoot);
          expect(first.home).not.toBe(second.home);
          await first.cleanup();
          await first.cleanup();
          expect(existsSync(first.home)).toBe(false);
          expect(existsSync(second.home)).toBe(true);
          expect(await readFile(sentinel, "utf8")).toBe("keep");
        } finally {
          await second.cleanup();
        }
      } finally {
        await first.cleanup();
      }
      expect(existsSync(scratchRoot)).toBe(true);
    } finally {
      await rm(scratchRoot, { recursive: true, force: true });
    }
  });
});

describe("detectSandboxWrapper", () => {
  const ok = async () => undefined;

  it("unsupported platform", async () => {
    const d = await detectSandboxWrapper({ platform: "win32", probe: ok });
    expect(d.wrapper).toBeUndefined();
    expect(d.reason).toMatch(/win32/);
  });

  it("srt not on PATH names the install", async () => {
    const d = await detectSandboxWrapper({ platform: "linux", env: { PATH: "/a:/b" }, exists: () => false, probe: ok });
    expect(d.wrapper).toBeUndefined();
    expect(d.reason).toMatch(/npm i -g @anthropic-ai\/sandbox-runtime/);
    expect(d.reason).toMatch(/bubblewrap socat ripgrep/);
  });

  it("SWENY_SRT_PATH must exist", async () => {
    const d = await detectSandboxWrapper({
      platform: "darwin",
      env: { SWENY_SRT_PATH: "/nope/srt" },
      exists: () => false,
      probe: ok,
    });
    expect(d.reason).toMatch(/SWENY_SRT_PATH/);
  });

  it("a failing functional probe is the reason", async () => {
    const d = await detectSandboxWrapper({
      platform: "linux",
      env: { PATH: "/a" },
      exists: (p) => p === path.join("/a", "srt"),
      probe: async () => "srt cannot sandbox on this host (setting up uid map: Permission denied)",
    });
    expect(d.wrapper).toBeUndefined();
    expect(d.reason).toMatch(/uid map/);
  });

  it("finds srt on PATH and probes that exact binary", async () => {
    const probed: string[] = [];
    const d = await detectSandboxWrapper({
      platform: "linux",
      env: { PATH: "/a:/b" },
      exists: (p) => p === path.join("/b", "srt"),
      probe: async (p) => {
        probed.push(p);
        return undefined;
      },
    });
    expect(probed).toEqual([path.join("/b", "srt")]);
    expect(d.wrapper?.backend).toBe("srt");
    expect(d.reason).toBeUndefined();
  });
});

describe("prepareAgentSpawn", () => {
  it("a native sandbox is never wrapped", async () => {
    const rec = createRecordingWrapper();
    const p = await prepareAgentSpawn({
      caps: CLAUDE_CODE_CAPABILITIES,
      policy: policy({ sandbox: "strict" }),
      wrapper: rec,
      spawn: SPAWN,
      env: {},
    });
    expect(p).toMatchObject({ degraded: [], spawn: SPAWN });
    expect(p.refuse).toBeUndefined();
    expect(p.wrappedBy).toBeUndefined();
    expect(rec.requests).toHaveLength(0);
  });

  it("sandbox off: unwrapped, and only the egress gap is reported (unchanged behavior)", async () => {
    const rec = createRecordingWrapper();
    const p = await prepareAgentSpawn({
      caps: WEAK,
      policy: policy({ sandbox: "off" }),
      wrapper: rec,
      spawn: SPAWN,
      env: {},
    });
    expect(p.spawn).toBe(SPAWN);
    expect(p.refuse).toBeUndefined();
    expect(rec.requests).toHaveLength(0);
    expect(p.degraded.some((d) => /^sandbox/.test(d))).toBe(false);
  });

  it("mode defaults from SWENY_SANDBOX: auto in CI, off locally", async () => {
    const ci = await prepareAgentSpawn({
      caps: WEAK,
      policy: policy(),
      wrapper: null,
      spawn: SPAWN,
      env: { CI: "true" },
    });
    expect(ci.degraded.some((d) => /^sandbox/.test(d))).toBe(true);
    expect(ci.refuse).toBeUndefined();
    const local = await prepareAgentSpawn({ caps: WEAK, policy: policy(), wrapper: null, spawn: SPAWN, env: {} });
    expect(local.degraded.some((d) => /^sandbox/.test(d))).toBe(false);
    const strict = await prepareAgentSpawn({
      caps: WEAK,
      policy: policy(),
      wrapper: null,
      spawn: SPAWN,
      env: { SWENY_SANDBOX: "strict" },
    });
    expect(strict.refuse).toMatch(/sandbox/);
  });

  it("strict without a wrapper refuses and spawns nothing", async () => {
    const p = await prepareAgentSpawn({
      caps: WEAK,
      policy: policy({ sandbox: "strict" }),
      wrapper: null,
      spawn: SPAWN,
      env: {},
    });
    expect(p.refuse).toMatch(/strict sandbox \(SWENY_SANDBOX=strict\)/);
    expect(p.refuse).toMatch(/npm i -g @anthropic-ai\/sandbox-runtime/);
    await p.cleanup();
  });

  it("auto without a wrapper runs unwrapped and reports the gap", async () => {
    const p = await prepareAgentSpawn({
      caps: WEAK,
      policy: policy({ sandbox: "auto" }),
      wrapper: null,
      spawn: SPAWN,
      env: {},
    });
    expect(p.refuse).toBeUndefined();
    expect(p.spawn).toBe(SPAWN);
    expect(p.degraded).toEqual([
      "egress allowlist: harness has no network sandbox and no egress wrapper is active",
      "sandbox: harness has no native fs and network sandbox and no process sandbox wrapper is available",
    ]);
  });

  it("with a wrapper: wrapped, full egress list, read-only passed, nothing degraded", async () => {
    const rec = createRecordingWrapper();
    const p = await prepareAgentSpawn({
      caps: WEAK,
      policy: policy({ sandbox: "strict", readOnly: true }),
      wrapper: rec,
      spawn: SPAWN,
      harnessEgress: ["api.openai.com"],
      env: { SWENY_SANDBOX_ALLOWED_DOMAINS: "registry.internal.test" },
    });
    expect(p.refuse).toBeUndefined();
    expect(p.degraded).toEqual([]);
    expect(p.wrappedBy).toBe("srt");
    expect(rec.requests).toHaveLength(1);
    const q = rec.requests[0];
    expect(q.readOnly).toBe(true);
    expect(q.command).toBe("/bin/agent");
    for (const d of [...DEFAULT_SANDBOX_DOMAINS, "api.linear.app", "registry.internal.test", "api.openai.com"]) {
      expect(q.egress).toContain(d);
    }
    expect(p.spawn.env.SWENY_TEST_SANDBOX_WRAPPED).toBe(rec.id);
    await p.cleanup();
    expect(rec.cleanups).toBe(1);
  });
});
