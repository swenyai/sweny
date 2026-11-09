import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { CliConfig } from "./config.js";
import { validateInputs } from "./config.js";
import { findSkillEnvGaps } from "./skill-env.js";
import { configuredSkills } from "../skills/custom-loader.js";
import { consoleLogger } from "../types.js";
import { createHarness, isSupportedAgent, unsupportedAgentError, type AgentHarness } from "../harness/index.js";
import { CHECK_TIMEOUT_MS, networkErrorMessage } from "../harness/diagnose.js";

// The Claude probes moved behind the harness seam (#532); these names stay importable from here.
export { resolveCheckAuthMode, redactUrl, checkAnthropicGateway } from "../harness/diagnose.js";
export type { CheckAuthMode } from "../harness/diagnose.js";

export interface CheckResult {
  name: string;
  status: "ok" | "fail" | "skip";
  detail: string;
}

/**
 * Run lightweight connectivity checks for all configured providers.
 * Uses raw fetch — does NOT import provider packages.
 */
export interface CheckOptions {
  /**
   * Skill ids the configured workflows use. When set, only providers those
   * skills need are checked; everything else is omitted. When undefined
   * (no workflows found), the legacy config-driven checks run.
   */
  scope?: ReadonlySet<string>;
  /**
   * Not read by the agent lines since #532: each harness probes its own stored
   * login. Kept so existing callers compile; {@link validateCheckInputs} takes
   * its own copy.
   */
  claudeCodeLogin?: boolean;
  /** The agent harness to diagnose (test seam). Default: `createHarness(codingAgentProvider)`. */
  harness?: Pick<AgentHarness, "diagnose">;
  /** Env the agent credentials are read from (default: `process.env`). */
  env?: Record<string, string | undefined>;
}

export async function checkProviderConnectivity(config: CliConfig, opts: CheckOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const scope = opts.scope;
  const inScope = (skillId: string) => !scope || scope.has(skillId);
  const githubChecked = { done: false }; // avoid double-checking same token

  // ── Coding agent ────────────────────────────────────────────────────────────
  results.push(...(await checkAgent(config, opts)));

  // ── Observability ────────────────────────────────────────────────────────────
  for (const provider of config.observabilityProviders) {
    if (!inScope(provider)) continue;
    const creds = config.observabilityCredentials[provider] ?? {};
    if (provider === "datadog") {
      results.push(await checkDatadog(creds));
    } else if (provider === "sentry") {
      results.push(await checkSentry(creds));
    } else if (provider === "file") {
      results.push({ name: "Observability (file)", status: "skip", detail: "File provider - no network check needed" });
    } else {
      results.push({
        name: `Observability (${provider})`,
        status: "skip",
        detail: "Connectivity check not implemented for this provider",
      });
    }
  }

  // ── Issue tracker ────────────────────────────────────────────────────────────
  if (scope && !inScope(config.issueTrackerProvider === "github-issues" ? "github" : config.issueTrackerProvider)) {
    // No workflow uses this tracker: nothing to check.
  } else if (config.issueTrackerProvider === "linear") {
    results.push(await checkLinear(config.linearApiKey));
  } else if (config.issueTrackerProvider === "github-issues") {
    const token = config.githubToken || config.botToken;
    results.push(await checkGitHub(token, "Issue tracker (github-issues)"));
    githubChecked.done = true;
  } else if (config.issueTrackerProvider === "file") {
    results.push({
      name: "Issue tracker (file)",
      status: "skip",
      detail: "File provider - no network check needed",
    });
  } else {
    results.push({
      name: `Issue tracker (${config.issueTrackerProvider})`,
      status: "skip",
      detail: "Connectivity check not implemented for this provider",
    });
  }

  // ── Source control ───────────────────────────────────────────────────────────
  if (scope && !inScope(config.sourceControlProvider)) {
    // No workflow uses this source control: nothing to check.
  } else if (config.sourceControlProvider === "github" && !githubChecked.done) {
    const token = config.githubToken || config.botToken;
    results.push(await checkGitHub(token, "Source control (github)"));
  } else if (config.sourceControlProvider === "github" && githubChecked.done) {
    // Already checked via github-issues — reuse
    const existing = results.find((r) => r.name === "Issue tracker (github-issues)");
    if (existing) {
      results.push({ ...existing, name: "Source control (github)" });
    }
  } else if (config.sourceControlProvider === "file") {
    results.push({
      name: "Source control (file)",
      status: "skip",
      detail: "File provider - no network check needed",
    });
  } else {
    results.push({
      name: `Source control (${config.sourceControlProvider})`,
      status: "skip",
      detail: "Connectivity check not implemented for this provider",
    });
  }

  return results;
}

// ── Provider check functions ─────────────────────────────────────────────────

/**
 * The agent lines (#532): whatever the harness's `diagnose()` checks (CLI and
 * version, credentials, a stored login, a cheap upstream probe), rendered
 * like every other line. The harness owns the checks; nothing here branches
 * on the agent.
 */
export async function checkAgent(
  config: CliConfig,
  opts: Pick<CheckOptions, "harness" | "env"> = {},
): Promise<CheckResult[]> {
  const agent = config.codingAgentProvider;
  const name = `Coding agent (${agent})`;
  if (!isSupportedAgent(agent)) return [{ name, status: "fail", detail: unsupportedAgentError(agent) }];
  let harness: Pick<AgentHarness, "diagnose">;
  try {
    harness = opts.harness ?? createHarness(agent, { logger: consoleLogger });
  } catch (err) {
    return [{ name, status: "fail", detail: err instanceof Error ? err.message : String(err) }];
  }
  if (!harness.diagnose) return [{ name, status: "skip", detail: "This agent has no preflight checks" }];
  return harness.diagnose({ env: agentCheckEnv(config, opts.env ?? process.env), timeoutMs: CHECK_TIMEOUT_MS });
}

/** Env for the agent checks: the process env, with the agent settings `.sweny.yml` can also carry. */
function agentCheckEnv(config: CliConfig, env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...env,
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    ANTHROPIC_AUTH_TOKEN: config.anthropicAuthToken,
    CLAUDE_CODE_OAUTH_TOKEN: config.claudeOauthToken,
    ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
    SWENY_AUTH: config.swenyAuth,
  };
}

export async function checkDatadog(creds: Record<string, string>): Promise<CheckResult> {
  const name = "Observability (datadog)";
  const { apiKey, appKey, site = "datadoghq.com" } = creds;
  if (!apiKey || !appKey) {
    return { name, status: "skip", detail: "DD_API_KEY or DD_APP_KEY not configured" };
  }
  // `site` (DD_SITE) is interpolated into the request URL — reject anything
  // outside a hostname allowlist before it can smuggle a path/query/host.
  if (!/^[a-z0-9.-]+$/.test(site)) {
    return {
      name,
      status: "fail",
      detail: `Invalid DD_SITE "${site}" - expected a hostname like datadoghq.com or datadoghq.eu`,
    };
  }
  try {
    const res = await fetch(`https://api.${site}/api/v2/validate`, {
      headers: { "DD-API-KEY": apiKey, "DD-APPLICATION-KEY": appKey },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.status === 200) {
      return { name, status: "ok", detail: "API key is valid" };
    }
    if (res.status === 403) {
      return {
        name,
        status: "fail",
        detail:
          "403 Forbidden - check DD_API_KEY and DD_APP_KEY at https://app.datadoghq.com/organization-settings/api-keys",
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err) };
  }
}

async function checkSentry(creds: Record<string, string>): Promise<CheckResult> {
  const name = "Observability (sentry)";
  const { authToken } = creds;
  if (!authToken) {
    return { name, status: "skip", detail: "SENTRY_AUTH_TOKEN not configured" };
  }
  try {
    const res = await fetch("https://sentry.io/api/0/", {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.status === 200) {
      return { name, status: "ok", detail: "Auth token is valid" };
    }
    if (res.status === 401) {
      return {
        name,
        status: "fail",
        detail: "401 Unauthorized - check SENTRY_AUTH_TOKEN at https://sentry.io/settings/auth-tokens/",
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err) };
  }
}

async function checkLinear(apiKey: string): Promise<CheckResult> {
  const name = "Issue tracker (linear)";
  if (!apiKey) {
    return { name, status: "skip", detail: "LINEAR_API_KEY not configured" };
  }
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: "{ viewer { id name } }" }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.status === 200) {
      const body = (await res.json()) as { data?: { viewer?: { name?: string } }; errors?: unknown[] };
      if (body.errors?.length) {
        return { name, status: "fail", detail: "GraphQL error - check LINEAR_API_KEY" };
      }
      const displayName = body.data?.viewer?.name ?? "authenticated";
      return { name, status: "ok", detail: `Authenticated as ${displayName}` };
    }
    if (res.status === 401) {
      return {
        name,
        status: "fail",
        detail: "401 Unauthorized - check LINEAR_API_KEY at https://linear.app/settings/api",
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err) };
  }
}

async function checkGitHub(token: string, name: string): Promise<CheckResult> {
  if (!token) {
    return { name, status: "skip", detail: "GITHUB_TOKEN not configured" };
  }
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${token}`, "User-Agent": "sweny-cli" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.status === 200) {
      const body = (await res.json()) as { login?: string };
      return { name, status: "ok", detail: `Authenticated as ${body.login ?? "unknown"}` };
    }
    if (res.status === 401) {
      return {
        name,
        status: "fail",
        detail: "401 Bad credentials - check GITHUB_TOKEN at https://github.com/settings/tokens",
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err) };
  }
}

// ── Workflow-scoped checks ───────────────────────────────────────────────────

/**
 * Detect a local Claude Code login the way `sweny workflow run` benefits from
 * it: the spawned Claude Code agent finds its own login, so no env credential
 * is needed. Lives with the harness login probes (#339); re-exported here.
 */
export { detectClaudeCodeLogin } from "../harness/auth.js";

/**
 * Skill ids used by the workflows in `.sweny/workflows/`. `found` is false when
 * there are no workflow files, in which case callers keep the legacy checks.
 */
export function discoverWorkflowSkillIds(cwd: string): { found: boolean; skillIds: Set<string> } {
  const dir = path.join(cwd, ".sweny", "workflows");
  const skillIds = new Set<string>();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(ya?ml|json)$/i.test(f));
  } catch {
    return { found: false, skillIds };
  }
  let found = false;
  for (const f of files) {
    try {
      const raw = parseYaml(fs.readFileSync(path.join(dir, f), "utf-8")) as {
        nodes?: Record<string, { skills?: unknown }>;
      } | null;
      if (!raw || typeof raw !== "object") continue;
      found = true;
      for (const node of Object.values(raw.nodes ?? {})) {
        if (Array.isArray(node?.skills)) {
          for (const id of node.skills) if (typeof id === "string") skillIds.add(id);
        }
      }
    } catch {
      // unparseable file: `workflow validate` reports it; check ignores it
    }
  }
  return { found, skillIds };
}

const CLAUDE_AUTH_ERROR_PREFIX = "Missing: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN";

/**
 * Errors `sweny check` should report. With a workflow scope, only credentials
 * those workflows need (plus agent auth) are required. A local Claude Code
 * login satisfies agent auth.
 */
export function validateCheckInputs(
  config: CliConfig,
  opts: {
    scope?: ReadonlySet<string>;
    claudeCodeLogin?: boolean;
    env?: Record<string, string | undefined>;
    cwd?: string;
  } = {},
): string[] {
  let errors: string[];
  if (opts.scope) {
    // Agent auth only; repo / tracker / observability requirements come from skills below.
    errors = validateInputs({
      ...config,
      issueTrackerProvider: "file",
      sourceControlProvider: "file",
      observabilityProviders: [],
    });
    const env = opts.env ?? process.env;
    const available = new Set(configuredSkills(env, opts.cwd ?? process.cwd()).map((s) => s.id));
    for (const gap of findSkillEnvGaps(opts.scope, available)) {
      errors.push(`Missing: ${gap.missingEnv.join(", ")} (needed by skill "${gap.id}")`);
    }
  } else {
    errors = validateInputs(config);
  }
  if (opts.claudeCodeLogin) errors = errors.filter((e) => !e.startsWith(CLAUDE_AUTH_ERROR_PREFIX));
  return errors;
}
