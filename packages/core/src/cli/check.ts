import type { CliConfig } from "./config.js";

export interface CheckResult {
  name: string;
  status: "ok" | "fail" | "skip";
  detail: string;
}

/**
 * Per-check network timeout. A hung connect must not make `sweny check` hang
 * indefinitely — the whole point of the command is fast diagnostics.
 */
const CHECK_TIMEOUT_MS = 5000;

/**
 * Run lightweight connectivity checks for all configured providers.
 * Uses raw fetch — does NOT import provider packages.
 */
export async function checkProviderConnectivity(config: CliConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const githubChecked = { done: false }; // avoid double-checking same token

  // ── Coding agent ────────────────────────────────────────────────────────────
  if (config.codingAgentProvider === "claude") {
    const mode = resolveCheckAuthMode(config);
    const base = config.anthropicBaseUrl;
    if (mode === "none") {
      results.push({ name: "Anthropic (claude agent)", status: "skip", detail: "No credential configured" });
    } else if (base) {
      // Gateway: probe the gateway, never real Anthropic with a gateway-bound key.
      results.push(await checkAnthropicGateway(base, config, mode));
    } else if (mode === "api-key") {
      results.push(await checkAnthropic(config.anthropicApiKey));
    } else {
      // oauth or auth-token, no base URL: nothing cheap to probe, report the mode.
      results.push({
        name: "Anthropic (claude agent)",
        status: "skip",
        detail: `auth mode: ${mode}, skipping upstream API check`,
      });
    }
  } else {
    results.push({
      name: `Coding agent (${config.codingAgentProvider})`,
      status: "skip",
      detail: "Connectivity check not implemented for this provider",
    });
  }

  // ── Observability ────────────────────────────────────────────────────────────
  for (const provider of config.observabilityProviders) {
    const creds = config.observabilityCredentials[provider] ?? {};
    if (provider === "datadog") {
      results.push(await checkDatadog(creds));
    } else if (provider === "sentry") {
      results.push(await checkSentry(creds));
    } else if (provider === "file") {
      results.push({ name: "Observability (file)", status: "skip", detail: "File provider — no network check needed" });
    } else {
      results.push({
        name: `Observability (${provider})`,
        status: "skip",
        detail: "Connectivity check not implemented for this provider",
      });
    }
  }

  // ── Issue tracker ────────────────────────────────────────────────────────────
  if (config.issueTrackerProvider === "linear") {
    results.push(await checkLinear(config.linearApiKey));
  } else if (config.issueTrackerProvider === "github-issues") {
    const token = config.githubToken || config.botToken;
    results.push(await checkGitHub(token, "Issue tracker (github-issues)"));
    githubChecked.done = true;
  } else if (config.issueTrackerProvider === "file") {
    results.push({
      name: "Issue tracker (file)",
      status: "skip",
      detail: "File provider — no network check needed",
    });
  } else {
    results.push({
      name: `Issue tracker (${config.issueTrackerProvider})`,
      status: "skip",
      detail: "Connectivity check not implemented for this provider",
    });
  }

  // ── Source control ───────────────────────────────────────────────────────────
  if (config.sourceControlProvider === "github" && !githubChecked.done) {
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
      detail: "File provider — no network check needed",
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

async function checkAnthropic(apiKey: string): Promise<CheckResult> {
  const name = "Anthropic (claude agent)";
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.status === 200) {
      return { name, status: "ok", detail: "API key is valid" };
    }
    if (res.status === 401) {
      return {
        name,
        status: "fail",
        detail: "401 Unauthorized — check ANTHROPIC_API_KEY at https://console.anthropic.com",
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err) };
  }
}

/** Which credential `sweny check` should validate, mirroring resolveAuthEnv intent. */
export type CheckAuthMode = "oauth" | "api-key" | "auth-token" | "none";

export function resolveCheckAuthMode(
  config: Pick<CliConfig, "anthropicApiKey" | "anthropicAuthToken" | "claudeOauthToken" | "swenyAuth">,
): CheckAuthMode {
  const hasKey = !!config.anthropicApiKey;
  const hasBearer = !!config.anthropicAuthToken;
  const hasOauth = !!config.claudeOauthToken;
  if (config.swenyAuth === "oauth") return hasOauth ? "oauth" : "none";
  if (config.swenyAuth === "api-key") return hasKey ? "api-key" : hasBearer ? "auth-token" : "none";
  // auto: OAuth wins when present (today's protective behavior)
  if (hasOauth) return "oauth";
  if (hasKey) return "api-key";
  if (hasBearer) return "auth-token";
  return "none";
}

/** Redact a URL to scheme + host so userinfo / query (which can carry a key) never logs. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(invalid URL)";
  }
}

export async function checkAnthropicGateway(
  base: string,
  config: Pick<CliConfig, "anthropicApiKey" | "anthropicAuthToken" | "claudeOauthToken">,
  mode: CheckAuthMode,
): Promise<CheckResult> {
  const name = "Anthropic (gateway)";
  const safeBase = redactUrl(base);
  const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
  if (mode === "api-key") {
    headers["x-api-key"] = config.anthropicApiKey;
  } else {
    // auth-token or oauth against the gateway
    headers.Authorization = `Bearer ${config.anthropicAuthToken || config.claudeOauthToken}`;
  }
  try {
    const url = base.replace(/\/+$/, "") + "/v1/models";
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    // Gateways vary on whether /v1/models exists; reachable + non-auth-error is good enough.
    if (res.ok || res.status === 404) {
      return { name, status: "ok", detail: `gateway reachable (${safeBase}), auth mode: ${mode}` };
    }
    if (res.status === 401 || res.status === 403) {
      return { name, status: "fail", detail: `${res.status} from gateway ${safeBase}, check gateway credentials` };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status} from gateway ${safeBase}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err) };
  }
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
      detail: `Invalid DD_SITE "${site}" — expected a hostname like datadoghq.com or datadoghq.eu`,
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
          "403 Forbidden — check DD_API_KEY and DD_APP_KEY at https://app.datadoghq.com/organization-settings/api-keys",
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
        detail: "401 Unauthorized — check SENTRY_AUTH_TOKEN at https://sentry.io/settings/auth-tokens/",
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
        return { name, status: "fail", detail: "GraphQL error — check LINEAR_API_KEY" };
      }
      const displayName = body.data?.viewer?.name ?? "authenticated";
      return { name, status: "ok", detail: `Authenticated as ${displayName}` };
    }
    if (res.status === 401) {
      return {
        name,
        status: "fail",
        detail: "401 Unauthorized — check LINEAR_API_KEY at https://linear.app/settings/api",
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
        detail: "401 Bad credentials — check GITHUB_TOKEN at https://github.com/settings/tokens",
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err) };
  }
}

function networkErrorMessage(err: unknown): string {
  // AbortSignal.timeout fires a DOMException with name "TimeoutError"; an
  // explicit abort surfaces as "AbortError". Either means we gave up waiting.
  const errName = err instanceof Error ? err.name : "";
  if (errName === "TimeoutError" || errName === "AbortError") {
    return `Connection timed out after ${CHECK_TIMEOUT_MS}ms — host unreachable or too slow`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return `Network error — check your internet connection (${msg})`;
  }
  return msg;
}
