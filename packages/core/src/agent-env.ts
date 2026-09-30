/**
 * Agent execution floor: scoped environment + SDK sandbox settings.
 *
 * Threat: the Claude Code subprocess runs model-chosen shell commands over
 * attacker-influenceable input (issue bodies, alerts, fetched pages). Before
 * this module it inherited the full `process.env` (every CI secret) and ran
 * Bash with unrestricted network egress. Two controls live here:
 *
 *  1. {@link buildAgentEnv}: the subprocess env is an allowlist, not a copy.
 *  2. {@link resolveAgentSandbox}: in CI the SDK `sandbox` option is enabled
 *     with a network allowlist and the agent's own credentials denied to
 *     sandboxed commands. Fails closed when the sandbox cannot start.
 *
 * Configuration (env wins over `.sweny.yml`, see `applyAgentFileConfig` in
 * cli/config-file.ts):
 *   SWENY_ENV_PASSTHROUGH          / env-passthrough          extra var names ("*" = inherit all)
 *   SWENY_SANDBOX                  / sandbox                  auto (default) | on | off
 *   SWENY_SANDBOX_ALLOWED_DOMAINS  / sandbox-allowed-domains  extra hosts for sandboxed commands
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { SandboxSettings } from "@anthropic-ai/claude-agent-sdk";
import type { Logger, Skill } from "./types.js";

// ─── Scoped env ──────────────────────────────────────────────────

/**
 * Exact variable names always passed to the agent subprocess.
 *
 * Process basics (PATH, HOME, shell, temp), locale/TZ, proxy + CA settings
 * (corporate egress), CI identity vars (no tokens), and Claude Code runtime
 * knobs. Credentials are NOT in this list except via the ANTHROPIC_/CLAUDE_
 * prefixes below, which the agent needs to authenticate at all.
 */
export const AGENT_ENV_ALLOWLIST: readonly string[] = [
  // process basics
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  // Windows process basics
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  // locale / time
  "LANG",
  "LANGUAGE",
  "TZ",
  // proxy + TLS trust
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // CI identity (never tokens)
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_OWNER",
  "GITHUB_WORKSPACE",
  "GITHUB_SHA",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_HEAD_REF",
  "GITHUB_BASE_REF",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_NUMBER",
  "GITHUB_SERVER_URL",
  "GITHUB_API_URL",
  "GITHUB_EVENT_NAME",
  "RUNNER_OS",
  "RUNNER_TEMP",
  "GITLAB_CI",
  "CI_PROJECT_DIR",
  "CI_COMMIT_SHA",
  "BUILDKITE",
  "CIRCLECI",
  "JENKINS_URL",
  "TF_BUILD",
  // Claude Code runtime knobs (not credentials)
  "MAX_THINKING_TOKENS",
  "MCP_TIMEOUT",
  "MCP_TOOL_TIMEOUT",
  "BASH_DEFAULT_TIMEOUT_MS",
  "BASH_MAX_TIMEOUT_MS",
  "DISABLE_TELEMETRY",
  "DISABLE_AUTOUPDATER",
  "DISABLE_ERROR_REPORTING",
  "DISABLE_NON_ESSENTIAL_MODEL_CALLS",
];

/**
 * Prefixes always passed: locale (`LC_*`) and the agent's own backend config
 * (`ANTHROPIC_*` incl. API key / auth token / base URL, `CLAUDE_*` incl.
 * `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CONFIG_DIR`).
 */
export const AGENT_ENV_PREFIXES: readonly string[] = ["LC_", "ANTHROPIC_", "CLAUDE_"];

/** Cloud-provider vars passed only when Claude Code is routed through that provider. */
const BEDROCK_PREFIXES = ["AWS_"];
const VERTEX_VARS = ["GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_ML_REGION", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"];

/** The agent's own credentials. Needed by Claude Code, never by the commands it runs. */
export const AGENT_AUTH_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
];

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "false" && s !== "no" && s !== "off";
}

/** Split a comma/whitespace separated list, dropping empties. */
export function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface BuildAgentEnvOpts {
  /** Per-call names to include (a node's declared skill env vars). */
  extraVars?: readonly string[];
  /** Operator passthrough list (`env-passthrough`). `"*"` inherits everything. */
  passthrough?: readonly string[];
  logger?: Pick<Logger, "warn">;
}

/**
 * Build the agent subprocess env from `source` using the allowlist.
 *
 * Kept: {@link AGENT_ENV_ALLOWLIST}, {@link AGENT_ENV_PREFIXES}, `AWS_*` when
 * `CLAUDE_CODE_USE_BEDROCK` is set, Vertex vars when `CLAUDE_CODE_USE_VERTEX`
 * is set, `extraVars`, and `passthrough`. Everything else is dropped. Nullish
 * values are always dropped. Pure: never mutates `source`.
 */
export function buildAgentEnv(
  source: Record<string, string | undefined>,
  opts: BuildAgentEnvOpts = {},
): Record<string, string> {
  const passthrough = opts.passthrough ?? [];
  if (passthrough.includes("*")) {
    opts.logger?.warn(
      "[sweny] env-passthrough contains '*': the agent inherits the full environment, including every secret.",
    );
    return Object.fromEntries(Object.entries(source).filter((e): e is [string, string] => e[1] != null));
  }

  const exact = new Set<string>([...AGENT_ENV_ALLOWLIST, ...(opts.extraVars ?? []), ...passthrough]);
  const prefixes = [...AGENT_ENV_PREFIXES];
  if (truthy(source.CLAUDE_CODE_USE_BEDROCK)) prefixes.push(...BEDROCK_PREFIXES);
  if (truthy(source.CLAUDE_CODE_USE_VERTEX)) for (const v of VERTEX_VARS) exact.add(v);

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v == null) continue;
    if (exact.has(k) || prefixes.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}

// ─── Per-node access (env vars + network) ────────────────────────

/** What one node's agent call may see: env var names and network hosts. */
export interface AgentAccess {
  envVars: string[];
  domains: string[];
}

/** Hosts reachable by sandboxed commands in every node: source hosting + package registries. */
export const DEFAULT_SANDBOX_DOMAINS: readonly string[] = [
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "uploads.github.com",
  "*.githubusercontent.com",
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "proxy.golang.org",
  "sum.golang.org",
  "crates.io",
  "static.crates.io",
  "index.crates.io",
  "rubygems.org",
];

/** Provider hosts added when a node references the built-in skill. */
export const SKILL_SANDBOX_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  github: ["github.com", "api.github.com", "uploads.github.com", "*.githubusercontent.com"],
  linear: ["api.linear.app", "mcp.linear.app"],
  sentry: ["sentry.io", "*.sentry.io"],
  datadog: ["*.datadoghq.com", "*.datadoghq.eu", "*.ddog-gov.com"],
  betterstack: ["*.betterstack.com", "*.betterstackdata.com"],
  slack: ["slack.com", "*.slack.com"],
  supabase: ["*.supabase.co"],
  gitlab: ["gitlab.com"],
};

/**
 * Resolve a node's access from its `skills:` list: every env var named by a
 * referenced skill's config fields, plus that skill's provider hosts.
 * Unknown skill ids contribute nothing (the executor validates them).
 */
export function resolveAgentAccess(skillIds: readonly string[], skills: Map<string, Skill>): AgentAccess {
  const envVars = new Set<string>();
  const domains = new Set<string>();
  for (const id of skillIds) {
    const skill = skills.get(id);
    for (const field of Object.values(skill?.config ?? {})) {
      if (field.env) envVars.add(field.env);
    }
    for (const d of SKILL_SANDBOX_DOMAINS[id] ?? []) domains.add(d);
  }
  return { envVars: [...envVars], domains: [...domains] };
}

// ─── SDK sandbox ─────────────────────────────────────────────────

export type SandboxMode = "auto" | "on" | "off";

/**
 * Decide whether the sandbox is on. `SWENY_SANDBOX` (or the explicit
 * `mode`): `on`/`off` force it; `auto` (default) turns it on when `CI` is
 * truthy, so CI gets the strict default and local runs keep full access to
 * the developer's machine.
 */
export function resolveSandboxMode(
  env: Record<string, string | undefined>,
  mode?: SandboxMode,
  logger?: Pick<Logger, "warn">,
): { mode: SandboxMode; enabled: boolean } {
  let m: SandboxMode = "auto";
  const raw = (mode ?? env.SWENY_SANDBOX ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "true" || raw === "1") m = "on";
  else if (raw === "off" || raw === "false" || raw === "0") m = "off";
  else if (raw === "auto" || raw === "") m = "auto";
  else logger?.warn(`SWENY_SANDBOX="${raw}" is not one of auto|on|off; using auto`);
  const enabled = m === "on" || (m === "auto" && truthy(env.CI));
  return { mode: m, enabled };
}

/**
 * Probe whether the SDK sandbox can start on this host. Returns a reason
 * string when it cannot, undefined when it looks supported.
 *
 * macOS uses the built-in `sandbox-exec`. Linux needs `bwrap` (bubblewrap)
 * and `socat` on PATH. Anything else is unsupported. This is a preflight:
 * the SDK is also told `failIfUnavailable: true`, so a host that passes this
 * check but still cannot start the sandbox fails in the SDK, not open.
 */
export function checkSandboxSupport(
  platform: NodeJS.Platform = process.platform,
  pathEnv: string = process.env.PATH ?? "",
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  if (platform === "darwin") return undefined;
  if (platform !== "linux") return `the Claude Code sandbox does not support platform "${platform}"`;
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const missing = ["bwrap", "socat"].filter((bin) => !dirs.some((d) => exists(path.join(d, bin))));
  if (missing.length > 0) {
    return `missing ${missing.join(" and ")} on PATH (install: apt-get install -y bubblewrap socat)`;
  }
  return undefined;
}

/**
 * The SDK sandbox settings used when the sandbox is on.
 *
 * - `failIfUnavailable: true`: the SDK errors instead of running unsandboxed.
 * - `allowUnsandboxedCommands: false`: the model cannot escape via the
 *   `dangerouslyDisableSandbox` parameter. Required, because nodes run under
 *   `bypassPermissions` (#365) which would otherwise auto-approve the escape.
 * - `network.allowedDomains` + `strictAllowlist`: non-listed hosts are denied
 *   deterministically rather than prompted (no prompt exists headless).
 * - `credentials`: the agent's own Anthropic credentials are unset for
 *   sandboxed commands, and the Claude Code credentials file is unreadable.
 */
export function buildSandboxSettings(domains: readonly string[], home: string = homedir()): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: {
      allowedDomains: [...new Set(domains)],
      strictAllowlist: true,
    },
    credentials: {
      envVars: AGENT_AUTH_VARS.map((name) => ({ name, mode: "deny" as const })),
      files: [{ path: path.join(home, ".claude", ".credentials.json"), mode: "deny" as const }],
    },
  };
}

export interface ResolveAgentSandboxOpts {
  env: Record<string, string | undefined>;
  /** Explicit mode (client option); falls back to `env.SWENY_SANDBOX`. */
  mode?: SandboxMode;
  /** Explicit extra hosts (client option); falls back to `env.SWENY_SANDBOX_ALLOWED_DOMAINS`. */
  allowedDomains?: readonly string[];
  /** Per-node hosts from {@link resolveAgentAccess}. */
  nodeDomains?: readonly string[];
  /** Preflight probe; test seam. Defaults to {@link checkSandboxSupport}. */
  probe?: () => string | undefined;
  logger?: Pick<Logger, "warn">;
}

/**
 * Resolve the `sandbox` query option for one agent call.
 *
 * Returns `{}` when the sandbox is off, `{ settings }` when on, and
 * `{ error }` when it is on but the host cannot run it. Callers must fail the
 * call on `error` (fail closed), never fall back to running unsandboxed.
 */
export function resolveAgentSandbox(opts: ResolveAgentSandboxOpts): { settings?: SandboxSettings; error?: string } {
  const { enabled, mode } = resolveSandboxMode(opts.env, opts.mode, opts.logger);
  if (!enabled) return {};

  const reason = (opts.probe ?? (() => checkSandboxSupport()))();
  if (reason) {
    const why = mode === "on" ? "sandbox is set to on" : "running in CI (CI=true)";
    return {
      error:
        `Agent sandbox is required (${why}) but unavailable: ${reason}. ` +
        `Refusing to run the agent unsandboxed. To opt out, set SWENY_SANDBOX=off ` +
        `(or \`sandbox: off\` in .sweny.yml).`,
    };
  }

  const extra = opts.allowedDomains ?? parseList(opts.env.SWENY_SANDBOX_ALLOWED_DOMAINS);
  return { settings: buildSandboxSettings([...DEFAULT_SANDBOX_DOMAINS, ...(opts.nodeDomains ?? []), ...extra]) };
}
