import { describe, it, expect, vi, beforeAll } from "vitest";
import type { ActionConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that trigger module-level run()
// ---------------------------------------------------------------------------

vi.mock("@actions/core", () => ({
  getInput: vi.fn().mockReturnValue(""),
  getBooleanInput: vi.fn().mockReturnValue(false),
  setFailed: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  setOutput: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}));

vi.mock("@sweny-ai/engine", () => ({
  runWorkflow: vi.fn().mockResolvedValue({ steps: [] }),
  triageWorkflow: {},
}));

vi.mock("../src/config.js", () => ({
  parseInputs: vi.fn().mockReturnValue({
    anthropicApiKey: "test-key",
    claudeOauthToken: "",
    observabilityProvider: "datadog",
    observabilityCredentials: { apiKey: "k", appKey: "a", site: "datadoghq.com" },
    issueTrackerProvider: "github-issues",
    sourceControlProvider: "github",
    codingAgentProvider: "claude",
    notificationProvider: "github-summary",
    repository: "org/repo",
    repositoryOwner: "org",
    linearApiKey: "",
    linearTeamId: "",
    linearBugLabelId: "",
    linearTriageLabelId: "",
    linearStateBacklog: "",
    linearStateInProgress: "",
    linearStatePeerReview: "",
    timeRange: "24h",
    severityFocus: "errors",
    serviceFilter: "*",
    investigationDepth: "standard",
    maxInvestigateTurns: 50,
    maxImplementTurns: 30,
    baseBranch: "main",
    prLabels: [],
    dryRun: false,
    reviewMode: "review",
    noveltyMode: false,
    linearIssue: "",
    additionalInstructions: "",
    serviceMapPath: ".github/service-map.yml",
    githubToken: "gh_test",
    botToken: "",
    jiraBaseUrl: "",
    jiraEmail: "",
    jiraApiToken: "",
    gitlabToken: "",
    gitlabProjectId: "",
    gitlabBaseUrl: "https://gitlab.com",
    notificationWebhookUrl: "",
    sendgridApiKey: "",
    emailFrom: "",
    emailTo: "",
    webhookSigningSecret: "",
    openaiApiKey: "",
    geminiApiKey: "",
    logFilePath: "",
    mcpServers: {},
    workspaceTools: [],
  }),
  validateInputs: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/providers/index.js", () => ({
  createProviders: vi.fn().mockReturnValue(new Map()),
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { mapToTriageConfig, mapToImplementConfig } from "../src/main.js";

// ---------------------------------------------------------------------------
// Base ActionConfig for parameterised tests
// ---------------------------------------------------------------------------

const BASE: ActionConfig = {
  anthropicApiKey: "sk-ant-test",
  claudeOauthToken: "",
  observabilityProvider: "datadog",
  observabilityCredentials: {},
  issueTrackerProvider: "github-issues",
  sourceControlProvider: "github",
  codingAgentProvider: "claude",
  notificationProvider: "github-summary",
  repository: "org/repo",
  repositoryOwner: "org",
  linearApiKey: "",
  linearTeamId: "",
  linearBugLabelId: "",
  linearTriageLabelId: "",
  linearStateBacklog: "",
  linearStateInProgress: "",
  linearStatePeerReview: "",
  timeRange: "24h",
  severityFocus: "errors",
  serviceFilter: "*",
  investigationDepth: "standard",
  maxInvestigateTurns: 50,
  maxImplementTurns: 30,
  baseBranch: "main",
  prLabels: [],
  dryRun: false,
  reviewMode: "review",
  noveltyMode: false,
  linearIssue: "",
  additionalInstructions: "",
  serviceMapPath: ".github/service-map.yml",
  githubToken: "gh_test",
  botToken: "",
  jiraBaseUrl: "",
  jiraEmail: "",
  jiraApiToken: "",
  gitlabToken: "",
  gitlabProjectId: "",
  gitlabBaseUrl: "https://gitlab.com",
  notificationWebhookUrl: "",
  sendgridApiKey: "",
  emailFrom: "",
  emailTo: "",
  webhookSigningSecret: "",
  openaiApiKey: "",
  geminiApiKey: "",
  logFilePath: "",
  mcpServers: {},
  workspaceTools: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mapToTriageConfig — reviewMode", () => {
  it("passes reviewMode 'auto' through to triageConfig", () => {
    const config: ActionConfig = { ...BASE, reviewMode: "auto" };
    const triageConfig = mapToTriageConfig(config);
    expect(triageConfig.reviewMode).toBe("auto");
  });

  it("defaults reviewMode to 'review' when not explicitly set", () => {
    const config: ActionConfig = { ...BASE, reviewMode: "review" };
    const triageConfig = mapToTriageConfig(config);
    expect(triageConfig.reviewMode).toBe("review");
  });
});

describe("mapToTriageConfig — observability agentEnv", () => {
  it("maps Sentry credentials to SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "sentry",
      observabilityCredentials: {
        authToken: "sntryu_secret",
        organization: "acme-org",
        project: "api-prod",
      },
    };
    const { agentEnv } = mapToTriageConfig(config) as { agentEnv: Record<string, string> };
    expect(agentEnv.SENTRY_AUTH_TOKEN).toBe("sntryu_secret");
    expect(agentEnv.SENTRY_ORG).toBe("acme-org");
    expect(agentEnv.SENTRY_PROJECT).toBe("api-prod");
  });

  it("maps CloudWatch credentials to AWS_REGION and CLOUDWATCH_LOG_GROUP_PREFIX", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "cloudwatch",
      observabilityCredentials: {
        region: "eu-west-1",
        logGroupPrefix: "/ecs/api",
      },
    };
    const { agentEnv } = mapToTriageConfig(config) as { agentEnv: Record<string, string> };
    expect(agentEnv.AWS_REGION).toBe("eu-west-1");
    expect(agentEnv.CLOUDWATCH_LOG_GROUP_PREFIX).toBe("/ecs/api");
  });

  it("maps Loki credentials including LOKI_ORG_ID", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "loki",
      observabilityCredentials: {
        baseUrl: "https://loki.acme.com",
        apiKey: "loki-key",
        orgId: "tenant-1",
      },
    };
    const { agentEnv } = mapToTriageConfig(config) as { agentEnv: Record<string, string> };
    expect(agentEnv.LOKI_URL).toBe("https://loki.acme.com");
    expect(agentEnv.LOKI_API_KEY).toBe("loki-key");
    expect(agentEnv.LOKI_ORG_ID).toBe("tenant-1");
  });
});

describe("mapToTriageConfig — buildAutoMcpServers", () => {
  // ── Category A: provider-config triggered ──────────────────────────────────

  it("injects GitHub MCP server when source control is github", () => {
    const config: ActionConfig = { ...BASE, sourceControlProvider: "github", githubToken: "ghp_abc" };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["github"]).toMatchObject({
      type: "stdio",
      command: "npx",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abc" },
    });
  });

  it("injects GitHub MCP server when issue tracker is github-issues (botToken fallback)", () => {
    const config: ActionConfig = {
      ...BASE,
      sourceControlProvider: "file",
      issueTrackerProvider: "github-issues",
      githubToken: "",
      botToken: "ghp_bot",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["github"]).toMatchObject({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_bot" } });
  });

  it("does not inject GitHub MCP server when no token is present", () => {
    const config: ActionConfig = { ...BASE, githubToken: "", botToken: "" };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> | undefined };
    expect(mcpServers?.["github"]).toBeUndefined();
  });

  it("injects Linear MCP server when issue tracker is linear", () => {
    const config: ActionConfig = {
      ...BASE,
      issueTrackerProvider: "linear",
      linearApiKey: "lin_api_key",
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["linear"]).toMatchObject({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer lin_api_key" },
    });
  });

  it("does not inject Linear MCP server when linearApiKey is absent", () => {
    const config: ActionConfig = { ...BASE, issueTrackerProvider: "linear", linearApiKey: "", githubToken: "" };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> | undefined };
    expect(mcpServers?.["linear"]).toBeUndefined();
  });

  it("injects Jira MCP server when issue tracker is jira with full credentials", () => {
    const config: ActionConfig = {
      ...BASE,
      issueTrackerProvider: "jira",
      jiraBaseUrl: "https://myco.atlassian.net",
      jiraEmail: "bot@myco.com",
      jiraApiToken: "jira-tok",
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["jira"]).toMatchObject({
      type: "stdio",
      command: "npx",
      env: {
        JIRA_URL: "https://myco.atlassian.net",
        JIRA_EMAIL: "bot@myco.com",
        JIRA_API_TOKEN: "jira-tok",
      },
    });
  });

  it("does not inject Jira MCP server when jiraApiToken is absent", () => {
    const config: ActionConfig = {
      ...BASE,
      issueTrackerProvider: "jira",
      jiraBaseUrl: "https://myco.atlassian.net",
      jiraEmail: "bot@myco.com",
      jiraApiToken: "",
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> | undefined };
    expect(mcpServers?.["jira"]).toBeUndefined();
  });

  it("does not inject Jira MCP server when issue tracker is not jira", () => {
    const config: ActionConfig = {
      ...BASE,
      issueTrackerProvider: "linear",
      linearApiKey: "",
      jiraBaseUrl: "https://myco.atlassian.net",
      jiraEmail: "bot@myco.com",
      jiraApiToken: "jira-tok",
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> | undefined };
    expect(mcpServers?.["jira"]).toBeUndefined();
  });

  it("user-supplied mcpServers override auto-injected ones on key conflict", () => {
    const config: ActionConfig = {
      ...BASE,
      sourceControlProvider: "github",
      githubToken: "ghp_auto",
      mcpServers: { github: { type: "http", url: "https://my-github-proxy.example.com/mcp" } },
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["github"]).toMatchObject({ url: "https://my-github-proxy.example.com/mcp" });
    expect((mcpServers?.["github"] as Record<string, unknown>)["env"]).toBeUndefined();
  });

  it("injects Datadog MCP server when observability provider is datadog with both keys", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd_api", appKey: "dd_app" },
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["datadog"]).toMatchObject({
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: "dd_api", DD_APPLICATION_KEY: "dd_app" },
    });
  });

  it("does not inject Datadog MCP server when either key is absent", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd_api" }, // no appKey
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: unknown };
    expect((mcpServers as Record<string, unknown> | undefined)?.["datadog"]).toBeUndefined();
  });

  it("injects GitLab MCP server when source control is gitlab", () => {
    const config: ActionConfig = {
      ...BASE,
      sourceControlProvider: "gitlab",
      gitlabToken: "glpat_abc",
      gitlabBaseUrl: "https://gitlab.com",
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["gitlab"]).toMatchObject({
      type: "stdio",
      command: "npx",
      env: { GITLAB_PERSONAL_ACCESS_TOKEN: "glpat_abc" },
    });
  });

  it("includes GITLAB_API_URL for self-hosted GitLab", () => {
    const config: ActionConfig = {
      ...BASE,
      sourceControlProvider: "gitlab",
      gitlabToken: "glpat_abc",
      gitlabBaseUrl: "https://gitlab.internal.example.com",
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect((mcpServers?.["gitlab"] as Record<string, unknown>)?.["env"]).toMatchObject({
      GITLAB_API_URL: "https://gitlab.internal.example.com/api/v4",
    });
  });

  it("does not inject GitLab MCP server when gitlabToken is absent", () => {
    const config: ActionConfig = { ...BASE, sourceControlProvider: "gitlab", gitlabToken: "", githubToken: "" };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> | undefined };
    expect(mcpServers?.["gitlab"]).toBeUndefined();
  });

  it("injects Sentry MCP server when observability provider is sentry with auth token", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "sentry",
      observabilityCredentials: { authToken: "sntryu_secret", organization: "acme", project: "api" },
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["sentry"]).toMatchObject({
      type: "stdio",
      command: "npx",
      // @sentry/mcp-server uses SENTRY_ACCESS_TOKEN (not SENTRY_AUTH_TOKEN)
      env: { SENTRY_ACCESS_TOKEN: "sntryu_secret" },
    });
  });

  it("sets SENTRY_HOST for self-hosted Sentry", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "sentry",
      observabilityCredentials: {
        authToken: "sntryu_secret",
        baseUrl: "https://sentry.internal.example.com",
      },
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect((mcpServers?.["sentry"] as Record<string, unknown>)?.["env"]).toMatchObject({
      SENTRY_HOST: "sentry.internal.example.com",
    });
  });

  it("injects New Relic MCP server when observability provider is newrelic", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "newrelic",
      observabilityCredentials: { apiKey: "NRAK-test", accountId: "123456", region: "us" },
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["newrelic"]).toMatchObject({
      type: "http",
      url: "https://mcp.newrelic.com/mcp/",
      headers: { "Api-Key": "NRAK-test" },
    });
  });

  it("uses EU endpoint for New Relic when region is eu", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "newrelic",
      observabilityCredentials: { apiKey: "NRAK-test", accountId: "123456", region: "eu" },
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect((mcpServers?.["newrelic"] as Record<string, unknown>)?.["url"]).toBe("https://mcp.eu.newrelic.com/mcp/");
  });

  it("does not inject Sentry MCP when authToken is absent", () => {
    const config: ActionConfig = {
      ...BASE,
      observabilityProvider: "sentry",
      observabilityCredentials: { organization: "acme", project: "api" },
      githubToken: "",
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> | undefined };
    expect(mcpServers?.["sentry"]).toBeUndefined();
  });

  // ── Category B: env-var triggered ──────────────────────────────────────────

  it("injects Slack MCP server when workspace-tools includes 'slack' and SLACK_BOT_TOKEN is set", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    try {
      const { mcpServers } = mapToTriageConfig({ ...BASE, githubToken: "", workspaceTools: ["slack"] }) as {
        mcpServers: Record<string, unknown>;
      };
      expect(mcpServers?.["slack"]).toMatchObject({
        type: "stdio",
        command: "npx",
        env: { SLACK_BOT_TOKEN: "xoxb-test-token" },
      });
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
    }
  });

  it("includes SLACK_TEAM_ID in Slack MCP env when set", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    process.env.SLACK_TEAM_ID = "T012AB3CD";
    try {
      const { mcpServers } = mapToTriageConfig({ ...BASE, githubToken: "", workspaceTools: ["slack"] }) as {
        mcpServers: Record<string, unknown>;
      };
      expect((mcpServers?.["slack"] as Record<string, unknown>)?.["env"]).toMatchObject({
        SLACK_TEAM_ID: "T012AB3CD",
      });
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_TEAM_ID;
    }
  });

  it("does not inject Slack MCP when tool is declared but token is absent", () => {
    delete process.env.SLACK_BOT_TOKEN;
    const { mcpServers } = mapToTriageConfig({
      ...BASE,
      githubToken: "",
      botToken: "",
      mcpServers: {},
      workspaceTools: ["slack"],
    }) as {
      mcpServers: Record<string, unknown> | undefined;
    };
    expect(mcpServers?.["slack"]).toBeUndefined();
  });

  it("does not inject Slack MCP when token is present but tool is not declared", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    try {
      // workspaceTools is empty — no slack declared
      const { mcpServers } = mapToTriageConfig({
        ...BASE,
        githubToken: "",
        botToken: "",
        mcpServers: {},
        workspaceTools: [],
      }) as {
        mcpServers: Record<string, unknown> | undefined;
      };
      expect(mcpServers?.["slack"]).toBeUndefined();
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
    }
  });

  it("injects Notion MCP server when NOTION_TOKEN is present in env", () => {
    process.env.NOTION_TOKEN = "secret_notion_key";
    try {
      const { mcpServers } = mapToTriageConfig({ ...BASE, githubToken: "", workspaceTools: ["notion"] }) as {
        mcpServers: Record<string, unknown>;
      };
      expect(mcpServers?.["notion"]).toMatchObject({
        type: "stdio",
        command: "npx",
        // @notionhq/notion-mcp-server reads NOTION_TOKEN (not NOTION_API_KEY)
        env: { NOTION_TOKEN: "secret_notion_key" },
      });
    } finally {
      delete process.env.NOTION_TOKEN;
    }
  });

  it("injects Notion MCP server from legacy NOTION_API_KEY env var", () => {
    delete process.env.NOTION_TOKEN;
    process.env.NOTION_API_KEY = "legacy_notion_key";
    try {
      const { mcpServers } = mapToTriageConfig({ ...BASE, githubToken: "", workspaceTools: ["notion"] }) as {
        mcpServers: Record<string, unknown>;
      };
      expect((mcpServers?.["notion"] as Record<string, unknown>)?.["env"]).toMatchObject({
        NOTION_TOKEN: "legacy_notion_key",
      });
    } finally {
      delete process.env.NOTION_API_KEY;
    }
  });

  it("does not inject Notion MCP when tool not declared (even if token present)", () => {
    process.env.NOTION_TOKEN = "secret_notion_key";
    try {
      const { mcpServers } = mapToTriageConfig({
        ...BASE,
        githubToken: "",
        botToken: "",
        mcpServers: {},
        workspaceTools: [],
      }) as {
        mcpServers: Record<string, unknown> | undefined;
      };
      expect(mcpServers?.["notion"]).toBeUndefined();
    } finally {
      delete process.env.NOTION_TOKEN;
    }
  });

  it("does not inject Notion MCP when tool is declared but neither token is set", () => {
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_API_KEY;
    const { mcpServers } = mapToTriageConfig({
      ...BASE,
      githubToken: "",
      botToken: "",
      mcpServers: {},
      workspaceTools: ["notion"],
    }) as {
      mcpServers: Record<string, unknown> | undefined;
    };
    expect(mcpServers?.["notion"]).toBeUndefined();
  });

  it("injects PagerDuty MCP server when declared and PAGERDUTY_API_TOKEN is set", () => {
    process.env.PAGERDUTY_API_TOKEN = "pd_token_abc";
    try {
      const { mcpServers } = mapToTriageConfig({ ...BASE, githubToken: "", workspaceTools: ["pagerduty"] }) as {
        mcpServers: Record<string, unknown>;
      };
      expect(mcpServers?.["pagerduty"]).toMatchObject({
        type: "http",
        url: "https://mcp.pagerduty.com/mcp",
        headers: { Authorization: "Token token=pd_token_abc" },
      });
    } finally {
      delete process.env.PAGERDUTY_API_TOKEN;
    }
  });

  it("injects Monday.com MCP server when declared and MONDAY_TOKEN is set", () => {
    process.env.MONDAY_TOKEN = "monday_key_abc";
    try {
      const { mcpServers } = mapToTriageConfig({ ...BASE, githubToken: "", workspaceTools: ["monday"] }) as {
        mcpServers: Record<string, unknown>;
      };
      expect(mcpServers?.["monday"]).toMatchObject({
        type: "stdio",
        command: "npx",
        env: { MONDAY_TOKEN: "monday_key_abc" },
      });
    } finally {
      delete process.env.MONDAY_TOKEN;
    }
  });

  it("injects Asana MCP server when declared and ASANA_ACCESS_TOKEN is set", () => {
    process.env.ASANA_ACCESS_TOKEN = "asana-pat-abc";
    try {
      const { mcpServers } = mapToTriageConfig({ ...BASE, githubToken: "", workspaceTools: ["asana"] }) as {
        mcpServers: Record<string, unknown>;
      };
      expect(mcpServers?.["asana"]).toMatchObject({
        type: "stdio",
        command: "npx",
        env: { ASANA_ACCESS_TOKEN: "asana-pat-abc" },
      });
    } finally {
      delete process.env.ASANA_ACCESS_TOKEN;
    }
  });

  it("does not inject Asana MCP when token is absent", () => {
    delete process.env.ASANA_ACCESS_TOKEN;
    const { mcpServers } = mapToTriageConfig({
      ...BASE,
      githubToken: "",
      botToken: "",
      mcpServers: {},
      workspaceTools: ["asana"],
    }) as { mcpServers: Record<string, unknown> | undefined };
    expect(mcpServers?.["asana"]).toBeUndefined();
  });

  it("does not inject Asana MCP when tool is not declared", () => {
    process.env.ASANA_ACCESS_TOKEN = "asana-pat-abc";
    try {
      const { mcpServers } = mapToTriageConfig({
        ...BASE,
        githubToken: "",
        botToken: "",
        mcpServers: {},
        workspaceTools: [],
      }) as { mcpServers: Record<string, unknown> | undefined };
      expect(mcpServers?.["asana"]).toBeUndefined();
    } finally {
      delete process.env.ASANA_ACCESS_TOKEN;
    }
  });

  it("returns undefined when no providers and no user mcpServers", () => {
    const config: ActionConfig = {
      ...BASE,
      sourceControlProvider: "file",
      issueTrackerProvider: "linear",
      observabilityProvider: "datadog",
      observabilityCredentials: {},
      linearApiKey: "",
      githubToken: "",
      botToken: "",
      mcpServers: {},
    };
    const { mcpServers } = mapToTriageConfig(config) as { mcpServers: unknown };
    expect(mcpServers).toBeUndefined();
  });
});

describe("mapToImplementConfig — MCP auto-injection", () => {
  it("injects GitHub MCP server when source control is github", () => {
    const config: ActionConfig = { ...BASE, sourceControlProvider: "github", githubToken: "ghp_impl" };
    const { mcpServers } = mapToImplementConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["github"]).toMatchObject({
      type: "stdio",
      command: "npx",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_impl" },
    });
  });

  it("injects Linear MCP server when issue tracker is linear", () => {
    const config: ActionConfig = {
      ...BASE,
      issueTrackerProvider: "linear",
      linearApiKey: "lin_impl_key",
      githubToken: "",
    };
    const { mcpServers } = mapToImplementConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["linear"]).toMatchObject({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer lin_impl_key" },
    });
  });

  it("user-supplied mcpServers override auto-injected ones in implementConfig", () => {
    const config: ActionConfig = {
      ...BASE,
      sourceControlProvider: "github",
      githubToken: "ghp_auto",
      mcpServers: { github: { type: "http", url: "https://custom-github.example.com/mcp" } },
    };
    const { mcpServers } = mapToImplementConfig(config) as { mcpServers: Record<string, unknown> };
    expect(mcpServers?.["github"]).toMatchObject({ url: "https://custom-github.example.com/mcp" });
    expect((mcpServers?.["github"] as Record<string, unknown>)["env"]).toBeUndefined();
  });
});
