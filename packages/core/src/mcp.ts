import type { McpAutoConfig, McpServerConfig } from "./types.js";

// ── Skill-driven MCP wiring ─────────────────────────────────────────
//
// `buildSkillMcpServers` is the engine-driven path: workflow nodes declare
// skills, and the engine wires MCPs for any of those skills whose env vars
// are present. This is the preferred path for `sweny workflow run`.
//
// `buildAutoMcpServers` (below) is the legacy provider-flag-driven path
// used by `sweny triage` / `sweny implement`. It is retained so those
// commands keep working unchanged; over time they should migrate to the
// skill-driven path too.

export interface SkillMcpOptions {
  /** Skill IDs referenced by the workflow being executed. Only these get MCPs. */
  referencedSkills: Set<string>;
  /** Flat credential map (env vars). MCPs are only wired when their creds are set. */
  credentials: Record<string, string>;
  /** User-supplied MCP servers — always win on key conflict. */
  userMcpServers?: Record<string, McpServerConfig>;
}

/**
 * Build MCP server configs for the skills a workflow references.
 *
 * For each skill ID in `referencedSkills`, look up its MCP wiring (if any)
 * and include it only when the required credentials are present in `credentials`.
 *
 * Skills with no MCP variant (e.g. `notification`, `supabase`) are silently
 * skipped — their in-process tools are wired separately by the executor.
 *
 * Unknown skill IDs (not built-in, not in this MCP catalog) are silently
 * skipped here; the engine's hard-fail validation handles them upstream.
 *
 * User-supplied servers always win on key conflict.
 */
export function buildSkillMcpServers(opts: SkillMcpOptions): Record<string, McpServerConfig> {
  const auto: Record<string, McpServerConfig> = {};
  const refs = opts.referencedSkills;
  const creds = opts.credentials;

  // GitHub MCP — wired when workflow uses `github` skill and a token is set.
  if (refs.has("github") && creds.GITHUB_TOKEN) {
    auto["github"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: creds.GITHUB_TOKEN },
    };
  }

  // GitLab MCP.
  if (refs.has("gitlab") && creds.GITLAB_TOKEN) {
    const env: Record<string, string> = { GITLAB_PERSONAL_ACCESS_TOKEN: creds.GITLAB_TOKEN };
    const baseUrl = creds.GITLAB_URL || "https://gitlab.com";
    if (baseUrl !== "https://gitlab.com") env.GITLAB_API_URL = `${baseUrl}/api/v4`;
    auto["gitlab"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gitlab@latest"],
      env,
    };
  }

  // Linear MCP — official remote HTTP endpoint.
  if (refs.has("linear") && creds.LINEAR_API_KEY) {
    auto["linear"] = {
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${creds.LINEAR_API_KEY}` },
    };
  }

  // Jira / Confluence — needs all 3 creds.
  if (refs.has("jira") && creds.JIRA_URL && creds.JIRA_EMAIL && creds.JIRA_API_TOKEN) {
    auto["jira"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sooperset/mcp-atlassian@latest"],
      env: {
        JIRA_URL: creds.JIRA_URL,
        JIRA_EMAIL: creds.JIRA_EMAIL,
        JIRA_API_TOKEN: creds.JIRA_API_TOKEN,
      },
    };
  }

  // Datadog MCP.
  if (refs.has("datadog") && creds.DD_API_KEY && creds.DD_APP_KEY) {
    auto["datadog"] = {
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: creds.DD_API_KEY, DD_APPLICATION_KEY: creds.DD_APP_KEY },
    };
  }

  // Sentry MCP — server reads SENTRY_ACCESS_TOKEN, not SENTRY_AUTH_TOKEN.
  if (refs.has("sentry") && creds.SENTRY_AUTH_TOKEN) {
    const env: Record<string, string> = { SENTRY_ACCESS_TOKEN: creds.SENTRY_AUTH_TOKEN };
    const sentryUrl = creds.SENTRY_URL;
    if (sentryUrl && sentryUrl !== "https://sentry.io") {
      try {
        env.SENTRY_HOST = new URL(sentryUrl).hostname;
      } catch {
        // malformed URL — leave SENTRY_HOST unset
      }
    }
    auto["sentry"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp-server@latest"],
      env,
    };
  }

  // New Relic MCP — region-aware HTTP endpoint, header is "Api-Key".
  if (refs.has("newrelic") && creds.NEW_RELIC_API_KEY) {
    const region = creds.NEW_RELIC_REGION;
    const url = region === "eu" ? "https://mcp.eu.newrelic.com/mcp/" : "https://mcp.newrelic.com/mcp/";
    auto["newrelic"] = {
      type: "http",
      url,
      headers: { "Api-Key": creds.NEW_RELIC_API_KEY },
    };
  }

  // BetterStack MCP — accept any of the legacy/telemetry/uptime tokens.
  const bsToken = creds.BETTERSTACK_API_TOKEN || creds.BETTERSTACK_TELEMETRY_TOKEN || creds.BETTERSTACK_UPTIME_TOKEN;
  if (refs.has("betterstack") && bsToken) {
    auto["betterstack"] = {
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: `Bearer ${bsToken}` },
    };
  }

  // Slack MCP — wired when workflow uses `slack` skill and bot token is set.
  if (refs.has("slack") && creds.SLACK_BOT_TOKEN) {
    const env: Record<string, string> = { SLACK_BOT_TOKEN: creds.SLACK_BOT_TOKEN };
    if (creds.SLACK_TEAM_ID) env.SLACK_TEAM_ID = creds.SLACK_TEAM_ID;
    auto["slack"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack@latest"],
      env,
    };
  }

  // Notion MCP — accept either NOTION_TOKEN or NOTION_API_KEY.
  if (refs.has("notion")) {
    const token = creds.NOTION_TOKEN || creds.NOTION_API_KEY;
    if (token) {
      auto["notion"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server@latest"],
        env: { NOTION_TOKEN: token },
      };
    }
  }

  // PagerDuty MCP — auth scheme is `Token token=<key>`.
  if (refs.has("pagerduty") && creds.PAGERDUTY_API_TOKEN) {
    auto["pagerduty"] = {
      type: "http",
      url: "https://mcp.pagerduty.com/mcp",
      headers: { Authorization: `Token token=${creds.PAGERDUTY_API_TOKEN}` },
    };
  }

  // Monday.com MCP.
  if (refs.has("monday") && creds.MONDAY_TOKEN) {
    auto["monday"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
      env: { MONDAY_TOKEN: creds.MONDAY_TOKEN },
    };
  }

  // Asana MCP.
  if (refs.has("asana") && creds.ASANA_ACCESS_TOKEN) {
    auto["asana"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "asana-mcp@latest"],
      env: { ASANA_ACCESS_TOKEN: creds.ASANA_ACCESS_TOKEN },
    };
  }

  // User-supplied servers always win on key conflict.
  return { ...auto, ...(opts.userMcpServers ?? {}) };
}

/**
 * Auto-configure well-known MCP servers based on which providers
 * and workspace tools the user has enabled.
 *
 * Category A: triggered by sourceControlProvider / issueTrackerProvider / observabilityProvider
 * Category B: workspace tools — explicit opt-in via workspaceTools array
 *
 * User-supplied servers (userMcpServers) always win on key conflicts.
 */
export function buildAutoMcpServers(config: McpAutoConfig): Record<string, McpServerConfig> {
  const auto: Record<string, McpServerConfig> = {};
  const creds = config.credentials;

  // ── Category A: Provider-config triggered ──────────────────────

  // GitHub MCP — inject when using GitHub source control OR GitHub Issues tracker.
  // @modelcontextprotocol/server-github requires GITHUB_PERSONAL_ACCESS_TOKEN.
  const githubToken = creds.GITHUB_TOKEN;
  if ((config.sourceControlProvider === "github" || config.issueTrackerProvider === "github-issues") && githubToken) {
    auto["github"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
    };
  }

  // GitLab MCP — inject when source control provider is gitlab.
  const gitlabToken = creds.GITLAB_TOKEN;
  if (config.sourceControlProvider === "gitlab" && gitlabToken) {
    const gitlabEnv: Record<string, string> = { GITLAB_PERSONAL_ACCESS_TOKEN: gitlabToken };
    const baseUrl = creds.GITLAB_URL || "https://gitlab.com";
    if (baseUrl !== "https://gitlab.com") {
      gitlabEnv.GITLAB_API_URL = `${baseUrl}/api/v4`;
    }
    auto["gitlab"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gitlab@latest"],
      env: gitlabEnv,
    };
  }

  // Linear MCP — official HTTP remote MCP endpoint.
  const linearApiKey = creds.LINEAR_API_KEY;
  if (config.issueTrackerProvider === "linear" && linearApiKey) {
    auto["linear"] = {
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${linearApiKey}` },
    };
  }

  // Jira / Confluence (Atlassian) MCP — needs all 3 credentials.
  const jiraUrl = creds.JIRA_URL;
  const jiraEmail = creds.JIRA_EMAIL;
  const jiraApiToken = creds.JIRA_API_TOKEN;
  if (config.issueTrackerProvider === "jira" && jiraUrl && jiraEmail && jiraApiToken) {
    auto["jira"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sooperset/mcp-atlassian@latest"],
      env: {
        JIRA_URL: jiraUrl,
        JIRA_EMAIL: jiraEmail,
        JIRA_API_TOKEN: jiraApiToken,
      },
    };
  }

  // Datadog MCP — HTTP transport.
  const ddApiKey = creds.DD_API_KEY;
  const ddAppKey = creds.DD_APP_KEY;
  if (config.observabilityProvider === "datadog" && ddApiKey && ddAppKey) {
    auto["datadog"] = {
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: ddApiKey, DD_APPLICATION_KEY: ddAppKey },
    };
  }

  // Sentry MCP — @sentry/mcp-server reads SENTRY_ACCESS_TOKEN (not SENTRY_AUTH_TOKEN).
  const sentryAuthToken = creds.SENTRY_AUTH_TOKEN;
  if (config.observabilityProvider === "sentry" && sentryAuthToken) {
    const sentryEnv: Record<string, string> = { SENTRY_ACCESS_TOKEN: sentryAuthToken };
    const sentryUrl = creds.SENTRY_URL;
    if (sentryUrl && sentryUrl !== "https://sentry.io") {
      try {
        sentryEnv.SENTRY_HOST = new URL(sentryUrl).hostname;
      } catch {
        // malformed URL — leave SENTRY_HOST unset, server defaults to sentry.io
      }
    }
    auto["sentry"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp-server@latest"],
      env: sentryEnv,
    };
  }

  // New Relic MCP — HTTP transport; region-aware endpoint.
  // Header key is "Api-Key" (not "Authorization"), unique to New Relic's MCP.
  // Trailing slash is intentional — New Relic's MCP spec requires it.
  const nrApiKey = creds.NEW_RELIC_API_KEY;
  if (config.observabilityProvider === "newrelic" && nrApiKey) {
    const nrRegion = creds.NEW_RELIC_REGION;
    const nrEndpoint = nrRegion === "eu" ? "https://mcp.eu.newrelic.com/mcp/" : "https://mcp.newrelic.com/mcp/";
    auto["newrelic"] = {
      type: "http",
      url: nrEndpoint,
      headers: { "Api-Key": nrApiKey },
    };
  }

  // Better Stack MCP — HTTP remote MCP; Bearer token auth.
  // BetterStack uses separate tokens for Uptime vs Telemetry APIs.
  // The MCP server accepts the telemetry token for log/metric queries.
  // Accept: BETTERSTACK_API_TOKEN (legacy), BETTERSTACK_TELEMETRY_TOKEN, or BETTERSTACK_UPTIME_TOKEN.
  // Injected whenever any token is present (not just when it's the primary provider)
  // because BetterStack logs complement any primary observability provider.
  const bsApiToken = creds.BETTERSTACK_API_TOKEN || creds.BETTERSTACK_TELEMETRY_TOKEN || creds.BETTERSTACK_UPTIME_TOKEN;
  if (bsApiToken) {
    auto["betterstack"] = {
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: `Bearer ${bsApiToken}` },
    };
  }

  // ── Category B: Workspace tools (explicit opt-in) ──────────────

  const tools = new Set(config.workspaceTools ?? []);

  // Slack MCP — requires opt-in AND SLACK_BOT_TOKEN.
  if (tools.has("slack")) {
    const slackBotToken = creds.SLACK_BOT_TOKEN;
    if (slackBotToken) {
      const slackEnv: Record<string, string> = { SLACK_BOT_TOKEN: slackBotToken };
      if (creds.SLACK_TEAM_ID) slackEnv.SLACK_TEAM_ID = creds.SLACK_TEAM_ID;
      auto["slack"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-slack@latest"],
        env: slackEnv,
      };
    }
  }

  // Notion MCP — requires opt-in; accepts NOTION_TOKEN or NOTION_API_KEY.
  if (tools.has("notion")) {
    const notionToken = creds.NOTION_TOKEN || creds.NOTION_API_KEY;
    if (notionToken) {
      auto["notion"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server@latest"],
        env: { NOTION_TOKEN: notionToken },
      };
    }
  }

  // PagerDuty MCP — HTTP remote endpoint; auth uses "Token token=<key>".
  if (tools.has("pagerduty")) {
    const pagerdutyToken = creds.PAGERDUTY_API_TOKEN;
    if (pagerdutyToken) {
      auto["pagerduty"] = {
        type: "http",
        url: "https://mcp.pagerduty.com/mcp",
        headers: { Authorization: `Token token=${pagerdutyToken}` },
      };
    }
  }

  // Monday.com MCP — requires opt-in AND MONDAY_TOKEN.
  if (tools.has("monday")) {
    const mondayToken = creds.MONDAY_TOKEN;
    if (mondayToken) {
      auto["monday"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
        env: { MONDAY_TOKEN: mondayToken },
      };
    }
  }

  // Asana MCP — requires opt-in AND ASANA_ACCESS_TOKEN.
  if (tools.has("asana")) {
    const asanaToken = creds.ASANA_ACCESS_TOKEN;
    if (asanaToken) {
      auto["asana"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "asana-mcp@latest"],
        env: { ASANA_ACCESS_TOKEN: asanaToken },
      };
    }
  }

  // User-supplied servers always win on key conflict.
  return { ...auto, ...(config.userMcpServers ?? {}) };
}

// ── Provider context for dynamic instruction injection ─────────────

export interface ProviderContextOptions {
  observabilityProvider?: string;
  issueTrackerProvider?: string;
  sourceControlProvider?: string;
  /** Which MCP servers were actually injected (keys from buildAutoMcpServers) */
  mcpServers: string[];
  /** Extra details to include (e.g. betterstack source ID) */
  extras?: Record<string, string>;
}

/**
 * Build a human-readable summary of configured providers and MCP tools.
 * Prepended to every node instruction via additionalContext so the agent
 * knows exactly what tools are available and how to use them.
 */
export function buildProviderContext(opts: ProviderContextOptions): string {
  const lines: string[] = ["## Available Providers & Tools", ""];

  // Observability
  if (opts.observabilityProvider) {
    const mcpNote = opts.mcpServers.includes(opts.observabilityProvider)
      ? ` (available via MCP — use its tools to query logs, errors, and metrics)`
      : "";
    lines.push(`- **Observability**: ${opts.observabilityProvider}${mcpNote}`);
  }

  // BetterStack as secondary (token present but not primary provider)
  if (opts.observabilityProvider !== "betterstack" && opts.mcpServers.includes("betterstack")) {
    lines.push(`- **Logs**: betterstack (available via MCP — use its tools to query logs)`);
  }

  // Issue tracker
  if (opts.issueTrackerProvider) {
    const mcpNote = opts.mcpServers.includes(
      opts.issueTrackerProvider === "github-issues" ? "github" : opts.issueTrackerProvider,
    )
      ? ` (available via MCP)`
      : "";
    lines.push(`- **Issue tracker**: ${opts.issueTrackerProvider}${mcpNote}`);
  }

  // Source control
  if (opts.sourceControlProvider) {
    const mcpNote = opts.mcpServers.includes(opts.sourceControlProvider) ? ` (available via MCP)` : "";
    lines.push(`- **Source control**: ${opts.sourceControlProvider}${mcpNote}`);
  }

  // Extras (source IDs, table names, etc.)
  if (opts.extras && Object.keys(opts.extras).length > 0) {
    lines.push("");
    for (const [key, value] of Object.entries(opts.extras)) {
      lines.push(`- **${key}**: ${value}`);
    }
  }

  lines.push("");
  lines.push(
    "Use all available MCP tools to gather data. " + "MCP tools are already connected — just call them directly.",
  );

  return lines.join("\n");
}
