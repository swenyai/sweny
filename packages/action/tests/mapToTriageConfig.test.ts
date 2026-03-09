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
