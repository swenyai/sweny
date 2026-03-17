import type { CliConfig } from "./config.js";

export interface CheckResult {
  name: string;
  status: "ok" | "fail" | "skip";
  detail: string;
}

/**
 * Run lightweight connectivity checks for all configured providers.
 * Uses raw fetch — does NOT import @sweny-ai/providers.
 */
export async function checkProviderConnectivity(config: CliConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const githubChecked = { done: false }; // avoid double-checking same token

  // ── Coding agent ────────────────────────────────────────────────────────────
  if (config.codingAgentProvider === "claude") {
    if (!config.anthropicApiKey && !config.claudeOauthToken) {
      results.push({ name: "Anthropic (claude agent)", status: "skip", detail: "No key configured" });
    } else if (config.anthropicApiKey) {
      results.push(await checkAnthropic(config.anthropicApiKey));
    } else {
      results.push({
        name: "Anthropic (claude agent)",
        status: "skip",
        detail: "CLAUDE_CODE_OAUTH_TOKEN set — skipping API check",
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
  if (config.observabilityProvider === "datadog") {
    results.push(await checkDatadog(config.observabilityCredentials));
  } else if (config.observabilityProvider === "sentry") {
    results.push(await checkSentry(config.observabilityCredentials));
  } else if (config.observabilityProvider === "file") {
    results.push({ name: "Observability (file)", status: "skip", detail: "File provider — no network check needed" });
  } else {
    results.push({
      name: `Observability (${config.observabilityProvider})`,
      status: "skip",
      detail: "Connectivity check not implemented for this provider",
    });
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

async function checkDatadog(creds: Record<string, string>): Promise<CheckResult> {
  const name = "Observability (datadog)";
  const { apiKey, appKey, site = "datadoghq.com" } = creds;
  if (!apiKey || !appKey) {
    return { name, status: "skip", detail: "DD_API_KEY or DD_APP_KEY not configured" };
  }
  try {
    const res = await fetch(`https://api.${site}/api/v2/validate`, {
      headers: { "DD-API-KEY": apiKey, "DD-APPLICATION-KEY": appKey },
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
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return `Network error — check your internet connection (${msg})`;
  }
  return msg;
}
