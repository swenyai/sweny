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
  }),
  validateInputs: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/providers/index.js", () => ({
  createProviders: vi.fn().mockReturnValue(new Map()),
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { mapToTriageConfig } from "../src/main.js";

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
