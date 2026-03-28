import type { McpAutoConfig, McpServerConfig } from "./types.js";

/**
 * Auto-configure MCP servers — simplified to just GitHub and Linear.
 */
export function buildAutoMcpServers(config: McpAutoConfig): Record<string, McpServerConfig> {
  const auto: Record<string, McpServerConfig> = {};
  const creds = config.credentials;

  // GitHub only
  const githubToken = creds.GITHUB_TOKEN;
  if (githubToken) {
    auto["github"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
    };
  }

  // Linear only
  const linearApiKey = creds.LINEAR_API_KEY;
  if (linearApiKey) {
    auto["linear"] = {
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${linearApiKey}` },
    };
  }

  // Removed: GitLab, Jira, Datadog, Sentry, New Relic, BetterStack,
  // Slack, Notion, PagerDuty, Monday, Asana

  return { ...auto, ...(config.userMcpServers ?? {}) };
}

// Removed: buildProviderContext, ProviderContextOptions
