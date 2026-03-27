import type { McpAutoConfig, McpServerConfig } from "./types.js";

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
  // Injected whenever the token is present (not just when it's the primary provider)
  // because BetterStack logs complement any primary observability provider.
  const bsApiToken = creds.BETTERSTACK_API_TOKEN;
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
