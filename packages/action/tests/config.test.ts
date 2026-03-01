import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetInput, mockGetBooleanInput } = vi.hoisted(() => ({
  mockGetInput: vi.fn(),
  mockGetBooleanInput: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
}));

import { parseInputs, validateInputs, ActionConfig } from "../src/config.js";

describe("parseInputs", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockGetInput.mockReset();
    mockGetBooleanInput.mockReset();
    process.env = { ...originalEnv };
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY_OWNER;
  });

  it("returns all defaults when inputs are empty strings", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("datadog");
    expect(config.observabilityCredentials.site).toBe("datadoghq.com");
    expect(config.issueTrackerProvider).toBe("github-issues"); // default changed from linear
    expect(config.timeRange).toBe("24h");
    expect(config.severityFocus).toBe("errors");
    expect(config.serviceFilter).toBe("*");
    expect(config.investigationDepth).toBe("standard");
    expect(config.maxInvestigateTurns).toBe(50);
    expect(config.maxImplementTurns).toBe(30);
    expect(config.serviceMapPath).toBe(".github/service-map.yml");
  });

  it("passes through non-default values when provided", () => {
    const inputMap: Record<string, string> = {
      "observability-provider": "grafana",
      "dd-site": "datadoghq.eu",
      "issue-tracker-provider": "jira",
      "time-range": "1h",
      "severity-focus": "warnings",
      "service-filter": "api-*",
      "investigation-depth": "deep",
      "max-investigate-turns": "100",
      "max-implement-turns": "60",
      "service-map-path": "custom/map.yml",
      "anthropic-api-key": "sk-ant-test",
      "linear-api-key": "lin_test",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("grafana");
    expect(config.observabilityCredentials).toEqual({}); // "grafana" is unknown, returns empty
    expect(config.issueTrackerProvider).toBe("jira");
    expect(config.timeRange).toBe("1h");
    expect(config.severityFocus).toBe("warnings");
    expect(config.serviceFilter).toBe("api-*");
    expect(config.investigationDepth).toBe("deep");
    expect(config.maxInvestigateTurns).toBe(100);
    expect(config.maxImplementTurns).toBe(60);
    expect(config.serviceMapPath).toBe("custom/map.yml");
    expect(config.anthropicApiKey).toBe("sk-ant-test");
    expect(config.linearApiKey).toBe("lin_test");
  });

  it("parses maxInvestigateTurns and maxImplementTurns as integers", () => {
    const inputMap: Record<string, string> = {
      "max-investigate-turns": "75",
      "max-implement-turns": "42",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.maxInvestigateTurns).toBe(75);
    expect(typeof config.maxInvestigateTurns).toBe("number");
    expect(config.maxImplementTurns).toBe(42);
    expect(typeof config.maxImplementTurns).toBe("number");
  });

  it("reads GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER from process.env", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);
    process.env.GITHUB_REPOSITORY = "swenyai/sweny";
    process.env.GITHUB_REPOSITORY_OWNER = "swenyai";

    const config = parseInputs();

    expect(config.repository).toBe("swenyai/sweny");
    expect(config.repositoryOwner).toBe("swenyai");
  });

  it("defaults repository and repositoryOwner to empty string when env vars are unset", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.repository).toBe("");
    expect(config.repositoryOwner).toBe("");
  });

  it("reads boolean inputs from getBooleanInput", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockImplementation((name: string) => {
      if (name === "dry-run") return true;
      if (name === "novelty-mode") return true;
      return false;
    });

    const config = parseInputs();

    expect(config.dryRun).toBe(true);
    expect(config.noveltyMode).toBe(true);
    expect(mockGetBooleanInput).toHaveBeenCalledWith("dry-run");
    expect(mockGetBooleanInput).toHaveBeenCalledWith("novelty-mode");
  });

  it("sourceControlProvider defaults to github", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.sourceControlProvider).toBe("github");
  });

  it("parses splunk credentials correctly", () => {
    const inputMap: Record<string, string> = {
      "observability-provider": "splunk",
      "splunk-url": "https://splunk.example.com:8089",
      "splunk-token": "splunk-tok",
      "splunk-index": "my-index",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("splunk");
    expect(config.observabilityCredentials.baseUrl).toBe("https://splunk.example.com:8089");
    expect(config.observabilityCredentials.token).toBe("splunk-tok");
    expect(config.observabilityCredentials.index).toBe("my-index");
  });

  it("parses elastic credentials correctly", () => {
    const inputMap: Record<string, string> = {
      "observability-provider": "elastic",
      "elastic-url": "https://elastic.example.com:9200",
      "elastic-api-key": "elastic-key",
      "elastic-index": "app-logs-*",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("elastic");
    expect(config.observabilityCredentials.baseUrl).toBe("https://elastic.example.com:9200");
    expect(config.observabilityCredentials.apiKey).toBe("elastic-key");
    expect(config.observabilityCredentials.index).toBe("app-logs-*");
  });

  it("parses newrelic credentials correctly", () => {
    const inputMap: Record<string, string> = {
      "observability-provider": "newrelic",
      "newrelic-api-key": "NRAK-test",
      "newrelic-account-id": "12345",
      "newrelic-region": "eu",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("newrelic");
    expect(config.observabilityCredentials.apiKey).toBe("NRAK-test");
    expect(config.observabilityCredentials.accountId).toBe("12345");
    expect(config.observabilityCredentials.region).toBe("eu");
  });

  it("parses loki credentials correctly", () => {
    const inputMap: Record<string, string> = {
      "observability-provider": "loki",
      "loki-url": "https://loki.example.com",
      "loki-api-key": "loki-key",
      "loki-org-id": "tenant-1",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("loki");
    expect(config.observabilityCredentials.baseUrl).toBe("https://loki.example.com");
    expect(config.observabilityCredentials.apiKey).toBe("loki-key");
    expect(config.observabilityCredentials.orgId).toBe("tenant-1");
  });

  it("parses jira fields from inputs", () => {
    const inputMap: Record<string, string> = {
      "jira-base-url": "https://myco.atlassian.net",
      "jira-email": "bot@myco.com",
      "jira-api-token": "jira-tok",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.jiraBaseUrl).toBe("https://myco.atlassian.net");
    expect(config.jiraEmail).toBe("bot@myco.com");
    expect(config.jiraApiToken).toBe("jira-tok");
  });

  it("parses gitlab fields from inputs", () => {
    const inputMap: Record<string, string> = {
      "source-control-provider": "gitlab",
      "gitlab-token": "glpat-test",
      "gitlab-project-id": "my-group/my-project",
      "gitlab-base-url": "https://gitlab.example.com",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.sourceControlProvider).toBe("gitlab");
    expect(config.gitlabToken).toBe("glpat-test");
    expect(config.gitlabProjectId).toBe("my-group/my-project");
    expect(config.gitlabBaseUrl).toBe("https://gitlab.example.com");
  });

  it("gitlabBaseUrl defaults to https://gitlab.com", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.gitlabBaseUrl).toBe("https://gitlab.com");
  });

  it("baseBranch defaults to main", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.baseBranch).toBe("main");
  });

  it("prLabels defaults to agent,triage,needs-review", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.prLabels).toEqual(["agent", "triage", "needs-review"]);
  });

  it("parses custom prLabels from comma-separated input", () => {
    const inputMap: Record<string, string> = {
      "pr-labels": "custom, label-2",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.prLabels).toEqual(["custom", "label-2"]);
  });

  it("notificationProvider defaults to github-summary", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.notificationProvider).toBe("github-summary");
  });

  it("parses notification fields from inputs", () => {
    const inputMap: Record<string, string> = {
      "notification-provider": "email",
      "sendgrid-api-key": "SG.test",
      "email-from": "bot@example.com",
      "email-to": "team@example.com",
      "notification-webhook-url": "",
      "webhook-signing-secret": "",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.notificationProvider).toBe("email");
    expect(config.sendgridApiKey).toBe("SG.test");
    expect(config.emailFrom).toBe("bot@example.com");
    expect(config.emailTo).toBe("team@example.com");
  });
});

describe("validateInputs", () => {
  function baseConfig(overrides?: Partial<ActionConfig>): ActionConfig {
    return {
      anthropicApiKey: "sk-ant-test",
      claudeOauthToken: "",
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd-key", appKey: "dd-app" },
      issueTrackerProvider: "github-issues",
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
      prLabels: ["agent"],
      dryRun: false,
      noveltyMode: true,
      linearIssue: "",
      additionalInstructions: "",
      serviceMapPath: ".github/service-map.yml",
      githubToken: "ghs_test",
      botToken: "",
      sourceControlProvider: "github",
      jiraBaseUrl: "",
      jiraEmail: "",
      jiraApiToken: "",
      gitlabToken: "",
      gitlabProjectId: "",
      gitlabBaseUrl: "https://gitlab.com",
      notificationProvider: "github-summary",
      notificationWebhookUrl: "",
      sendgridApiKey: "",
      emailFrom: "",
      emailTo: "",
      webhookSigningSecret: "",
      repository: "org/repo",
      repositoryOwner: "org",
      ...overrides,
    };
  }

  it("returns no errors for valid config", () => {
    expect(validateInputs(baseConfig())).toEqual([]);
  });

  it("requires auth: either anthropic-api-key or claude-oauth-token", () => {
    const errors = validateInputs(baseConfig({ anthropicApiKey: "", claudeOauthToken: "" }));
    expect(errors).toContainEqual(expect.stringContaining("anthropic-api-key"));
  });

  it("accepts claude-oauth-token as auth", () => {
    const errors = validateInputs(baseConfig({ anthropicApiKey: "", claudeOauthToken: "tok" }));
    expect(errors.some((e) => e.includes("anthropic-api-key") || e.includes("oauth"))).toBe(false);
  });

  it("validates datadog requires dd-api-key and dd-app-key", () => {
    const errors = validateInputs(baseConfig({ observabilityProvider: "datadog", observabilityCredentials: {} }));
    expect(errors).toContainEqual(expect.stringContaining("dd-api-key"));
    expect(errors).toContainEqual(expect.stringContaining("dd-app-key"));
  });

  it("validates sentry requires auth-token, org, project", () => {
    const errors = validateInputs(baseConfig({ observabilityProvider: "sentry", observabilityCredentials: {} }));
    expect(errors).toContainEqual(expect.stringContaining("sentry-auth-token"));
    expect(errors).toContainEqual(expect.stringContaining("sentry-org"));
    expect(errors).toContainEqual(expect.stringContaining("sentry-project"));
  });

  it("validates linear requires api-key and team-id", () => {
    const errors = validateInputs(baseConfig({ issueTrackerProvider: "linear" }));
    expect(errors).toContainEqual(expect.stringContaining("linear-api-key"));
    expect(errors).toContainEqual(expect.stringContaining("linear-team-id"));
  });

  it("validates jira requires base-url, email, api-token", () => {
    const errors = validateInputs(baseConfig({ issueTrackerProvider: "jira" }));
    expect(errors).toContainEqual(expect.stringContaining("jira-base-url"));
    expect(errors).toContainEqual(expect.stringContaining("jira-email"));
    expect(errors).toContainEqual(expect.stringContaining("jira-api-token"));
  });

  it("validates gitlab requires token and project-id", () => {
    const errors = validateInputs(baseConfig({ sourceControlProvider: "gitlab" }));
    expect(errors).toContainEqual(expect.stringContaining("gitlab-token"));
    expect(errors).toContainEqual(expect.stringContaining("gitlab-project-id"));
  });

  it("validates slack notification requires webhook-url", () => {
    const errors = validateInputs(baseConfig({ notificationProvider: "slack" }));
    expect(errors).toContainEqual(expect.stringContaining("notification-webhook-url"));
  });

  it("validates email notification requires sendgrid-api-key, from, to", () => {
    const errors = validateInputs(baseConfig({ notificationProvider: "email" }));
    expect(errors).toContainEqual(expect.stringContaining("sendgrid-api-key"));
    expect(errors).toContainEqual(expect.stringContaining("email-from"));
    expect(errors).toContainEqual(expect.stringContaining("email-to"));
  });

  it("validates max-investigate-turns bounds", () => {
    const errors = validateInputs(baseConfig({ maxInvestigateTurns: 0 }));
    expect(errors).toContainEqual(expect.stringContaining("max-investigate-turns"));
  });

  it("validates max-implement-turns bounds", () => {
    const errors = validateInputs(baseConfig({ maxImplementTurns: 501 }));
    expect(errors).toContainEqual(expect.stringContaining("max-implement-turns"));
  });

  it("github-issues issue tracker needs no extra credentials", () => {
    const errors = validateInputs(baseConfig({ issueTrackerProvider: "github-issues" }));
    expect(errors.some((e) => e.includes("issue-tracker"))).toBe(false);
  });
});
