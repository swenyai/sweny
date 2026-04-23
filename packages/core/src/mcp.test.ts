import { describe, it, expect } from "vitest";
import { buildAutoMcpServers, buildSkillMcpServers } from "./mcp.js";
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
        observabilityProviders: ["datadog"],
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
      cfg({ observabilityProviders: ["datadog"], credentials: { DD_API_KEY: "dd_api" } }),
    );
    expect(result["datadog"]).toBeUndefined();
  });

  // ── Sentry MCP ──────────────────────────────────────────────────

  it("injects Sentry MCP (stdio) when observabilityProvider is sentry with SENTRY_AUTH_TOKEN", () => {
    const result = buildAutoMcpServers(
      cfg({ observabilityProviders: ["sentry"], credentials: { SENTRY_AUTH_TOKEN: "sntryu_abc" } }),
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
        observabilityProviders: ["sentry"],
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
        observabilityProviders: ["sentry"],
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
        observabilityProviders: ["sentry"],
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
        observabilityProviders: ["newrelic"],
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
        observabilityProviders: ["newrelic"],
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
        observabilityProviders: ["betterstack"],
        credentials: { BETTERSTACK_API_TOKEN: "bst_abc" },
      }),
    );
    expect(result["betterstack"]).toEqual({
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: "Bearer bst_abc" },
    });
  });

  it("injects multiple observability MCPs when both are configured", () => {
    const result = buildAutoMcpServers(
      cfg({
        observabilityProviders: ["sentry", "betterstack"],
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

  // Fix #15: asana was removed from the catalog. It had been absent from
  // SUPPORTED_WORKSPACE_TOOLS for some time; the asana-mcp package is
  // community-maintained with no first-party alternative. Add back with a
  // dedicated catalog entry if demand + a policy-compliant server exist.
  it("does NOT inject asana (retired)", () => {
    const result = buildAutoMcpServers(
      cfg({
        workspaceTools: ["asana"],
        credentials: { ASANA_ACCESS_TOKEN: "asa_abc" },
      }),
    );
    expect(result["asana"]).toBeUndefined();
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
        observabilityProviders: ["datadog"],
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

// ─── buildSkillMcpServers (engine-driven) ────────────────────────────

describe("buildSkillMcpServers", () => {
  it("returns empty when no skills referenced and no creds present", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(),
      credentials: {},
    });
    expect(result).toEqual({});
  });

  it("does not wire MCP for a skill not referenced by the workflow", () => {
    // Token is set, but the workflow doesn't ask for github → no MCP.
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["linear"]),
      credentials: { GITHUB_TOKEN: "ghp_abc", LINEAR_API_KEY: "lin_abc" },
    });
    expect(result["github"]).toBeUndefined();
    expect(result["linear"]).toBeDefined();
  });

  it("does not wire MCP for a referenced skill whose creds are missing", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["github", "linear"]),
      credentials: { LINEAR_API_KEY: "lin_abc" }, // no GITHUB_TOKEN
    });
    expect(result["github"]).toBeUndefined();
    expect(result["linear"]).toBeDefined();
  });

  it("wires github MCP when referenced and GITHUB_TOKEN present", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["github"]),
      credentials: { GITHUB_TOKEN: "ghp_abc" },
    });
    expect(result["github"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abc" },
    });
  });

  it("wires linear MCP when referenced and LINEAR_API_KEY present", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["linear"]),
      credentials: { LINEAR_API_KEY: "lin_abc" },
    });
    expect(result["linear"]).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer lin_abc" },
    });
  });

  it("wires sentry MCP with SENTRY_HOST for self-hosted SENTRY_URL", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["sentry"]),
      credentials: { SENTRY_AUTH_TOKEN: "sntryu_abc", SENTRY_URL: "https://sentry.mycompany.com" },
    });
    expect(result["sentry"]?.env).toMatchObject({
      SENTRY_ACCESS_TOKEN: "sntryu_abc",
      SENTRY_HOST: "sentry.mycompany.com",
    });
  });

  it("wires datadog MCP when both keys present", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["datadog"]),
      credentials: { DD_API_KEY: "dd_api", DD_APP_KEY: "dd_app" },
    });
    expect(result["datadog"]).toEqual({
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: "dd_api", DD_APPLICATION_KEY: "dd_app" },
    });
  });

  it("does not wire datadog MCP when DD_APP_KEY is missing", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["datadog"]),
      credentials: { DD_API_KEY: "dd_api" },
    });
    expect(result["datadog"]).toBeUndefined();
  });

  it("wires slack MCP without an opt-in flag — workflow reference is the opt-in", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["slack"]),
      credentials: { SLACK_BOT_TOKEN: "xoxb-abc" },
    });
    expect(result["slack"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack@latest"],
      env: { SLACK_BOT_TOKEN: "xoxb-abc" },
    });
  });

  it("wires betterstack MCP only when the workflow references betterstack", () => {
    // Token alone is not enough — must be referenced.
    const noRef = buildSkillMcpServers({
      referencedSkills: new Set(["sentry"]),
      credentials: { BETTERSTACK_API_TOKEN: "bs_abc", SENTRY_AUTH_TOKEN: "sntry_x" },
    });
    expect(noRef["betterstack"]).toBeUndefined();

    const withRef = buildSkillMcpServers({
      referencedSkills: new Set(["betterstack"]),
      credentials: { BETTERSTACK_API_TOKEN: "bs_abc" },
    });
    expect(withRef["betterstack"]).toEqual({
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: "Bearer bs_abc" },
    });
  });

  it("user-supplied MCP servers win on key conflict", () => {
    const custom = { type: "stdio" as const, command: "my-github", args: [] };
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["github"]),
      credentials: { GITHUB_TOKEN: "ghp_abc" },
      userMcpServers: { github: custom },
    });
    expect(result["github"]).toEqual(custom);
  });

  it("user-supplied servers can add MCPs alongside auto-wired ones", () => {
    const my = { type: "http" as const, url: "https://my.example.com" };
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["github"]),
      credentials: { GITHUB_TOKEN: "ghp_abc" },
      userMcpServers: { "my-tool": my },
    });
    expect(result["github"]).toBeDefined();
    expect(result["my-tool"]).toEqual(my);
  });

  it("silently skips skill IDs with no MCP catalog entry (e.g. notification)", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["notification", "supabase", "github"]),
      credentials: { GITHUB_TOKEN: "ghp_abc" },
    });
    expect(result["notification"]).toBeUndefined();
    expect(result["supabase"]).toBeUndefined();
    expect(result["github"]).toBeDefined();
  });

  it("wires multiple skills simultaneously", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["github", "linear", "datadog", "slack"]),
      credentials: {
        GITHUB_TOKEN: "ghp_abc",
        LINEAR_API_KEY: "lin_abc",
        DD_API_KEY: "dd_api",
        DD_APP_KEY: "dd_app",
        SLACK_BOT_TOKEN: "xoxb-abc",
      },
    });
    expect(result["github"]).toBeDefined();
    expect(result["linear"]).toBeDefined();
    expect(result["datadog"]).toBeDefined();
    expect(result["slack"]).toBeDefined();
  });

  // ── GitLab ─────────────────────────────────────────────────────────

  it("wires gitlab MCP when referenced and GITLAB_TOKEN present", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["gitlab"]),
      credentials: { GITLAB_TOKEN: "glpat_abc" },
    });
    expect(result["gitlab"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gitlab@latest"],
      env: { GITLAB_PERSONAL_ACCESS_TOKEN: "glpat_abc" },
    });
  });

  it("wires gitlab MCP with self-hosted GITLAB_API_URL", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["gitlab"]),
      credentials: { GITLAB_TOKEN: "glpat_abc", GITLAB_URL: "https://gitlab.example.com" },
    });
    expect(result["gitlab"]?.env).toEqual({
      GITLAB_PERSONAL_ACCESS_TOKEN: "glpat_abc",
      GITLAB_API_URL: "https://gitlab.example.com/api/v4",
    });
  });

  // ── Jira ───────────────────────────────────────────────────────────

  it("wires jira MCP when all 3 creds present", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["jira"]),
      credentials: {
        JIRA_URL: "https://acme.atlassian.net",
        JIRA_EMAIL: "alice@acme.com",
        JIRA_API_TOKEN: "tok_abc",
      },
    });
    expect(result["jira"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@sooperset/mcp-atlassian@latest"],
      env: {
        JIRA_URL: "https://acme.atlassian.net",
        JIRA_EMAIL: "alice@acme.com",
        JIRA_API_TOKEN: "tok_abc",
      },
    });
  });

  it("does NOT wire jira MCP when JIRA_EMAIL is missing", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["jira"]),
      credentials: { JIRA_URL: "https://acme.atlassian.net", JIRA_API_TOKEN: "tok_abc" },
    });
    expect(result["jira"]).toBeUndefined();
  });

  // ── New Relic ──────────────────────────────────────────────────────

  it("wires newrelic MCP with US (default) endpoint", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["newrelic"]),
      credentials: { NEW_RELIC_API_KEY: "NRAK-abc" },
    });
    expect(result["newrelic"]).toEqual({
      type: "http",
      url: "https://mcp.newrelic.com/mcp/",
      headers: { "Api-Key": "NRAK-abc" },
    });
  });

  it("wires newrelic MCP with EU endpoint when NEW_RELIC_REGION=eu", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["newrelic"]),
      credentials: { NEW_RELIC_API_KEY: "NRAK-abc", NEW_RELIC_REGION: "eu" },
    });
    expect(result["newrelic"]?.url).toBe("https://mcp.eu.newrelic.com/mcp/");
  });

  it("does NOT wire newrelic MCP without NEW_RELIC_API_KEY", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["newrelic"]),
      credentials: { NEW_RELIC_REGION: "eu" },
    });
    expect(result["newrelic"]).toBeUndefined();
  });

  // ── Notion (both env-var spellings) ────────────────────────────────

  it("wires notion MCP with NOTION_TOKEN", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["notion"]),
      credentials: { NOTION_TOKEN: "secret_abc" },
    });
    expect(result["notion"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server@latest"],
      env: { NOTION_TOKEN: "secret_abc" },
    });
  });

  it("wires notion MCP with NOTION_API_KEY fallback", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["notion"]),
      credentials: { NOTION_API_KEY: "secret_xyz" },
    });
    expect(result["notion"]?.env?.NOTION_TOKEN).toBe("secret_xyz");
  });

  it("prefers NOTION_TOKEN over NOTION_API_KEY when both set", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["notion"]),
      credentials: { NOTION_TOKEN: "primary", NOTION_API_KEY: "fallback" },
    });
    expect(result["notion"]?.env?.NOTION_TOKEN).toBe("primary");
  });

  // ── PagerDuty / Monday / Asana ─────────────────────────────────────

  it("wires pagerduty MCP with Token-token auth scheme", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["pagerduty"]),
      credentials: { PAGERDUTY_API_TOKEN: "pd_abc" },
    });
    expect(result["pagerduty"]).toEqual({
      type: "http",
      url: "https://mcp.pagerduty.com/mcp",
      headers: { Authorization: "Token token=pd_abc" },
    });
  });

  it("wires monday MCP", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["monday"]),
      credentials: { MONDAY_TOKEN: "mon_abc" },
    });
    expect(result["monday"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
      env: { MONDAY_TOKEN: "mon_abc" },
    });
  });

  it("does NOT wire asana (retired — see Fix #15 notes)", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["asana"]),
      credentials: { ASANA_ACCESS_TOKEN: "asana_abc" },
    });
    expect(result["asana"]).toBeUndefined();
  });

  // ── BetterStack token fallback ─────────────────────────────────────

  it("wires betterstack with BETTERSTACK_TELEMETRY_TOKEN fallback", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["betterstack"]),
      credentials: { BETTERSTACK_TELEMETRY_TOKEN: "bs_tel_abc" },
    });
    expect(result["betterstack"]).toEqual({
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: "Bearer bs_tel_abc" },
    });
  });

  it("wires betterstack with BETTERSTACK_UPTIME_TOKEN fallback", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["betterstack"]),
      credentials: { BETTERSTACK_UPTIME_TOKEN: "bs_up_abc" },
    });
    expect(result["betterstack"]?.headers?.Authorization).toBe("Bearer bs_up_abc");
  });

  it("prefers BETTERSTACK_API_TOKEN over telemetry/uptime fallbacks", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["betterstack"]),
      credentials: {
        BETTERSTACK_API_TOKEN: "primary",
        BETTERSTACK_TELEMETRY_TOKEN: "fallback1",
        BETTERSTACK_UPTIME_TOKEN: "fallback2",
      },
    });
    expect(result["betterstack"]?.headers?.Authorization).toBe("Bearer primary");
  });

  // ── Skill-declared MCP servers ──────────────────────────────────────

  it("includes skill-declared MCP servers", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["our-crm"]),
      credentials: {},
      skillMcpServers: {
        "our-crm": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@company/crm-server"],
          env: { API_KEY: "test-key" },
        },
      },
    });
    expect(result["our-crm"]).toBeDefined();
    expect(result["our-crm"].command).toBe("npx");
  });

  it("skill-declared MCP is only included when skill is referenced", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["github"]),
      credentials: { GITHUB_TOKEN: "ghp_test" },
      skillMcpServers: {
        "our-crm": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@company/crm-server"],
        },
      },
    });
    expect(result["github"]).toBeDefined();
    expect(result["our-crm"]).toBeUndefined();
  });

  it("user-supplied servers win over skill-declared", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["our-crm"]),
      credentials: {},
      skillMcpServers: {
        "our-crm": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@company/crm-server"],
        },
      },
      userMcpServers: {
        "our-crm": {
          type: "http",
          url: "https://override.example.com",
        },
      },
    });
    expect(result["our-crm"].url).toBe("https://override.example.com");
  });

  it("skill-declared and auto-wired MCPs coexist", () => {
    const result = buildSkillMcpServers({
      referencedSkills: new Set(["github", "our-crm"]),
      credentials: { GITHUB_TOKEN: "ghp_test" },
      skillMcpServers: {
        "our-crm": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@company/crm-server"],
        },
      },
    });
    expect(result["github"]).toBeDefined();
    expect(result["our-crm"]).toBeDefined();
  });
});
