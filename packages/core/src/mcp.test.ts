import { describe, it, expect } from "vitest";
import { buildAutoMcpServers } from "./mcp.js";
import type { McpAutoConfig } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────

function cfg(overrides: Partial<McpAutoConfig> = {}): McpAutoConfig {
  return { credentials: {}, ...overrides };
}

// ─── Empty / no providers ─────────────────────────────────────────

describe("buildAutoMcpServers", () => {
  it("returns empty object when no providers configured", () => {
    const result = buildAutoMcpServers(cfg());
    expect(result).toEqual({});
  });

  // ── GitHub MCP ──────────────────────────────────────────────────

  it("injects GitHub MCP when sourceControlProvider is github with GITHUB_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({ sourceControlProvider: "github", credentials: { GITHUB_TOKEN: "ghp_abc" } }),
    );
    expect(result["github"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abc" },
    });
  });

  it("injects GitHub MCP when issueTrackerProvider is github-issues with GITHUB_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({ issueTrackerProvider: "github-issues", credentials: { GITHUB_TOKEN: "ghp_xyz" } }),
    );
    expect(result["github"]).toMatchObject({
      type: "stdio",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_xyz" },
    });
  });

  it("does NOT inject GitHub MCP without GITHUB_TOKEN", () => {
    const result = buildAutoMcpServers(cfg({ sourceControlProvider: "github", credentials: {} }));
    expect(result["github"]).toBeUndefined();
  });

  // ── Linear MCP ──────────────────────────────────────────────────

  it("injects Linear MCP (HTTP) when issueTrackerProvider is linear with LINEAR_API_KEY", () => {
    const result = buildAutoMcpServers(
      cfg({ issueTrackerProvider: "linear", credentials: { LINEAR_API_KEY: "lin_key_abc" } }),
    );
    expect(result["linear"]).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer lin_key_abc" },
    });
  });

  it("does NOT inject Linear MCP without LINEAR_API_KEY", () => {
    const result = buildAutoMcpServers(cfg({ issueTrackerProvider: "linear", credentials: {} }));
    expect(result["linear"]).toBeUndefined();
  });

  // ── Datadog MCP ─────────────────────────────────────────────────

  it("injects Datadog MCP (HTTP) when observabilityProvider is datadog with DD_API_KEY + DD_APP_KEY", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "datadog",
        credentials: { DD_API_KEY: "dd_api", DD_APP_KEY: "dd_app" },
      }),
    );
    expect(result["datadog"]).toEqual({
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: "dd_api", DD_APPLICATION_KEY: "dd_app" },
    });
  });

  it("does NOT inject Datadog MCP when DD_APP_KEY is missing", () => {
    const result = buildAutoMcpServers(
      cfg({ observabilityProvider: "datadog", credentials: { DD_API_KEY: "dd_api" } }),
    );
    expect(result["datadog"]).toBeUndefined();
  });

  // ── Sentry MCP ──────────────────────────────────────────────────

  it("injects Sentry MCP (stdio) when observabilityProvider is sentry with SENTRY_AUTH_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({ observabilityProvider: "sentry", credentials: { SENTRY_AUTH_TOKEN: "sntryu_abc" } }),
    );
    expect(result["sentry"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp-server@latest"],
      env: { SENTRY_ACCESS_TOKEN: "sntryu_abc" },
    });
  });

  it("injects Sentry MCP with self-hosted SENTRY_HOST from SENTRY_URL", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "sentry",
        credentials: {
          SENTRY_AUTH_TOKEN: "sntryu_abc",
          SENTRY_URL: "https://sentry.mycompany.com",
        },
      }),
    );
    expect(result["sentry"]?.env).toMatchObject({
      SENTRY_ACCESS_TOKEN: "sntryu_abc",
      SENTRY_HOST: "sentry.mycompany.com",
    });
  });

  it("does NOT set SENTRY_HOST when SENTRY_URL is sentry.io", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "sentry",
        credentials: {
          SENTRY_AUTH_TOKEN: "sntryu_abc",
          SENTRY_URL: "https://sentry.io",
        },
      }),
    );
    expect(result["sentry"]?.env?.SENTRY_HOST).toBeUndefined();
  });

  it("handles malformed SENTRY_URL gracefully (no SENTRY_HOST set)", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "sentry",
        credentials: {
          SENTRY_AUTH_TOKEN: "sntryu_abc",
          SENTRY_URL: "not-a-url",
        },
      }),
    );
    expect(result["sentry"]).toBeDefined();
    expect(result["sentry"]?.env?.SENTRY_HOST).toBeUndefined();
  });

  // ── GitLab MCP ──────────────────────────────────────────────────

  it("injects GitLab MCP with self-hosted GITLAB_API_URL", () => {
    const result = buildAutoMcpServers(
      cfg({
        sourceControlProvider: "gitlab",
        credentials: {
          GITLAB_TOKEN: "glpat_abc",
          GITLAB_URL: "https://gitlab.mycompany.com",
        },
      }),
    );
    expect(result["gitlab"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gitlab@latest"],
      env: {
        GITLAB_PERSONAL_ACCESS_TOKEN: "glpat_abc",
        GITLAB_API_URL: "https://gitlab.mycompany.com/api/v4",
      },
    });
  });

  it("injects GitLab MCP without GITLAB_API_URL for gitlab.com", () => {
    const result = buildAutoMcpServers(
      cfg({
        sourceControlProvider: "gitlab",
        credentials: {
          GITLAB_TOKEN: "glpat_abc",
          GITLAB_URL: "https://gitlab.com",
        },
      }),
    );
    expect(result["gitlab"]?.env).toEqual({ GITLAB_PERSONAL_ACCESS_TOKEN: "glpat_abc" });
  });

  it("injects GitLab MCP without GITLAB_API_URL when GITLAB_URL is absent", () => {
    const result = buildAutoMcpServers(
      cfg({
        sourceControlProvider: "gitlab",
        credentials: { GITLAB_TOKEN: "glpat_abc" },
      }),
    );
    expect(result["gitlab"]?.env).toEqual({ GITLAB_PERSONAL_ACCESS_TOKEN: "glpat_abc" });
  });

  // ── New Relic MCP ───────────────────────────────────────────────

  it("injects New Relic MCP with EU region endpoint", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "newrelic",
        credentials: { NEW_RELIC_API_KEY: "NRAK-abc", NEW_RELIC_REGION: "eu" },
      }),
    );
    expect(result["newrelic"]).toEqual({
      type: "http",
      url: "https://mcp.eu.newrelic.com/mcp/",
      headers: { "Api-Key": "NRAK-abc" },
    });
  });

  it("injects New Relic MCP with US (default) region endpoint", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "newrelic",
        credentials: { NEW_RELIC_API_KEY: "NRAK-abc" },
      }),
    );
    expect(result["newrelic"]).toEqual({
      type: "http",
      url: "https://mcp.newrelic.com/mcp/",
      headers: { "Api-Key": "NRAK-abc" },
    });
  });

  // ── Better Stack MCP ────────────────────────────────────────────

  it("injects Better Stack MCP (HTTP) with Bearer token", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "betterstack",
        credentials: { BETTERSTACK_API_TOKEN: "bst_abc" },
      }),
    );
    expect(result["betterstack"]).toEqual({
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: "Bearer bst_abc" },
    });
  });

  it("injects Better Stack MCP even when primary provider is not betterstack", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProvider: "sentry",
        credentials: { BETTERSTACK_API_TOKEN: "bst_xyz", SENTRY_AUTH_TOKEN: "sntrx_test" },
      }),
    );
    expect(result["betterstack"]).toEqual({
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: "Bearer bst_xyz" },
    });
    // Sentry should also be present
    expect(result["sentry"]).toBeDefined();
  });

  // ── Jira MCP ────────────────────────────────────────────────────

  it("injects Jira MCP when all 3 credentials present", () => {
    const result = buildAutoMcpServers(
      cfg({
        issueTrackerProvider: "jira",
        credentials: {
          JIRA_URL: "https://mycompany.atlassian.net",
          JIRA_EMAIL: "user@example.com",
          JIRA_API_TOKEN: "jira_tok",
        },
      }),
    );
    expect(result["jira"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@sooperset/mcp-atlassian@latest"],
      env: {
        JIRA_URL: "https://mycompany.atlassian.net",
        JIRA_EMAIL: "user@example.com",
        JIRA_API_TOKEN: "jira_tok",
      },
    });
  });

  it("does NOT inject Jira MCP when JIRA_EMAIL is missing", () => {
    const result = buildAutoMcpServers(
      cfg({
        issueTrackerProvider: "jira",
        credentials: {
          JIRA_URL: "https://mycompany.atlassian.net",
          JIRA_API_TOKEN: "jira_tok",
        },
      }),
    );
    expect(result["jira"]).toBeUndefined();
  });

  // ── Workspace tools ─────────────────────────────────────────────

  it("injects Slack when opted in with SLACK_BOT_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["slack"],
        credentials: { SLACK_BOT_TOKEN: "xoxb-abc" },
      }),
    );
    expect(result["slack"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack@latest"],
      env: { SLACK_BOT_TOKEN: "xoxb-abc" },
    });
  });

  it("includes SLACK_TEAM_ID when present", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["slack"],
        credentials: { SLACK_BOT_TOKEN: "xoxb-abc", SLACK_TEAM_ID: "T123" },
      }),
    );
    expect(result["slack"]?.env).toMatchObject({
      SLACK_BOT_TOKEN: "xoxb-abc",
      SLACK_TEAM_ID: "T123",
    });
  });

  it("does NOT inject Slack without opt-in even if SLACK_BOT_TOKEN is present", () => {
    const result = buildAutoMcpServers(cfg({ credentials: { SLACK_BOT_TOKEN: "xoxb-abc" } }));
    expect(result["slack"]).toBeUndefined();
  });

  it("injects Notion when opted in with NOTION_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["notion"],
        credentials: { NOTION_TOKEN: "ntn_abc" },
      }),
    );
    expect(result["notion"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server@latest"],
      env: { NOTION_TOKEN: "ntn_abc" },
    });
  });

  it("injects Notion with NOTION_API_KEY fallback", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["notion"],
        credentials: { NOTION_API_KEY: "ntn_xyz" },
      }),
    );
    expect(result["notion"]?.env).toEqual({ NOTION_TOKEN: "ntn_xyz" });
  });

  it("injects PagerDuty when opted in with PAGERDUTY_API_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["pagerduty"],
        credentials: { PAGERDUTY_API_TOKEN: "pd_tok" },
      }),
    );
    expect(result["pagerduty"]).toEqual({
      type: "http",
      url: "https://mcp.pagerduty.com/mcp",
      headers: { Authorization: "Token token=pd_tok" },
    });
  });

  it("injects Monday when opted in with MONDAY_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["monday"],
        credentials: { MONDAY_TOKEN: "mon_abc" },
      }),
    );
    expect(result["monday"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
      env: { MONDAY_TOKEN: "mon_abc" },
    });
  });

  it("injects Asana when opted in with ASANA_ACCESS_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["asana"],
        credentials: { ASANA_ACCESS_TOKEN: "asa_abc" },
      }),
    );
    expect(result["asana"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "asana-mcp@latest"],
      env: { ASANA_ACCESS_TOKEN: "asa_abc" },
    });
  });

  // ── User MCP servers win on conflict ────────────────────────────

  it("user-supplied MCP servers win on key conflict", () => {
    const customGithub = {
      type: "stdio" as const,
      command: "my-custom-github-mcp",
      args: [],
    };
    const result = buildAutoMcpServers(
      cfg({
        sourceControlProvider: "github",
        credentials: { GITHUB_TOKEN: "ghp_abc" },
        userMcpServers: { github: customGithub },
      }),
    );
    expect(result["github"]).toEqual(customGithub);
  });

  it("user-supplied servers are included alongside auto-injected ones", () => {
    const myServer = { type: "http" as const, url: "https://my-mcp.example.com" };
    const result = buildAutoMcpServers(
      cfg({
        sourceControlProvider: "github",
        credentials: { GITHUB_TOKEN: "ghp_abc" },
        userMcpServers: { "my-tool": myServer },
      }),
    );
    expect(result["github"]).toBeDefined();
    expect(result["my-tool"]).toEqual(myServer);
  });

  // ── Multiple providers simultaneously ───────────────────────────

  it("injects multiple providers simultaneously", () => {
    const result = buildAutoMcpServers(
      cfg({
        sourceControlProvider: "github",
        issueTrackerProvider: "linear",
        observabilityProvider: "datadog",
        credentials: {
          GITHUB_TOKEN: "ghp_abc",
          LINEAR_API_KEY: "lin_key_abc",
          DD_API_KEY: "dd_api",
          DD_APP_KEY: "dd_app",
        },
        workspaceTools: ["slack"],
        // No SLACK_BOT_TOKEN — should not inject slack
      }),
    );
    expect(result["github"]).toBeDefined();
    expect(result["linear"]).toBeDefined();
    expect(result["datadog"]).toBeDefined();
    expect(result["slack"]).toBeUndefined();
  });
});
