/**
 * Harness-agnostic process sandbox (#360 step 2): the W column in
 * research/2026-09-30-sota/harness-design.md, section 3.
 *
 * Claude Code sandboxes its own shell commands (the SDK `sandbox` option, step
 * 1). pi, ACP agents and any other harness without a native sandbox run their
 * whole agent process through a {@link SandboxWrapper} instead:
 *
 *   const prep = await prepareAgentSpawn({ caps, policy, wrapper, spawn: { command, args, env, cwd } });
 *   if (prep.refuse) return failed(prep.refuse);
 *   const child = spawn(prep.spawn.command, prep.spawn.args, { cwd: prep.spawn.cwd, env: prep.spawn.env });
 *   ... finally await prep.cleanup();
 *
 * The wrapped process gets:
 * - network: only the node's egress allowlist (the same hosts the SDK sandbox
 *   gets: defaults, the node's skill hosts, `SWENY_SANDBOX_ALLOWED_DOMAINS`, and
 *   the adapter's own backend hosts), through srt's filtering proxy. On Linux
 *   the process has no network namespace of its own, so nothing reaches the
 *   host network except through that proxy.
 * - filesystem: the workspace (cwd) and a scratch HOME are writable; the rest
 *   of the filesystem is read-only; the operator's credential files are
 *   unreadable. Sibling homes under the same configured scratch root are
 *   hidden; only this run's HOME is exposed. Dry runs (`readOnly`) leave the
 *   workspace read-only too. All concurrent credential-bearing adapters must
 *   use the same scratch root; different roots are not mutually isolated.
 * - env: exactly the env the adapter passes (already scoped by agent-env.ts),
 *   with HOME, XDG dirs and TMPDIR pointed into the scratch HOME. On Linux the
 *   process also gets its own PID namespace, so it cannot read another
 *   process's environment through /proc.
 *
 * Backend: `@anthropic-ai/sandbox-runtime` (the `srt` CLI), which wraps an
 * arbitrary argv command with bubblewrap on Linux and sandbox-exec on macOS
 * (probed in CI, `sandbox-wrapper` job). It is a host dependency, like bwrap and
 * socat for step 1: install it with `npm i -g @anthropic-ai/sandbox-runtime`, or
 * point `SWENY_SRT_PATH` at the binary. Linux also needs bubblewrap, socat and
 * ripgrep, and unprivileged user namespaces (Ubuntu 23.10+:
 * `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`).
 *
 * Modes are the step 1 modes, unchanged (`SWENY_SANDBOX`, default `auto` in CI
 * and `off` locally): `off` never wraps; `auto` wraps when a wrapper is
 * available and otherwise degrades with a warning; `strict` refuses the node
 * when the harness has no native sandbox and no wrapper is available.
 */

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { DEFAULT_SANDBOX_DOMAINS, parseList, resolveSandboxMode, type SandboxMode } from "../agent-env.js";
import { JOURNAL_DIR, runKeyDir } from "../journal.js";
import { policyGate } from "./policy.js";
import type { HarnessCapabilities, NodePolicy, PolicyWrappers } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────

/** What an adapter would spawn without a sandbox. */
export interface AgentSpawn {
  command: string;
  args: string[];
  /** Already scoped (agent-env.ts); the adapter adds only its own auth vars. */
  env: Record<string, string>;
  cwd: string;
}

export interface SandboxWrapRequest extends AgentSpawn {
  /** Hosts the process may reach. Everything else is refused. */
  egress: readonly string[];
  /** Dry run: the workspace is read-only too (only the scratch HOME is writable). */
  readOnly?: boolean;
}

/** The spawn to run instead, plus the scratch it owns. */
export interface WrappedSpawn extends AgentSpawn {
  /** Scratch HOME. Adapters sharing one scratch root may copy scoped auth/config here before spawning. */
  home: string;
  /** Remove the scratch HOME and the sandbox settings. Idempotent. */
  cleanup(): Promise<void>;
}

export interface SandboxWrapper {
  /** Backend id, for logs and run receipts. */
  readonly backend: "srt";
  /** The opinions this wrapper enforces, handed to {@link policyGate}. */
  readonly provides: Required<PolicyWrappers>;
  wrap(req: SandboxWrapRequest): Promise<WrappedSpawn>;
}

// ─── srt settings ────────────────────────────────────────────────

/**
 * Operator credential files and dirs (relative to the real HOME) that a wrapped
 * agent must never read, even though the rest of the filesystem stays readable
 * so toolchains keep working.
 */
export const CREDENTIAL_PATHS: readonly string[] = [
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".kube",
  ".docker/config.json",
  ".config/gcloud",
  ".config/gh",
  ".config/hub",
  ".netrc",
  ".git-credentials",
  ".npmrc",
  ".pypirc",
  ".cargo/credentials",
  ".cargo/credentials.toml",
  ".claude/.credentials.json",
  ".codex/auth.json",
];

/** srt settings file shape (the subset sweny writes). */
export interface SrtSettings {
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
    strictAllowlist: true;
    allowLocalBinding: false;
  };
  filesystem: {
    denyRead: string[];
    allowRead: string[];
    allowWrite: string[];
    denyWrite: string[];
  };
}

/**
 * srt rejects a whole settings file over one bad domain entry, so sweny keeps
 * only entries srt accepts: a host (`example.com`), a `*.` wildcard with at
 * least two labels, `localhost`, an IPv4 literal, or a bracketed IPv6 literal,
 * each with an optional `:port`. Dropping an entry only narrows egress.
 */
export function isSrtDomainPattern(entry: string): boolean {
  let host = entry;
  const v6 = /^\[([0-9a-fA-F:.]+)\](?::([1-9][0-9]{0,4}))?$/.exec(entry);
  if (v6) return !v6[2] || Number(v6[2]) <= 65535;
  const m = /^(.*?)(?::([1-9][0-9]{0,4}))?$/.exec(entry);
  if (!m) return false;
  if (m[2] && Number(m[2]) > 65535) return false;
  host = m[1];
  if (host === "localhost") return true;
  if (/[\s/:@]/.test(host) || host.length === 0) return false;
  if (host.startsWith("*.")) {
    const labels = host.slice(2).split(".");
    return labels.length >= 2 && labels.every((l) => /^[A-Za-z0-9-]+$/.test(l));
  }
  if (host.includes("*")) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((l) => /^[A-Za-z0-9-]+$/.test(l));
}

/** Resolve symlinks when the path exists (macOS /var is /private/var), else keep it. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * The srt settings for one wrapped spawn. Pure apart from `exists`.
 * `credentialHome` is the operator's real HOME (not the scratch HOME).
 */
export function buildSrtSettings(
  req: Pick<SandboxWrapRequest, "cwd" | "egress" | "readOnly">,
  opts: {
    home: string;
    credentialHome: string;
    exists?: (p: string) => boolean;
    credentialPaths?: readonly string[];
    /** Shared wrapper storage to hide, with only `home` re-exposed. */
    isolationRoot?: string;
  },
): SrtSettings {
  const exists = opts.exists ?? existsSync;
  const allowedDomains = [...new Set(req.egress.map((d) => d.trim()).filter(isSrtDomainPattern))];
  const denyRead = (opts.credentialPaths ?? CREDENTIAL_PATHS)
    .map((rel) => (path.isAbsolute(rel) ? rel : path.join(opts.credentialHome, rel)))
    .filter((p) => exists(p));
  // Deny the parent, not a snapshot of sibling homes: later-created runs
  // must stay hidden too. srt allowRead carves out only our own HOME.
  if (opts.isolationRoot) denyRead.push(opts.isolationRoot);
  // Run journal keys (outside the workspace) are never readable by the agent,
  // and the journals themselves are not writable.
  const keyDir = runKeyDir();
  if (exists(keyDir)) denyRead.push(keyDir);
  const journals = path.join(real(req.cwd), JOURNAL_DIR);
  const denyWrite = !req.readOnly && exists(journals) ? [journals] : [];
  const allowWrite = req.readOnly ? [opts.home] : [real(req.cwd), opts.home];
  return {
    network: { allowedDomains, deniedDomains: [], strictAllowlist: true, allowLocalBinding: false },
    filesystem: { denyRead, allowRead: opts.isolationRoot ? [opts.home] : [], allowWrite, denyWrite },
  };
}

/** Env for the wrapped process: the adapter's env with HOME, XDG and temp dirs moved into the scratch HOME. */
export function scratchEnv(env: Record<string, string>, home: string): Record<string, string> {
  const tmp = path.join(home, "tmp");
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    TMPDIR: tmp,
    // srt points TMPDIR at this for the wrapped command (default /tmp/claude, shared across runs).
    CLAUDE_CODE_TMPDIR: tmp,
  };
}

// ─── srt backend ─────────────────────────────────────────────────

export interface SrtWrapperOptions {
  /** Path to the `srt` binary. */
  srtPath: string;
  /** Operator HOME whose credential files are denied. Default: `os.homedir()`. */
  credentialHome?: string;
  /** Override {@link CREDENTIAL_PATHS} (relative to `credentialHome`, or absolute). */
  credentialPaths?: readonly string[];
  /**
   * Storage parent, default `os.tmpdir()`. Runs share a per-user child under
   * this directory, hidden except for their own HOME. Concurrent adapters
   * carrying credentials must use the same parent; separate roots are not
   * mutually isolated. The existing parent is never removed. Its canonical
   * hierarchy must be owned by this user or root; other-writable ancestors
   * must be sticky (like /tmp). The shared child must be private and owned
   * by this user. Unsafe existing paths are rejected, never repaired.
   */
  scratchRoot?: string;
}

export class SrtSandboxWrapper implements SandboxWrapper {
  readonly backend = "srt" as const;
  readonly provides: Required<PolicyWrappers> = { sandbox: true, egress: true, readOnlyMount: true };

  constructor(private readonly opts: SrtWrapperOptions) {}

  async wrap(req: SandboxWrapRequest): Promise<WrappedSpawn> {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("Cannot validate sandbox scratch ownership on this platform");
    const storageParent = await realpath(this.opts.scratchRoot ?? tmpdir());
    // A private child can still be renamed by another user through a writable
    // ancestor. Check the canonical hierarchy before accepting any run paths.
    for (let ancestor = storageParent; ; ancestor = path.dirname(ancestor)) {
      const info = await lstat(ancestor);
      if (
        !info.isDirectory() ||
        (info.uid !== uid && info.uid !== 0) ||
        ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0)
      ) {
        throw new Error(`Unsafe sandbox scratch ancestor: ${ancestor}`);
      }
      if (ancestor === path.dirname(ancestor)) break;
    }
    // Keep these components short: srt creates Unix sockets beneath HOME/tmp,
    // and Linux socket paths must fit in 107 bytes (including caller parents).
    const isolationRoot = path.join(storageParent, `sweny-${uid}`);
    try {
      await mkdir(isolationRoot, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // Never adopt a symlink, a foreign-owned directory, or a directory other
    // users can access. Validate newly created paths too; do not chmod them.
    const info = await lstat(isolationRoot);
    if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) {
      throw new Error(`Unsafe sandbox scratch directory: ${isolationRoot}`);
    }
    const dir = await mkdtemp(path.join(isolationRoot, "r-"));
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(dir, { recursive: true, force: true });
    };
    try {
      const home = path.join(dir, "home");
      await mkdir(path.join(home, "tmp"), { recursive: true });
      const settings = buildSrtSettings(req, {
        home,
        credentialHome: this.opts.credentialHome ?? homedir(),
        credentialPaths: this.opts.credentialPaths,
        isolationRoot,
      });
      const settingsPath = path.join(dir, "srt-settings.json");
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
      return {
        command: this.opts.srtPath,
        args: ["--settings", settingsPath, "--", req.command, ...req.args],
        env: scratchEnv(req.env, home),
        cwd: req.cwd,
        home,
        cleanup,
      };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }
}

// ─── Detection ───────────────────────────────────────────────────

export interface SandboxWrapperDetection {
  wrapper?: SandboxWrapper;
  /** Why no wrapper is available (absent when `wrapper` is set). */
  reason?: string;
}

/** Find an executable on PATH. */
function which(bin: string, pathEnv: string, exists: (p: string) => boolean): string | undefined {
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, bin);
    if (exists(p)) return p;
  }
  return undefined;
}

/** Run `srt` on `true` with no network and no writes: can it actually sandbox on this host? */
async function srtWorks(srtPath: string, env: Record<string, string | undefined>): Promise<string | undefined> {
  const dir = await mkdtemp(path.join(real(tmpdir()), "sweny-sbx-probe-"));
  try {
    const settings = path.join(dir, "srt-settings.json");
    const s: SrtSettings = {
      network: { allowedDomains: [], deniedDomains: [], strictAllowlist: true, allowLocalBinding: false },
      filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
    };
    await writeFile(settings, JSON.stringify(s));
    return await new Promise<string | undefined>((resolve) => {
      execFile(
        srtPath,
        ["--settings", settings, "--", "true"],
        { env: { PATH: env.PATH ?? "", HOME: dir }, timeout: 30_000 },
        (err, _stdout, stderr) => {
          if (!err) return resolve(undefined);
          const first =
            String(stderr || err.message)
              .trim()
              .split("\n")[0] || "unknown error";
          const userns = /user namespace|uid map|setting up uid|Operation not permitted|Permission denied/i.test(
            String(stderr),
          );
          resolve(
            `srt cannot sandbox on this host (${first})` +
              (userns
                ? "; unprivileged user namespaces look restricted (Ubuntu 23.10+: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0)"
                : ""),
          );
        },
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface DetectSandboxWrapperOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  /** Functional check; test seam. Default: run `srt` on `true`. */
  probe?: (srtPath: string) => Promise<string | undefined>;
  /** Options for the wrapper when one is found. */
  wrapper?: Omit<SrtWrapperOptions, "srtPath">;
}

/**
 * Find a working process wrapper on this host. `SWENY_SRT_PATH` names the
 * `srt` binary; otherwise `srt` is looked up on PATH. The binary is then run
 * once on `true` to prove it can sandbox here (bubblewrap may be missing, or
 * user namespaces restricted). Only macOS and Linux are supported.
 */
export async function detectSandboxWrapper(opts: DetectSandboxWrapperOptions = {}): Promise<SandboxWrapperDetection> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  if (platform !== "linux" && platform !== "darwin") {
    return { reason: `the process sandbox does not support platform "${platform}"` };
  }
  const explicit = env.SWENY_SRT_PATH?.trim();
  const srtPath = explicit || which("srt", env.PATH ?? "", exists);
  if (!srtPath) {
    return {
      reason:
        "srt (@anthropic-ai/sandbox-runtime) is not on PATH " +
        "(install: npm i -g @anthropic-ai/sandbox-runtime" +
        (platform === "linux" ? "; plus sudo apt-get install -y bubblewrap socat ripgrep" : "") +
        "; or set SWENY_SRT_PATH)",
    };
  }
  if (explicit && !exists(srtPath)) return { reason: `SWENY_SRT_PATH=${srtPath} does not exist` };
  const reason = await (opts.probe ?? ((p: string) => srtWorks(p, env)))(srtPath);
  if (reason) return { reason };
  return { wrapper: new SrtSandboxWrapper({ srtPath, ...opts.wrapper }) };
}

let cachedDetection: Promise<SandboxWrapperDetection> | undefined;

/** {@link detectSandboxWrapper} for this host, computed once per process. */
export function defaultSandboxWrapper(): Promise<SandboxWrapperDetection> {
  cachedDetection ??= detectSandboxWrapper();
  return cachedDetection;
}

/** Test seam: forget the cached host detection. */
export function resetSandboxWrapperCache(): void {
  cachedDetection = undefined;
}

/** The {@link PolicyWrappers} a (possibly absent) wrapper provides. */
export function wrappersFrom(wrapper: SandboxWrapper | null | undefined): PolicyWrappers {
  return wrapper ? { ...wrapper.provides } : {};
}

// ─── Adapter entry point ─────────────────────────────────────────

export interface PrepareAgentSpawnOptions {
  caps: HarnessCapabilities;
  policy: NodePolicy;
  spawn: AgentSpawn;
  /**
   * The host's wrapper. `undefined` = detect once per process
   * ({@link defaultSandboxWrapper}); `null` = none available.
   */
  wrapper?: SandboxWrapper | null;
  /** The adapter's own backend hosts (its model API), always allowed. */
  harnessEgress?: readonly string[];
  /** Sandbox mode when `policy.sandbox` is unset. Default: `SWENY_SANDBOX` via {@link resolveSandboxMode}. */
  env?: Record<string, string | undefined>;
}

export interface PreparedAgentSpawn {
  /** Set when the node must not run. The adapter fails the node with this message. */
  refuse?: string;
  /** Opinions this run cannot honor (for `HarnessRunResult.degraded`). */
  degraded: string[];
  /** What to spawn: the wrapped command, or the original when no wrapping is needed or possible. */
  spawn: AgentSpawn;
  /** The wrapper backend in use, if the spawn was wrapped. */
  wrappedBy?: SandboxWrapper["backend"];
  /** Scratch HOME of the wrapped spawn; write generated config here before spawning. */
  home?: string;
  /** Release scratch. Call after the process exits, on every path. Idempotent. */
  cleanup(): Promise<void>;
}

/**
 * Gate and wrap one agent process. Runs {@link policyGate} with whatever the
 * host's wrapper provides, then:
 * - refuse: returns `{ refuse }` and spawns nothing;
 * - harness has a native fs + network sandbox, or sandbox mode is `off`: the
 *   original spawn, unwrapped;
 * - otherwise, with a wrapper: the wrapped spawn (egress = defaults + node
 *   hosts + `SWENY_SANDBOX_ALLOWED_DOMAINS` + the adapter's backend hosts);
 * - otherwise (`auto`, no wrapper): the original spawn, with the gap in `degraded`.
 */
export async function prepareAgentSpawn(opts: PrepareAgentSpawnOptions): Promise<PreparedAgentSpawn> {
  const env = opts.env ?? process.env;
  const mode: SandboxMode = opts.policy.sandbox ?? resolveSandboxMode(env);
  const policy: NodePolicy = { ...opts.policy, sandbox: mode };
  const native = opts.caps.sandbox.fs && opts.caps.sandbox.network;
  const needsWrapper = mode !== "off" && !native;
  const wrapper =
    opts.wrapper === null
      ? undefined
      : needsWrapper
        ? (opts.wrapper ?? (await defaultSandboxWrapper()).wrapper)
        : undefined;

  const gate = policyGate(opts.caps, policy, wrappersFrom(needsWrapper ? wrapper : undefined));
  const noop = async () => {};
  if (gate.refuse) return { refuse: gate.refuse, degraded: gate.degraded, spawn: opts.spawn, cleanup: noop };
  if (!needsWrapper || !wrapper) return { degraded: gate.degraded, spawn: opts.spawn, cleanup: noop };

  const egress = [
    ...DEFAULT_SANDBOX_DOMAINS,
    ...policy.egress,
    ...parseList(env.SWENY_SANDBOX_ALLOWED_DOMAINS),
    ...(opts.harnessEgress ?? []),
  ];
  const wrapped = await wrapper.wrap({ ...opts.spawn, egress, readOnly: policy.readOnly });
  const { home, cleanup, ...spawn } = wrapped;
  return { degraded: gate.degraded, spawn, wrappedBy: wrapper.backend, home, cleanup };
}
