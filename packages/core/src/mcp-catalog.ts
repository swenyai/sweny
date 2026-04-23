/**
 * MCP Provider Catalog — single source of truth for provider/MCP wiring.
 *
 * Before this catalog existed, `buildSkillMcpServers` (skill-driven) and
 * `buildAutoMcpServers` (flag-driven, legacy triage/implement) each encoded
 * the same transport/auth/env for every provider. Drift was inevitable.
 *
 * Each entry declares:
 *   - which trigger paths (skill id, provider flag, workspace tool) wire it
 *   - how to build the McpServerConfig from credentials
 *   - whether the server uses stdio or http transport
 *   - if stdio: why the `npx -y` policy exception is acceptable (Fix #18)
 *
 * Adding a provider is a one-place edit. A module-load assertion and a
 * test enforce that every stdio entry declares its exception reason.
 */

import type { McpServerConfig } from "./types.js";

export interface McpCatalogEntry {
  /** Canonical server id. Used as the key in the returned `Record<string, McpServerConfig>`. */
  id: string;
  /** Which trigger paths wire this server. Most entries match both skill-driven and flag-driven paths. */
  triggers: {
    /** Skill IDs that should wire this server (skill-driven path). */
    skill?: string[];
    /** Matching values for `sourceControlProvider` (flag-driven path). */
    sourceControl?: string[];
    /** Matching values for `issueTrackerProvider` (flag-driven path). */
    issueTracker?: string[];
    /** Matching entries in `observabilityProviders` (flag-driven path). */
    observability?: string[];
    /** Matching entries in `workspaceTools` (flag-driven path). */
    workspaceTool?: string[];
  };
  /** Build the MCP server config from creds. Returns undefined if required creds are missing. */
  wire: (creds: Record<string, string>) => McpServerConfig | undefined;
  /** Transport family. Informational + policy enforcement (Fix #18). */
  transport: "http" | "stdio";
  /**
   * For stdio servers, why `npx -y` is allowed. Null forbids the exception.
   * Http servers must set this to null (no exception needed).
   *
   * ARCHITECTURE.md documents the acceptable reasons (official first-party
   * vendor server with no public HTTP endpoint, etc.).
   */
  npxExceptionReason: string | null;
}

// ── Catalog entries ─────────────────────────────────────────────────

const github: McpCatalogEntry = {
  id: "github",
  triggers: {
    skill: ["github"],
    sourceControl: ["github"],
    issueTracker: ["github-issues"],
  },
  transport: "stdio",
  npxExceptionReason: "Official @modelcontextprotocol/server-github; no public HTTP MCP endpoint.",
  wire: (creds) => {
    if (!creds.GITHUB_TOKEN) return undefined;
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: creds.GITHUB_TOKEN },
    };
  },
};

const gitlab: McpCatalogEntry = {
  id: "gitlab",
  triggers: {
    skill: ["gitlab"],
    sourceControl: ["gitlab"],
  },
  transport: "stdio",
  npxExceptionReason: "Official @modelcontextprotocol/server-gitlab; no public HTTP MCP endpoint.",
  wire: (creds) => {
    if (!creds.GITLAB_TOKEN) return undefined;
    const env: Record<string, string> = { GITLAB_PERSONAL_ACCESS_TOKEN: creds.GITLAB_TOKEN };
    const baseUrl = creds.GITLAB_URL || "https://gitlab.com";
    if (baseUrl !== "https://gitlab.com") env.GITLAB_API_URL = `${baseUrl}/api/v4`;
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gitlab@latest"],
      env,
    };
  },
};

const linear: McpCatalogEntry = {
  id: "linear",
  triggers: {
    skill: ["linear"],
    issueTracker: ["linear"],
  },
  transport: "http",
  npxExceptionReason: null,
  wire: (creds) => {
    if (!creds.LINEAR_API_KEY) return undefined;
    return {
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${creds.LINEAR_API_KEY}` },
    };
  },
};

const jira: McpCatalogEntry = {
  id: "jira",
  triggers: {
    skill: ["jira"],
    issueTracker: ["jira"],
  },
  transport: "stdio",
  npxExceptionReason:
    "Atlassian has no first-party MCP server; @sooperset/mcp-atlassian is the de-facto community standard. Revisit if Atlassian ships one.",
  wire: (creds) => {
    if (!creds.JIRA_URL || !creds.JIRA_EMAIL || !creds.JIRA_API_TOKEN) return undefined;
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sooperset/mcp-atlassian@latest"],
      env: {
        JIRA_URL: creds.JIRA_URL,
        JIRA_EMAIL: creds.JIRA_EMAIL,
        JIRA_API_TOKEN: creds.JIRA_API_TOKEN,
      },
    };
  },
};

const datadog: McpCatalogEntry = {
  id: "datadog",
  triggers: {
    skill: ["datadog"],
    observability: ["datadog"],
  },
  transport: "http",
  npxExceptionReason: null,
  wire: (creds) => {
    if (!creds.DD_API_KEY || !creds.DD_APP_KEY) return undefined;
    return {
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: creds.DD_API_KEY, DD_APPLICATION_KEY: creds.DD_APP_KEY },
    };
  },
};

const sentry: McpCatalogEntry = {
  id: "sentry",
  triggers: {
    skill: ["sentry"],
    observability: ["sentry"],
  },
  transport: "stdio",
  npxExceptionReason: "Official @sentry/mcp-server; no public HTTP MCP endpoint.",
  wire: (creds) => {
    if (!creds.SENTRY_AUTH_TOKEN) return undefined;
    const env: Record<string, string> = { SENTRY_ACCESS_TOKEN: creds.SENTRY_AUTH_TOKEN };
    const sentryUrl = creds.SENTRY_URL;
    if (sentryUrl && sentryUrl !== "https://sentry.io") {
      try {
        env.SENTRY_HOST = new URL(sentryUrl).hostname;
      } catch {
        // malformed URL — leave SENTRY_HOST unset, server defaults to sentry.io
      }
    }
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp-server@latest"],
      env,
    };
  },
};

const newrelic: McpCatalogEntry = {
  id: "newrelic",
  triggers: {
    skill: ["newrelic"],
    observability: ["newrelic"],
  },
  transport: "http",
  npxExceptionReason: null,
  wire: (creds) => {
    if (!creds.NEW_RELIC_API_KEY) return undefined;
    const region = creds.NEW_RELIC_REGION;
    const url = region === "eu" ? "https://mcp.eu.newrelic.com/mcp/" : "https://mcp.newrelic.com/mcp/";
    return {
      type: "http",
      url,
      headers: { "Api-Key": creds.NEW_RELIC_API_KEY },
    };
  },
};

const betterstack: McpCatalogEntry = {
  id: "betterstack",
  triggers: {
    skill: ["betterstack"],
    observability: ["betterstack"],
  },
  transport: "http",
  npxExceptionReason: null,
  wire: (creds) => {
    const token = creds.BETTERSTACK_API_TOKEN || creds.BETTERSTACK_TELEMETRY_TOKEN || creds.BETTERSTACK_UPTIME_TOKEN;
    if (!token) return undefined;
    return {
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: `Bearer ${token}` },
    };
  },
};

const slack: McpCatalogEntry = {
  id: "slack",
  triggers: {
    skill: ["slack"],
    workspaceTool: ["slack"],
  },
  transport: "stdio",
  npxExceptionReason: "Official @modelcontextprotocol/server-slack; no public HTTP MCP endpoint.",
  wire: (creds) => {
    if (!creds.SLACK_BOT_TOKEN) return undefined;
    const env: Record<string, string> = { SLACK_BOT_TOKEN: creds.SLACK_BOT_TOKEN };
    if (creds.SLACK_TEAM_ID) env.SLACK_TEAM_ID = creds.SLACK_TEAM_ID;
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack@latest"],
      env,
    };
  },
};

const notion: McpCatalogEntry = {
  id: "notion",
  triggers: {
    skill: ["notion"],
    workspaceTool: ["notion"],
  },
  transport: "stdio",
  npxExceptionReason: "Official @notionhq/notion-mcp-server; no public HTTP MCP endpoint.",
  wire: (creds) => {
    const token = creds.NOTION_TOKEN || creds.NOTION_API_KEY;
    if (!token) return undefined;
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server@latest"],
      env: { NOTION_TOKEN: token },
    };
  },
};

const pagerduty: McpCatalogEntry = {
  id: "pagerduty",
  triggers: {
    skill: ["pagerduty"],
    workspaceTool: ["pagerduty"],
  },
  transport: "http",
  npxExceptionReason: null,
  wire: (creds) => {
    if (!creds.PAGERDUTY_API_TOKEN) return undefined;
    return {
      type: "http",
      url: "https://mcp.pagerduty.com/mcp",
      headers: { Authorization: `Token token=${creds.PAGERDUTY_API_TOKEN}` },
    };
  },
};

const monday: McpCatalogEntry = {
  id: "monday",
  triggers: {
    skill: ["monday"],
    workspaceTool: ["monday"],
  },
  transport: "stdio",
  npxExceptionReason: "Official @mondaydotcomorg/monday-api-mcp; no public HTTP MCP endpoint.",
  wire: (creds) => {
    if (!creds.MONDAY_TOKEN) return undefined;
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
      env: { MONDAY_TOKEN: creds.MONDAY_TOKEN },
    };
  },
};

// asana was removed in Fix #15 — absent from SUPPORTED_WORKSPACE_TOOLS for
// some time, and the asana-mcp package is community-maintained without a
// clear first-party alternative. Add back in a dedicated catalog entry if
// there's demand and a policy-compliant server to wire.

// ── Assembled catalog ────────────────────────────────────────────────

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  github,
  gitlab,
  linear,
  jira,
  datadog,
  sentry,
  newrelic,
  betterstack,
  slack,
  notion,
  pagerduty,
  monday,
];

// ── Policy enforcement ──────────────────────────────────────────────

/**
 * Assert the `npx -y` policy (Fix #18). Thrown at module load and also
 * asserted by the test suite, so a stdio entry missing `npxExceptionReason`
 * never reaches shipping.
 */
function assertNpxPolicyCompliant(entries: readonly McpCatalogEntry[]): void {
  for (const entry of entries) {
    if (entry.transport === "stdio" && entry.npxExceptionReason === null) {
      throw new Error(
        `MCP catalog entry "${entry.id}" uses stdio transport but declares no npxExceptionReason. ` +
          `Stdio entries must document why the npx -y exception is acceptable. See ARCHITECTURE.md.`,
      );
    }
    if (entry.transport === "http" && entry.npxExceptionReason !== null) {
      throw new Error(
        `MCP catalog entry "${entry.id}" uses http transport but declares an npxExceptionReason. ` +
          `Only stdio entries need an exception reason; set it to null for http entries.`,
      );
    }
  }
}

assertNpxPolicyCompliant(MCP_CATALOG);
