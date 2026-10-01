/**
 * Agent execution floor: scoped environment + SDK sandbox settings.
 *
 * Threat: the Claude Code subprocess runs model-chosen shell commands over
 * attacker-influenceable input (issue bodies, alerts, fetched pages). Before
 * this module it inherited the full `process.env` (every CI secret) and ran
 * Bash with unrestricted network egress. Three controls live here:
 *
 *  1. {@link scopeAgentEnv}: the subprocess env is an allowlist, not a copy.
 *     On by default in CI, off locally (full env, as before); see
 *     {@link resolveEnvScope}.
 *  2. {@link withholdCredentials}: skill credentials (`GITHUB_TOKEN`,
 *     `LINEAR_API_KEY`, ...) never reach the agent on any harness, scoped or
 *     not, unless the node grants one with `agent_env`. Skill tools run in the
 *     sweny process, so the agent does not need them.
 *  3. {@link resolveAgentSandbox}: the SDK `sandbox` option is enabled with a
 *     network allowlist and the agent's own credentials denied to sandboxed
 *     commands. `auto` (default in CI) falls back to unsandboxed with one loud
 *     warning when the host cannot sandbox; `strict` fails closed.
 *
 * Configuration (env wins over `.sweny.yml`, see `applyAgentFileConfig` in
 * cli/config-file.ts):
 *   SWENY_ENV_SCOPE                / env-scope                on | off (default: on in CI, off locally)
 *   SWENY_ENV_PASSTHROUGH          / env-passthrough          extra var names ("*" = inherit all)
 *   SWENY_SANDBOX                  / sandbox                  auto | strict | off (default: auto in CI, off locally)
 *   SWENY_SANDBOX_ALLOWED_DOMAINS  / sandbox-allowed-domains  extra hosts for sandboxed commands
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import type { SandboxSettings } from "@anthropic-ai/claude-agent-sdk";
import type { Logger, Skill } from "./types.js";
import { runKeyDir } from "./journal.js";

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

/**
 * Codex's own credentials and home (openai/codex rust-v0.159.2,
 * login/src/auth/manager.rs): `codex exec` authenticates with `CODEX_API_KEY`
 * (it does not read `OPENAI_API_KEY` for this; see {@link resolveCodexAuthEnv})
 * or `CODEX_ACCESS_TOKEN`, else the login stored in `$CODEX_HOME/auth.json`.
 */
export const CODEX_AUTH_VARS: readonly string[] = ["CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "CODEX_HOME"];

/** Prefixes for a Codex run: locale only. `ANTHROPIC_*` / `CLAUDE_*` never reach Codex. */
export const CODEX_ENV_PREFIXES: readonly string[] = ["LC_"];

/**
 * `codex exec` reads `CODEX_API_KEY`, not `OPENAI_API_KEY`. Copy the OpenAI
 * key into `CODEX_API_KEY` when only the former is set, so either works.
 * Pure: returns a copy.
 */
export function resolveCodexAuthEnv(env: Record<string, string>): Record<string, string> {
  const out = { ...env };
  if (!out.CODEX_API_KEY && out.OPENAI_API_KEY) out.CODEX_API_KEY = out.OPENAI_API_KEY;
  return out;
}

/**
 * pi's provider credentials (badlogic/pi-mono v0.99.2, docs/providers.md).
 * sweny has no model opinion, so a pi run may need any provider's key; only
 * these names (never the rest of the env) reach the pi process. A stored
 * `auth.json` is not used: pi runs with a scratch `PI_CODING_AGENT_DIR`.
 */
export const PI_AUTH_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "ZAI_API_KEY",
  "ZAI_CODING_CN_API_KEY",
  "OPENCODE_API_KEY",
  "RADIUS_API_KEY",
  "TYPESAFE_API_KEY",
  "HF_TOKEN",
  "FIREWORKS_API_KEY",
  "TOGETHER_API_KEY",
  "BASETEN_API_KEY",
  "KIMI_API_KEY",
  "META_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "MOONSHOT_API_KEY",
  "NVIDIA_API_KEY",
  "ANT_LING_API_KEY",
  "QWEN_TOKEN_PLAN_API_KEY",
  "QWEN_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  "COPILOT_GITHUB_TOKEN",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_BASE_URL",
  "AZURE_OPENAI_RESOURCE_NAME",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
  "GOOGLE_CLOUD_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
];

/** Prefixes for a pi run: locale only. `ANTHROPIC_*` / `CLAUDE_*` beyond the names above never reach pi. */
export const PI_ENV_PREFIXES: readonly string[] = ["LC_"];

/**
 * pi provider id to the {@link PI_AUTH_VARS} that carry its credential and
 * settings (pi docs/providers.md, `envMap` in packages/ai/src/env-api-keys.ts).
 * A provider not listed here maps by convention to `<ID>_API_KEY` when that
 * name is in {@link PI_AUTH_VARS} (`meta` to `META_API_KEY`).
 */
export const PI_PROVIDER_VARS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  "azure-openai-responses": ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_RESOURCE_NAME"],
  google: ["GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
  "amazon-bedrock": [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
  ],
  "cloudflare-ai-gateway": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"],
  "cloudflare-workers-ai": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
  "github-copilot": ["COPILOT_GITHUB_TOKEN"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  "ant-ling": ["ANT_LING_API_KEY"],
  "zai-coding-cn": ["ZAI_CODING_CN_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  huggingface: ["HF_TOKEN"],
  "kimi-coding": ["KIMI_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  "qwen-token-plan": ["QWEN_TOKEN_PLAN_API_KEY"],
  "qwen-token-plan-individual": ["QWEN_TOKEN_PLAN_API_KEY"],
  "qwen-token-plan-cn": ["QWEN_TOKEN_PLAN_CN_API_KEY"],
  "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
  "xiaomi-token-plan-ams": ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
  "xiaomi-token-plan-sgp": ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
};

/** pi settings that are not secrets: their presence alone never selects a provider. */
const PI_NON_SECRET_VARS: ReadonlySet<string> = new Set([
  "AZURE_OPENAI_BASE_URL",
  "AZURE_OPENAI_RESOURCE_NAME",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
]);

/** The {@link PI_AUTH_VARS} names for one pi provider id (empty for a custom `models.json` provider). */
export function piProviderVars(provider: string): string[] {
  const id = provider.trim().toLowerCase();
  const known = PI_PROVIDER_VARS[id];
  if (known) return [...known];
  const conventional = `${id.replace(/[^a-z0-9]+/g, "_").toUpperCase()}_API_KEY`;
  return PI_AUTH_VARS.includes(conventional) ? [conventional] : [];
}

/** True when `id` is a pi provider sweny knows a credential for. */
function isKnownPiProvider(id: string): boolean {
  return piProviderVars(id).length > 0;
}

export interface PiProviderResolution {
  /** The provider, when named (explicitly or by the model) or the only one with a credential set. */
  provider?: string;
  /** Whether `provider` came from `pi_provider` (so pi gets `--provider`). */
  explicit: boolean;
  /** The only {@link PI_AUTH_VARS} names that reach pi. */
  vars: string[];
  /** Set when the provider cannot be told apart; the node must not run. */
  error?: string;
}

/**
 * Which provider's credential a pi run gets (security review 2026-09-30,
 * finding 2). pi's bash tool inherits pi's env, so pi receives one provider's
 * credential, never every key in the environment.
 *
 * In order: `explicit` (`pi_provider`, `SWENY_PI_PROVIDER`); the `provider/`
 * prefix of the model when it names a provider sweny knows; else the one
 * provider whose secret is set. Several set and none named is an error that
 * asks for `pi_provider`. None set: nothing is passed (a custom provider in
 * `models.json` reads its own variables through env-passthrough).
 */
export function resolvePiProvider(
  env: Record<string, string | undefined>,
  model?: string,
  explicit?: string,
): PiProviderResolution {
  const named = (explicit ?? env.SWENY_PI_PROVIDER ?? "").trim().toLowerCase();
  const prefix = model && model.includes("/") ? model.split("/")[0].trim().toLowerCase() : "";
  const fromModel = prefix && isKnownPiProvider(prefix) ? prefix : "";
  if (named) {
    if (fromModel && fromModel !== named) {
      return {
        explicit: true,
        vars: [],
        error: `pi_provider "${named}" does not match the model "${model}" (provider "${fromModel}"); set one of them`,
      };
    }
    return { provider: named, explicit: true, vars: piProviderVars(named) };
  }
  if (fromModel) return { provider: fromModel, explicit: false, vars: piProviderVars(fromModel) };

  const set = PI_AUTH_VARS.filter((v) => !PI_NON_SECRET_VARS.has(v) && !!env[v]);
  if (set.length === 0) return { explicit: false, vars: [] };
  const groups = [
    ...Object.entries(PI_PROVIDER_VARS).map(([id, vars]) => ({ id, vars: [...vars] })),
    ...PI_AUTH_VARS.filter((v) => !Object.values(PI_PROVIDER_VARS).some((vs) => vs.includes(v))).map((v) => ({
      id: v.replace(/_API_KEY$|_TOKEN$/, "").toLowerCase(),
      vars: [v],
    })),
  ];
  const covering = groups.filter((g) => set.every((v) => g.vars.includes(v)));
  if (covering.length > 0) {
    // Several ids can share one key (opencode, opencode-go): the vars are what matter.
    const vars = [...new Set(covering.flatMap((g) => g.vars))];
    return { provider: covering.length === 1 ? covering[0].id : undefined, explicit: false, vars };
  }
  return {
    explicit: false,
    vars: [],
    error:
      `pi: credentials for several providers are set (${set.join(", ")}) and the model does not name one. ` +
      `Set SWENY_PI_PROVIDER (pi_provider) or a provider/model, so only that provider's credential reaches pi.`,
  };
}

/** A stored Codex login (`codex login`): `auth.json` under `CODEX_HOME`, default `~/.codex`. */
export function hasCodexLogin(
  env: Record<string, string | undefined> = process.env,
  exists: (p: string) => boolean = existsSync,
): boolean {
  const home = env.CODEX_HOME || path.join(homedir(), ".codex");
  return exists(path.join(home, "auth.json"));
}

export interface BuildAgentEnvOpts {
  /** Per-call names to include (a node's declared skill env vars). */
  extraVars?: readonly string[];
  /**
   * The harness's own credential names (Codex: {@link CODEX_AUTH_VARS}).
   * Default: none beyond the Claude prefixes.
   */
  authVars?: readonly string[];
  /** Prefixes always kept. Default: {@link AGENT_ENV_PREFIXES} (Claude Code's). */
  prefixes?: readonly string[];
  /** Operator passthrough list (`env-passthrough`). `"*"` inherits everything. */
  passthrough?: readonly string[];
  logger?: Pick<Logger, "warn">;
}

/**
 * Whether the agent env is scoped to the allowlist. `SWENY_ENV_SCOPE` (or the
 * explicit value) `on|true|1` / `off|false|0` wins everywhere; otherwise on
 * when `CI` is truthy and off locally, so local runs keep the full env that
 * e2e/test workflows rely on (DATABASE_URL, BASE_URL, NODE_ENV, ...).
 */
export function resolveEnvScope(
  env: Record<string, string | undefined>,
  explicit?: boolean,
  logger?: Pick<Logger, "warn">,
): boolean {
  if (explicit !== undefined) return explicit;
  const raw = (env.SWENY_ENV_SCOPE ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "true" || raw === "1") return true;
  if (raw === "off" || raw === "false" || raw === "0") return false;
  const fallback = truthy(env.CI);
  if (raw !== "") logger?.warn(`SWENY_ENV_SCOPE="${raw}" is not one of on|off; using ${fallback ? "on" : "off"}`);
  return fallback;
}

/** Max names listed in the withheld-vars warning before "and N more". */
export const WITHHELD_WARNING_CAP = 30;

/**
 * Runner baseline: exact names set by common CI images (GitHub-hosted runner
 * image, Actions runner context, Debian-based containers). They are present on
 * every run, so listing them as "withheld" is noise. Names only; none of these
 * is a credential the operator supplied. Secrets such as `GITHUB_TOKEN`,
 * `NPM_TOKEN`, or `AWS_*` are deliberately absent, so withholding them still
 * warns.
 */
export const RUNNER_BASELINE_VARS: ReadonlySet<string> = new Set([
  // image / OS
  "ImageOS",
  "ImageVersion",
  "ACCEPT_EULA",
  "DEBIAN_FRONTEND",
  "AGENT_TOOLSDIRECTORY",
  "CONDA",
  "SWIFT_PATH",
  "LEIN_HOME",
  "LEIN_JAR",
  "ANT_HOME",
  "GRADLE_HOME",
  "M2_HOME",
  "SELENIUM_JAR_PATH",
  "ENABLE_RUNNER_TRACING",
  "INVOCATION_ID",
  "JOURNAL_STREAM",
  "SYSTEMD_EXEC_PID",
  "MANAGERPID",
  "OLDPWD",
  "PWD",
  "SHLVL",
  "_",
  // GitHub Actions context (never GITHUB_TOKEN)
  "GITHUB_ACTION",
  "GITHUB_ACTION_PATH",
  "GITHUB_ACTION_REF",
  "GITHUB_ACTION_REPOSITORY",
  "GITHUB_ACTOR",
  "GITHUB_ACTOR_ID",
  "GITHUB_ENV",
  "GITHUB_EVENT_PATH",
  "GITHUB_GRAPHQL_URL",
  "GITHUB_JOB",
  "GITHUB_OUTPUT",
  "GITHUB_PATH",
  "GITHUB_REF_PROTECTED",
  "GITHUB_REF_TYPE",
  "GITHUB_REPOSITORY_ID",
  "GITHUB_REPOSITORY_OWNER_ID",
  "GITHUB_RETENTION_DAYS",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_STATE",
  "GITHUB_STEP_SUMMARY",
  "GITHUB_TRIGGERING_ACTOR",
  "GITHUB_WORKFLOW",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_WORKFLOW_SHA",
]);

/**
 * Runner baseline: name patterns for families the CI images set in bulk
 * (Actions runner internals, Android/Java/.NET/Go/Python toolchains, browsers
 * and webdrivers, Azure CLI, vcpkg, ghcup, ...). `AWS_*`, `NPM_*` and
 * `GITHUB_TOKEN`-style names are intentionally not matched.
 */
export const RUNNER_BASELINE_PATTERNS: readonly RegExp[] = [
  /^ACTIONS_/,
  /^RUNNER_/,
  /^ANDROID_/,
  /^JAVA_HOME(_|$)/,
  /^CHROME/,
  /WEBDRIVER$/,
  /^DOTNET_/,
  /^GOROOT(_|$)/,
  /^PIPX_/,
  /^POWERSHELL_/,
  /^VCPKG_/,
  /^GHCUP_/,
  /^BOOTSTRAP_HASKELL_/,
  /^AZURE_(EXTENSION_DIR|HTTP_USER_AGENT|CONFIG_DIR)$/,
  /^HOMEBREW_/,
  /^STATS_/,
];

/** True when `name` is set by the CI image itself, not by the workflow author. */
export function isRunnerBaselineVar(name: string): boolean {
  return RUNNER_BASELINE_VARS.has(name) || RUNNER_BASELINE_PATTERNS.some((re) => re.test(name));
}

/** Split withheld names into the runner baseline and everything else. */
export function classifyWithheld(withheld: readonly string[]): { baseline: string[]; other: string[] } {
  const baseline: string[] = [];
  const other: string[] = [];
  for (const n of withheld) (isRunnerBaselineVar(n) ? baseline : other).push(n);
  return { baseline: baseline.sort(), other: other.sort() };
}

/**
 * One-line warning naming the withheld variables. Names only, never values;
 * sorted; capped at {@link WITHHELD_WARNING_CAP}.
 */
export function formatWithheldWarning(withheld: readonly string[]): string {
  const names = [...withheld].sort();
  const shown = names.slice(0, WITHHELD_WARNING_CAP).join(", ");
  const more = names.length > WITHHELD_WARNING_CAP ? `, and ${names.length - WITHHELD_WARNING_CAP} more` : "";
  return (
    `Agent env scoping withheld ${names.length} environment variable(s) from the agent: ${shown}${more}. ` +
    `If a node's commands need any of them, add the names to env-passthrough ` +
    `(SWENY_ENV_PASSTHROUGH), or set env-scope: off (SWENY_ENV_SCOPE=off).`
  );
}

/** Plain-log summary: counts only, no names. */
export function formatScopeSummary(total: number, baseline: number): string {
  return (
    `sweny: agent env scoped (${total} withheld, ${baseline} from the CI image). ` +
    `Add names to env-passthrough if a node needs them; --verbose lists them.`
  );
}

let withheldReported = false;

/** Test seam: forget that the withheld notice was already emitted. */
export function resetWithheldReport(): void {
  withheldReported = false;
  passthroughCredentialWarned = false;
}

/**
 * Report withheld env names, once per process (not per node or per client).
 *
 * - always: one plain `info` line with counts (not a `::warning::` annotation);
 * - only when non-baseline names were withheld: a `warn` listing just those
 *   (capped), as a `::warning title=SWEny agent env::` annotation under GitHub
 *   Actions;
 * - `debug` (shown with `--verbose`): every withheld name.
 */
export function reportWithheldEnv(
  withheld: readonly string[],
  logger: Pick<Logger, "info" | "warn" | "debug">,
  env: Record<string, string | undefined> = process.env,
): void {
  if (withheld.length === 0 || withheldReported) return;
  withheldReported = true;
  const { baseline, other: rest } = classifyWithheld(withheld);
  // Skill credentials are withheld by design and env-passthrough cannot add
  // them back, so they are not "fix it with passthrough" material.
  const other = rest.filter((n) => !isAgentCredential(n));
  logger.info(formatScopeSummary(withheld.length, baseline.length));
  if (other.length > 0) {
    const prefix = env.GITHUB_ACTIONS === "true" ? "::warning title=SWEny agent env::" : "";
    logger.warn(`${prefix}${formatWithheldWarning(other)}`);
  }
  logger.debug(`sweny: agent env withheld: ${[...withheld].sort().join(", ")}`);
}

/**
 * Scope the agent env and report which variable names were withheld.
 * `withheld` holds names only; values never leave `source`.
 */
export function scopeAgentEnv(
  source: Record<string, string | undefined>,
  opts: BuildAgentEnvOpts = {},
): { env: Record<string, string>; withheld: string[] } {
  const env = buildAgentEnv(source, opts);
  const withheld = Object.keys(source).filter((k) => source[k] != null && !(k in env));
  return { env, withheld };
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

  const exact = new Set<string>([
    ...AGENT_ENV_ALLOWLIST,
    ...(opts.extraVars ?? []),
    ...(opts.authVars ?? []),
    ...passthrough,
  ]);
  const prefixes = [...(opts.prefixes ?? AGENT_ENV_PREFIXES)];
  // Bedrock / Vertex routing is a Claude Code setting; only its default prefixes carry it.
  if (!opts.prefixes) {
    if (truthy(source.CLAUDE_CODE_USE_BEDROCK)) prefixes.push(...BEDROCK_PREFIXES);
    if (truthy(source.CLAUDE_CODE_USE_VERTEX)) for (const v of VERTEX_VARS) exact.add(v);
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v == null) continue;
    if (exact.has(k) || prefixes.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}

// ─── No push under --stage / --dry-run (#442) ────────────────────

/**
 * Write tokens withheld from the agent when pushes are blocked. `gh`, the
 * GitHub/GitLab REST APIs and git's HTTPS auth all read these; skill tools
 * run in the sweny process, not the agent, so reads through skills still work.
 * The harness's own model credentials are never in this list.
 */
export const PUSH_TOKEN_VARS: readonly string[] = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GITHUB_PAT",
  "GITLAB_TOKEN",
  "GL_TOKEN",
  "CI_JOB_TOKEN",
  "BITBUCKET_TOKEN",
  // git transport credentials: the ssh agent socket and any askpass program
  "SSH_AUTH_SOCK",
  "SSH_ASKPASS",
  "GIT_ASKPASS",
];

/** The remote name every push is pointed at under {@link withPushBlocked}. It never exists. */
export const NO_PUSH_REMOTE = "sweny-no-push";

/** URL prefixes rewritten to an unusable scheme for pushes only (fetches are untouched). */
const PUSH_URL_PREFIXES = ["https://", "http://", "ssh://", "git://", "git@", "file://", "/"];

const NO_PUSH_MESSAGE = "sweny: git push is blocked under --stage and --dry-run (#442)";

let noPushDirCache: string | undefined;

/** Single-quote for sh: git runs `GIT_SSH_COMMAND` through the shell. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * A sweny-owned directory holding a `pre-push` hook and a `GIT_ASKPASS`
 * program that both refuse, an ssh wrapper that refuses pushes, and an empty
 * `gh` config dir. Created once per process under the OS temp dir.
 */
export function noPushDir(): string {
  if (noPushDirCache && existsSync(path.join(noPushDirCache, "hooks", "pre-push"))) return noPushDirCache;
  const dir = mkdtempSync(path.join(tmpdir(), "sweny-no-push-"));
  mkdirSync(path.join(dir, "hooks"));
  mkdirSync(path.join(dir, "gh"));
  const refuse = `#!/bin/sh\necho "${NO_PUSH_MESSAGE}" >&2\nexit 1\n`;
  writeFileSync(path.join(dir, "hooks", "pre-push"), refuse, { mode: 0o755 });
  writeFileSync(path.join(dir, "askpass"), refuse, { mode: 0o755 });
  // git runs `<ssh> host "git-receive-pack '<path>'"` to push and
  // git-upload-pack to fetch: refuse the first, hand everything else to the
  // operator's own ssh command (or plain ssh).
  const ssh =
    `#!/bin/sh\n` +
    `for a in "$@"; do case "$a" in *receive-pack*) echo "${NO_PUSH_MESSAGE}" >&2; exit 1;; esac; done\n` +
    `if [ -n "$SWENY_NO_PUSH_SSH" ]; then exec sh -c "$SWENY_NO_PUSH_SSH \\"\\$@\\"" ssh "$@"; fi\n` +
    `exec ssh "$@"\n`;
  writeFileSync(path.join(dir, "ssh"), ssh, { mode: 0o755 });
  noPushDirCache = dir;
  return dir;
}

/**
 * Git config entries (command scope, via `GIT_CONFIG_COUNT`) that make every
 * push fail while leaving fetch, commit and diff alone:
 *
 * - `credential.helper` set to empty resets the helper list, so no stored
 *   credential (keychain, `gh auth git-credential`, store) reaches git;
 * - `remote.pushDefault` names a remote that does not exist and
 *   `push.default=nothing` refuses a bare `git push`;
 * - `url.<unusable>.pushInsteadOf` rewrites every https/ssh/git/file/absolute
 *   path push URL to a scheme git has no helper for;
 * - `core.hooksPath` points at a sweny `pre-push` hook that exits 1, which
 *   also covers a remote with an explicit `pushurl` (git ignores
 *   pushInsteadOf there). Repo hooks do not run in these nodes.
 */
export function noPushGitConfig(dir: string): Array<[string, string]> {
  return [
    ["credential.helper", ""],
    ["remote.pushDefault", NO_PUSH_REMOTE],
    ["push.default", "nothing"],
    ["core.hooksPath", path.join(dir, "hooks")],
    ...PUSH_URL_PREFIXES.map((p): [string, string] => [`url.${NO_PUSH_REMOTE}://blocked/.pushInsteadOf`, p]),
  ];
}

/**
 * The agent env with pushes blocked (#442). Applied to every node's agent
 * env when a run is staged or a dry run, on every harness, whether or not env
 * scoping is on. Withholds {@link PUSH_TOKEN_VARS} (the ssh agent socket and
 * askpass programs among them) and every {@link isAgentCredential} name, even
 * one a node granted with `agent_env`, appends
 * {@link noPushGitConfig} after any `GIT_CONFIG_*` entries already present,
 * sets `GIT_ASKPASS` to a refusing program, turns off git's terminal prompt,
 * routes git's ssh through a wrapper that refuses `git-receive-pack` (so an
 * ssh push fails even to a remote with an explicit `pushurl` under
 * `--no-verify`; ssh fetches still run the operator's own ssh command), and
 * gives `gh` an empty config dir so a stored `gh auth login` is not used.
 *
 * Not a sandbox: these are env vars and a git hook, and the agent can unset
 * them. A deliberate agent on an unsandboxed run that finds a credential on
 * disk (an ssh key without a passphrase, a keychain entry, a token persisted
 * in `.git/config` by a checkout) can still push. Run sandboxed (the sandbox
 * hides credential files such as `~/.ssh`, and a checkout's persisted token,
 * see git-credentials.ts) and without push credentials in CI
 * for a guarantee; under a strict harness policy an unsandboxed staged write
 * node is refused (`stagedWrite` in policy.ts). `enabled` false returns `env`
 * unchanged. Pure apart from creating {@link noPushDir} once.
 */
export function withPushBlocked(env: Record<string, string>, enabled: boolean | undefined): Record<string, string> {
  if (!enabled) return env;
  const dir = noPushDir();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    // Every skill credential too, even one a node granted with `agent_env`.
    if (PUSH_TOKEN_VARS.includes(k) || isAgentCredential(k)) continue;
    out[k] = v;
  }
  const base = Number.parseInt(out.GIT_CONFIG_COUNT ?? "0", 10);
  let n = Number.isFinite(base) && base > 0 ? base : 0;
  for (const [key, value] of noPushGitConfig(dir)) {
    out[`GIT_CONFIG_KEY_${n}`] = key;
    out[`GIT_CONFIG_VALUE_${n}`] = value;
    n++;
  }
  out.GIT_CONFIG_COUNT = String(n);
  const wrapper = shQuote(path.join(dir, "ssh"));
  // Applied twice, GIT_SSH_COMMAND is already our wrapper: keep the operator's command it recorded,
  // or the wrapper would exec itself forever on a fetch.
  const ownSsh =
    env.GIT_SSH_COMMAND === wrapper
      ? env.SWENY_NO_PUSH_SSH
      : (env.GIT_SSH_COMMAND ?? (env.GIT_SSH ? shQuote(env.GIT_SSH) : undefined));
  if (ownSsh) out.SWENY_NO_PUSH_SSH = ownSsh;
  out.GIT_SSH_COMMAND = wrapper;
  out.GIT_SSH_VARIANT = "ssh";
  out.GIT_ASKPASS = path.join(dir, "askpass");
  out.GIT_TERMINAL_PROMPT = "0";
  out.GH_CONFIG_DIR = path.join(dir, "gh");
  out.GH_PROMPT_DISABLED = "1";
  return out;
}

// ─── Skill credentials stay in the sweny process ─────────────────

/**
 * Credentials the agent process never receives by default, on any harness,
 * whether env scoping is on or off and even under `env-passthrough: "*"`.
 *
 * Skill tools run in the sweny process (in-process, or through the tool
 * bridge), so the agent never needs them. An agent that holds one can use it
 * outside every sweny opinion: a read-only node could still POST to GitHub
 * with `GITHUB_TOKEN` and network access (security review 2026-09-30,
 * finding 1). The list is the source-hosting write tokens plus every config
 * variable of the built-in skills (`skills/*.ts`, checked by a unit test). A
 * run also withholds its custom skills' config names
 * ({@link AgentAccess.withhold}). A node grants one back with `agent_env`.
 */
export const AGENT_CREDENTIAL_VARS: readonly string[] = [
  // source hosting: gh, the GitHub/GitLab REST APIs and git's HTTPS auth read these
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GITHUB_PAT",
  "GITLAB_TOKEN",
  "GL_TOKEN",
  "CI_JOB_TOKEN",
  "BITBUCKET_TOKEN",
  // built-in skills (config fields of skills/*.ts)
  "LINEAR_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_BASE_URL",
  "DD_API_KEY",
  "DD_APP_KEY",
  "DD_SITE",
  "BETTERSTACK_API_TOKEN",
  "BETTERSTACK_QUERY_ENDPOINT",
  "BETTERSTACK_QUERY_USERNAME",
  "BETTERSTACK_QUERY_PASSWORD",
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS",
  "DISCORD_WEBHOOK_URL",
  "TEAMS_WEBHOOK_URL",
  "SMTP_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ALLOWED_TABLES",
  "SUPABASE_ALLOWED_FUNCTIONS",
];

/** Credential families withheld by prefix (`SLACK_BOT_TOKEN`, `SLACK_WEBHOOK_URL`, ...). */
export const AGENT_CREDENTIAL_PREFIXES: readonly string[] = ["SLACK_"];

/** Is `name` a credential the agent never gets by default ({@link AGENT_CREDENTIAL_VARS}, plus `extra`)? */
export function isAgentCredential(name: string, extra: readonly string[] = []): boolean {
  return (
    AGENT_CREDENTIAL_VARS.includes(name) ||
    AGENT_CREDENTIAL_PREFIXES.some((p) => name.startsWith(p)) ||
    extra.includes(name)
  );
}

export interface WithholdCredentialsOpts {
  /** Names the node granted with `agent_env`. They pass even when they are credentials. */
  grant?: readonly string[];
  /** The run's own skill credential names (custom skills included). */
  withhold?: readonly string[];
  /** The harness's own auth vars. Never dropped: the agent cannot start without them. */
  keep?: readonly string[];
}

/**
 * Drop every skill credential from an agent env, after scoping (on or off).
 * Only `grant` and `keep` survive. Returns the env, the names dropped, and
 * `held`: the credential names still in the env (granted or kept), which the
 * policy gate weighs against a read-only node. Pure: values never leave `env`.
 */
export function withholdCredentials(
  env: Record<string, string>,
  opts: WithholdCredentialsOpts = {},
): { env: Record<string, string>; withheld: string[]; held: string[] } {
  const grant = opts.grant ?? [];
  const keep = opts.keep ?? [];
  const extra = opts.withhold ?? [];
  const out: Record<string, string> = {};
  const withheld: string[] = [];
  const held: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!isAgentCredential(k, extra)) {
      out[k] = v;
    } else if (grant.includes(k) || keep.includes(k)) {
      out[k] = v;
      held.push(k);
    } else {
      withheld.push(k);
    }
  }
  return { env: out, withheld: withheld.sort(), held: held.sort() };
}

/** The credential names present in a finished agent env (granted, or a harness's own auth var). */
export function heldCredentials(env: Record<string, string>, extra: readonly string[] = []): string[] {
  return Object.keys(env)
    .filter((k) => isAgentCredential(k, extra))
    .sort();
}

let passthroughCredentialWarned = false;

/**
 * The last step of every harness's agent env: {@link withholdCredentials}
 * with the node's grants and the harness's own auth vars, plus one warning
 * per process when `env-passthrough` names a credential (passthrough never
 * carries one; `agent_env` on the node that needs it does). Withheld names go
 * to `debug`, never values.
 */
export function finishAgentEnv(
  env: Record<string, string>,
  opts: {
    access?: Pick<AgentAccess, "envVars" | "withhold">;
    keep?: readonly string[];
    passthrough?: readonly string[];
    logger?: Pick<Logger, "warn" | "debug">;
  } = {},
): { env: Record<string, string>; held: string[] } {
  const grant = opts.access?.envVars ?? [];
  const keep = opts.keep ?? [];
  const result = withholdCredentials(env, { grant, withhold: opts.access?.withhold, keep });
  const asked = (opts.passthrough ?? []).filter(
    (n) => isAgentCredential(n, opts.access?.withhold) && !grant.includes(n) && !keep.includes(n),
  );
  if (asked.length > 0 && !passthroughCredentialWarned) {
    passthroughCredentialWarned = true;
    opts.logger?.warn(
      `[sweny] env-passthrough names skill credentials (${asked.sort().join(", ")}); they never reach the agent. ` +
        `Skill tools run in sweny and already have them. If a node's own shell needs one, add it to that node's agent_env.`,
    );
  }
  if (result.withheld.length > 0) {
    opts.logger?.debug(`sweny: skill credentials withheld from the agent: ${result.withheld.join(", ")}`);
  }
  return { env: result.env, held: result.held };
}

/**
 * The names a node's `agent_env` may actually grant. A read-only node and a
 * staged or dry run get none: the first is refused at load time (validate),
 * this is the runtime backstop, and the second must not push or write.
 */
export function grantedAgentEnv(
  agentEnv: readonly string[] | undefined,
  opts: { readOnly: boolean; staged: boolean },
): { grant: string[]; dropped?: string } {
  const names = [...new Set(agentEnv ?? [])];
  if (names.length === 0) return { grant: [] };
  if (opts.readOnly) return { grant: [], dropped: `agent_env withheld on a read-only node: ${names.join(", ")}` };
  if (opts.staged) return { grant: [], dropped: `agent_env withheld in a staged or dry run: ${names.join(", ")}` };
  return { grant: names };
}

// ─── Per-node access (env vars + network) ────────────────────────

/** What one node's agent call may see: env var names and network hosts. */
export interface AgentAccess {
  /**
   * Names the node granted with `agent_env`: added to a scoped env, and the
   * only credentials ({@link isAgentCredential}) that reach the agent.
   */
  envVars: string[];
  domains: string[];
  /** The run's skill config names (every configured skill), never passed unless granted. */
  withhold?: string[];
  /**
   * The run is staged or a dry run (#442): the harness applies
   * {@link withPushBlocked} to the agent env. That blocks git push by env and
   * hooks; only a sandbox stops a deliberate agent from undoing it.
   */
  noPush?: boolean;
  /**
   * The run is staged or a dry run: no skill or external MCP server reaches
   * the node (an MCP server cannot be classified per tool, so it may write).
   * Only sweny's own tool bridge, already filtered to read tools, remains,
   * and Claude Code runs with `strictMcpConfig`. Same MCP rule as `readOnly`.
   */
  noMcp?: boolean;
}

/** True when a run request may load no MCP server but sweny's own bridge (read-only or staged). */
export function mcpWithheld(readOnly: boolean, access: Pick<AgentAccess, "noMcp"> | undefined): boolean {
  return readOnly || access?.noMcp === true;
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
 * Resolve a node's access: the referenced skills' provider hosts, the names
 * the node granted with `agent_env` (`grant`, see {@link grantedAgentEnv}),
 * and every config variable of every skill in the run (`withhold`), which the
 * harness keeps out of the agent env unless granted. Skill tools run in the
 * sweny process, so the agent never needs a skill's own credential. Unknown
 * skill ids contribute nothing (the executor validates them).
 */
export function resolveAgentAccess(
  skillIds: readonly string[],
  skills: Map<string, Skill>,
  grant: readonly string[] = [],
): AgentAccess {
  const withhold = new Set<string>();
  const domains = new Set<string>();
  for (const skill of skills.values()) {
    for (const field of Object.values(skill.config ?? {})) {
      if (field.env) withhold.add(field.env);
    }
  }
  for (const id of skillIds) {
    for (const d of SKILL_SANDBOX_DOMAINS[id] ?? []) domains.add(d);
  }
  return { envVars: [...grant], domains: [...domains], withhold: [...withhold].sort() };
}

// ─── SDK sandbox ─────────────────────────────────────────────────

/**
 * `off`: never sandbox (default for local runs, so "it's your repo" keeps
 * working: private registries, docker, cargo, go). `auto` (default when CI is
 * truthy): sandbox when the host supports it, otherwise warn once and run
 * unsandboxed so unattended CI never breaks on a missing dependency.
 * `strict`: sandbox or fail closed.
 */
export type SandboxMode = "off" | "auto" | "strict";

/**
 * Parse the sandbox mode from the explicit `mode` or `SWENY_SANDBOX`.
 * Accepts `off|false|0`, `auto`, `strict|on|true|1` (`on` is an alias for
 * `strict`). Unset or unknown (with a warning) uses the default: `auto` when
 * `CI` is truthy, `off` otherwise. An explicit value always wins.
 */
export function resolveSandboxMode(
  env: Record<string, string | undefined>,
  mode?: string,
  logger?: Pick<Logger, "warn">,
): SandboxMode {
  const raw = (mode ?? env.SWENY_SANDBOX ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  if (raw === "strict" || raw === "on" || raw === "true" || raw === "1") return "strict";
  if (raw === "auto") return "auto";
  const fallback: SandboxMode = truthy(env.CI) ? "auto" : "off";
  if (raw !== "") logger?.warn(`SWENY_SANDBOX="${raw}" is not one of off|auto|strict; using ${fallback}`);
  return fallback;
}

/** Functional bubblewrap check: can it actually create a sandbox on this host? */
function bwrapWorks(): string | undefined {
  try {
    execFileSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "true"], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 10_000,
    });
    return undefined;
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? (err as Error).message ?? "").trim();
    const userns = /user namespace|uid map|setting up uid|Operation not permitted|Permission denied/i.test(stderr);
    return (
      `bwrap cannot create a sandbox (${stderr.split("\n")[0] || "unknown error"})` +
      (userns
        ? "; unprivileged user namespaces look restricted (Ubuntu 23.10+: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0)"
        : "")
    );
  }
}

/**
 * Probe whether the SDK sandbox can start on this host. Returns a reason
 * string when it cannot, undefined when it looks supported.
 *
 * macOS uses the built-in `sandbox-exec`. Linux needs `bwrap` (bubblewrap)
 * and `socat` on PATH, and bwrap must be able to create a namespace
 * (`bwrapCheck`, a real `bwrap ... true` run by default). Anything else is
 * unsupported.
 */
export function checkSandboxSupport(
  platform: NodeJS.Platform = process.platform,
  pathEnv: string = process.env.PATH ?? "",
  exists: (p: string) => boolean = existsSync,
  bwrapCheck: () => string | undefined = bwrapWorks,
): string | undefined {
  if (platform === "darwin") return undefined;
  if (platform !== "linux") return `the Claude Code sandbox does not support platform "${platform}"`;
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const missing = ["bwrap", "socat"].filter((bin) => !dirs.some((d) => exists(path.join(d, bin))));
  if (missing.length > 0) {
    return `missing ${missing.join(" and ")} on PATH (install: sudo apt-get install -y bubblewrap socat)`;
  }
  return bwrapCheck();
}

let cachedProbe: { result: string | undefined } | undefined;
/** {@link checkSandboxSupport} for this host, computed once per process. */
function defaultProbe(): string | undefined {
  if (!cachedProbe) cachedProbe = { result: checkSandboxSupport() };
  return cachedProbe.result;
}

/**
 * The SDK sandbox settings used when the sandbox is on.
 *
 * - `failIfUnavailable`: true under `strict` (the SDK errors instead of
 *   running unsandboxed); false under `auto`, so a host that passes the
 *   preflight but still cannot start the sandbox degrades instead of failing.
 * - `allowUnsandboxedCommands: false`: the model cannot escape via the
 *   `dangerouslyDisableSandbox` parameter. Required, because nodes run under
 *   `bypassPermissions` (#365) which would otherwise auto-approve the escape.
 * - `network.allowedDomains` + `strictAllowlist`: non-listed hosts are denied
 *   deterministically rather than prompted (no prompt exists headless).
 * - `credentials`: the agent's own Anthropic credentials are unset for
 *   sandboxed commands, and the Claude Code credentials file is unreadable.
 */
export function buildSandboxSettings(
  domains: readonly string[],
  opts: { failIfUnavailable?: boolean; home?: string } = {},
): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: opts.failIfUnavailable ?? true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: {
      allowedDomains: [...new Set(domains)],
      strictAllowlist: true,
    },
    credentials: {
      envVars: AGENT_AUTH_VARS.map((name) => ({ name, mode: "deny" as const })),
      files: [
        { path: path.join(opts.home ?? homedir(), ".claude", ".credentials.json"), mode: "deny" as const },
        // Run journal keys: an agent that could read them could forge journal records.
        { path: runKeyDir(), mode: "deny" as const },
      ],
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
  /** Preflight probe; test seam. Defaults to {@link checkSandboxSupport}, cached per process. */
  probe?: () => string | undefined;
  logger?: Pick<Logger, "warn">;
}

export interface AgentSandboxResolution {
  mode: SandboxMode;
  /** SDK `sandbox` option; absent when running unsandboxed. */
  settings?: SandboxSettings;
  /** `strict` only: the host cannot sandbox. Callers must fail the call. */
  error?: string;
  /** `auto` only: the host cannot sandbox, running unsandboxed. Log it loudly, once. */
  warning?: string;
}

/**
 * Resolve the `sandbox` query option for one agent call.
 *
 * - `off`: no settings.
 * - supported host: `{ settings }`.
 * - unsupported host under `auto`: `{ warning }`, run unsandboxed (back-compat:
 *   unattended CI must not break on a missing dependency).
 * - unsupported host under `strict`: `{ error }`, fail closed.
 */
export function resolveAgentSandbox(opts: ResolveAgentSandboxOpts): AgentSandboxResolution {
  const mode = resolveSandboxMode(opts.env, opts.mode, opts.logger);
  if (mode === "off") return { mode };

  const reason = (opts.probe ?? defaultProbe)();
  if (reason) {
    if (mode === "strict") {
      return {
        mode,
        error:
          `Agent sandbox is required (SWENY_SANDBOX=strict) but unavailable: ${reason}. ` +
          `Refusing to run the agent unsandboxed. Fix the host, or set SWENY_SANDBOX=auto to fall back with a warning.`,
      };
    }
    return {
      mode,
      warning:
        `Agent sandbox unavailable: ${reason}. Running agent shell commands UNSANDBOXED ` +
        `(network and filesystem unrestricted; env scoping and untrusted-input fencing still apply). ` +
        `Fix the host to sandbox, set SWENY_SANDBOX=strict (or \`sandbox: strict\` in .sweny.yml) to fail instead, ` +
        `or SWENY_SANDBOX=off to silence this.`,
    };
  }

  const extra = opts.allowedDomains ?? parseList(opts.env.SWENY_SANDBOX_ALLOWED_DOMAINS);
  return {
    mode,
    settings: buildSandboxSettings([...DEFAULT_SANDBOX_DOMAINS, ...(opts.nodeDomains ?? []), ...extra], {
      failIfUnavailable: mode === "strict",
    }),
  };
}
