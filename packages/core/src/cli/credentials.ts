/**
 * Read env vars into the flat credential map expected by buildAutoMcpServers
 * and buildSkillMcpServers.
 *
 * Several env vars have two accepted spellings — the user-facing one
 * (`NR_API_KEY`, `JIRA_BASE_URL`, `SENTRY_BASE_URL`, …) used in init.ts,
 * config.ts, and docs, and the canonical one used by the MCP wiring layer
 * (`NEW_RELIC_API_KEY`, `JIRA_URL`, `SENTRY_URL`, …). We accept either
 * spelling and write the value under the canonical key the wiring functions
 * look up. The user-facing spelling wins on conflict (it's what docs tell
 * users to set).
 */
export function buildCredentialMap(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const creds: Record<string, string> = {};

  // [aliases…, canonical lookup key]
  // Earlier aliases win on conflict — first non-empty match populates the canonical key.
  const sources: Array<[string[], string]> = [
    [["GITHUB_TOKEN"], "GITHUB_TOKEN"],
    [["GITLAB_TOKEN"], "GITLAB_TOKEN"],
    [["GITLAB_URL"], "GITLAB_URL"],
    [["LINEAR_API_KEY"], "LINEAR_API_KEY"],

    // User-facing JIRA_BASE_URL → canonical JIRA_URL (the key the MCP layer reads).
    [["JIRA_BASE_URL", "JIRA_URL"], "JIRA_URL"],
    [["JIRA_EMAIL"], "JIRA_EMAIL"],
    [["JIRA_API_TOKEN"], "JIRA_API_TOKEN"],

    [["DD_API_KEY"], "DD_API_KEY"],
    [["DD_APP_KEY"], "DD_APP_KEY"],

    [["SENTRY_AUTH_TOKEN"], "SENTRY_AUTH_TOKEN"],
    [["SENTRY_ORG"], "SENTRY_ORG"],
    // User-facing SENTRY_BASE_URL → canonical SENTRY_URL.
    [["SENTRY_BASE_URL", "SENTRY_URL"], "SENTRY_URL"],

    // User-facing NR_* → canonical NEW_RELIC_*.
    [["NR_API_KEY", "NEW_RELIC_API_KEY"], "NEW_RELIC_API_KEY"],
    [["NR_REGION", "NEW_RELIC_REGION"], "NEW_RELIC_REGION"],

    [["BETTERSTACK_API_TOKEN"], "BETTERSTACK_API_TOKEN"],
    [["BETTERSTACK_TELEMETRY_TOKEN"], "BETTERSTACK_TELEMETRY_TOKEN"],
    [["BETTERSTACK_UPTIME_TOKEN"], "BETTERSTACK_UPTIME_TOKEN"],
    [["BETTERSTACK_SOURCE_ID"], "BETTERSTACK_SOURCE_ID"],
    [["BETTERSTACK_TABLE_NAME"], "BETTERSTACK_TABLE_NAME"],

    [["SLACK_BOT_TOKEN"], "SLACK_BOT_TOKEN"],
    [["SLACK_TEAM_ID"], "SLACK_TEAM_ID"],

    // mcp.ts accepts either NOTION_TOKEN or NOTION_API_KEY — populate both
    // canonical keys so either env-var name reaches the wiring layer.
    [["NOTION_TOKEN"], "NOTION_TOKEN"],
    [["NOTION_API_KEY"], "NOTION_API_KEY"],

    [["PAGERDUTY_API_TOKEN"], "PAGERDUTY_API_TOKEN"],
    [["MONDAY_TOKEN"], "MONDAY_TOKEN"],
    [["ASANA_ACCESS_TOKEN"], "ASANA_ACCESS_TOKEN"],
  ];

  for (const [aliases, canonical] of sources) {
    for (const alias of aliases) {
      const v = env[alias];
      if (v) {
        creds[canonical] = v;
        break;
      }
    }
  }

  return creds;
}
