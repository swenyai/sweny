import { describe, it, expect } from "vitest";
import { createProviders } from "../src/providers/index.js";
import type { ActionConfig } from "../src/config.js";
import type { ObservabilityProvider } from "@sweny-ai/providers/observability";
import type { IssueTrackingProvider } from "@sweny-ai/providers/issue-tracking";
import type { SourceControlProvider } from "@sweny-ai/providers/source-control";
import type { NotificationProvider } from "@sweny-ai/providers/notification";
import type { CodingAgent } from "@sweny-ai/providers/coding-agent";

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    anthropicApiKey: "",
    claudeOauthToken: "",
    codingAgentProvider: "claude",
    openaiApiKey: "",
    geminiApiKey: "",
    observabilityProvider: "datadog",
    logFilePath: "",
    observabilityCredentials: {
      apiKey: "test-api-key",
      appKey: "test-app-key",
      site: "datadoghq.com",
    },
    issueTrackerProvider: "linear",
    linearApiKey: "lin_test",
    linearTeamId: "team-1",
    linearBugLabelId: "label-1",
    linearTriageLabelId: "label-2",
    linearStateBacklog: "state-1",
    linearStateInProgress: "state-2",
    linearStatePeerReview: "state-3",
    timeRange: "24h",
    severityFocus: "errors",
    serviceFilter: "*",
    investigationDepth: "standard",
    maxInvestigateTurns: 50,
    maxImplementTurns: 30,
    dryRun: false,
    noveltyMode: false,
    linearIssue: "",
    additionalInstructions: "",
    serviceMapPath: ".github/service-map.yml",
    githubToken: "ghp_test",
    botToken: "",
    sourceControlProvider: "github",
    jiraBaseUrl: "",
    jiraEmail: "",
    jiraApiToken: "",
    gitlabToken: "",
    gitlabProjectId: "",
    gitlabBaseUrl: "https://gitlab.com",
    baseBranch: "main",
    prLabels: ["agent", "triage", "needs-review"],
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

describe("createProviders", () => {
  it("creates providers with datadog + linear + github", () => {
    const registry = createProviders(makeConfig());
    const observability = registry.get<ObservabilityProvider>("observability");
    expect(observability).toBeDefined();
    expect(typeof observability.verifyAccess).toBe("function");
    expect(typeof observability.queryLogs).toBe("function");
    expect(typeof observability.aggregate).toBe("function");
    // Source control
    const sourceControl = registry.get<SourceControlProvider>("sourceControl");
    expect(sourceControl).toBeDefined();
    expect(typeof sourceControl.verifyAccess).toBe("function");
    expect(typeof sourceControl.createBranch).toBe("function");
    expect(typeof sourceControl.createPullRequest).toBe("function");
    expect(typeof sourceControl.findExistingPr).toBe("function");
    expect(typeof sourceControl.hasNewCommits).toBe("function");
    expect(typeof sourceControl.getChangedFiles).toBe("function");
    expect(typeof sourceControl.resetPaths).toBe("function");
    expect(typeof sourceControl.dispatchWorkflow).toBe("function");
    // Notification
    const notification = registry.get<NotificationProvider>("notification");
    expect(notification).toBeDefined();
    expect(typeof notification.send).toBe("function");
    // Coding agent
    const codingAgent = registry.get<CodingAgent>("codingAgent");
    expect(codingAgent).toBeDefined();
    expect(typeof codingAgent.install).toBe("function");
    expect(typeof codingAgent.run).toBe("function");
  });

  it("issue tracker has core + capability methods", () => {
    const registry = createProviders(makeConfig());
    const issueTracker = registry.get<IssueTrackingProvider>("issueTracker");
    expect(typeof issueTracker.verifyAccess).toBe("function");
    expect(typeof issueTracker.createIssue).toBe("function");
    expect(typeof issueTracker.getIssue).toBe("function");
    expect(typeof issueTracker.updateIssue).toBe("function");
    expect(typeof issueTracker.searchIssues).toBe("function");
    expect(typeof issueTracker.addComment).toBe("function");
    // Capabilities
    expect(typeof (issueTracker as any).linkPr).toBe("function");
    expect(typeof (issueTracker as any).searchIssuesByLabel).toBe("function");
  });

  it("creates providers with sentry observability", () => {
    const registry = createProviders(
      makeConfig({
        observabilityProvider: "sentry",
        observabilityCredentials: {
          authToken: "sentry-tok",
          organization: "my-org",
          project: "my-proj",
          baseUrl: "https://sentry.io",
        },
      }),
    );
    const observability = registry.get<ObservabilityProvider>("observability");
    expect(observability).toBeDefined();
    expect(typeof observability.verifyAccess).toBe("function");
    expect(typeof observability.queryLogs).toBe("function");
    expect(typeof observability.aggregate).toBe("function");
    expect(typeof observability.getAgentEnv).toBe("function");
    expect(typeof observability.getPromptInstructions).toBe("function");

    const env = observability.getAgentEnv();
    expect(env.SENTRY_AUTH_TOKEN).toBe("sentry-tok");
    expect(env.SENTRY_ORG).toBe("my-org");
  });

  it("creates providers with cloudwatch observability", () => {
    const registry = createProviders(
      makeConfig({
        observabilityProvider: "cloudwatch",
        observabilityCredentials: {
          region: "us-west-2",
          logGroupPrefix: "/ecs/my-app",
        },
      }),
    );
    const observability = registry.get<ObservabilityProvider>("observability");
    expect(observability).toBeDefined();
    expect(typeof observability.verifyAccess).toBe("function");
    expect(typeof observability.queryLogs).toBe("function");
    expect(typeof observability.aggregate).toBe("function");
    expect(typeof observability.getAgentEnv).toBe("function");
    expect(typeof observability.getPromptInstructions).toBe("function");

    const env = observability.getAgentEnv();
    expect(env.AWS_REGION).toBe("us-west-2");
    expect(env.CW_LOG_GROUP_PREFIX).toBe("/ecs/my-app");
  });

  it("creates providers with splunk observability", () => {
    const registry = createProviders(
      makeConfig({
        observabilityProvider: "splunk",
        observabilityCredentials: {
          baseUrl: "https://splunk.example.com:8089",
          token: "splunk-tok",
          index: "main",
        },
      }),
    );
    const observability = registry.get<ObservabilityProvider>("observability");
    expect(observability).toBeDefined();
    expect(typeof observability.verifyAccess).toBe("function");
    expect(typeof observability.queryLogs).toBe("function");
    expect(typeof observability.aggregate).toBe("function");
    expect(typeof observability.getAgentEnv).toBe("function");
    expect(typeof observability.getPromptInstructions).toBe("function");

    const env = observability.getAgentEnv();
    expect(env.SPLUNK_URL).toBe("https://splunk.example.com:8089");
    expect(env.SPLUNK_TOKEN).toBe("splunk-tok");
  });

  it("creates providers with elastic observability", () => {
    const registry = createProviders(
      makeConfig({
        observabilityProvider: "elastic",
        observabilityCredentials: {
          baseUrl: "https://elastic.example.com:9200",
          apiKey: "elastic-key",
          index: "logs-*",
        },
      }),
    );
    const observability = registry.get<ObservabilityProvider>("observability");
    expect(observability).toBeDefined();
    expect(typeof observability.verifyAccess).toBe("function");
    expect(typeof observability.queryLogs).toBe("function");
    expect(typeof observability.aggregate).toBe("function");
    expect(typeof observability.getAgentEnv).toBe("function");
    expect(typeof observability.getPromptInstructions).toBe("function");

    const env = observability.getAgentEnv();
    expect(env.ELASTIC_URL).toBe("https://elastic.example.com:9200");
    expect(env.ELASTIC_API_KEY).toBe("elastic-key");
  });

  it("creates providers with newrelic observability", () => {
    const registry = createProviders(
      makeConfig({
        observabilityProvider: "newrelic",
        observabilityCredentials: {
          apiKey: "NRAK-test",
          accountId: "12345",
          region: "us",
        },
      }),
    );
    const observability = registry.get<ObservabilityProvider>("observability");
    expect(observability).toBeDefined();
    expect(typeof observability.verifyAccess).toBe("function");
    expect(typeof observability.queryLogs).toBe("function");
    expect(typeof observability.aggregate).toBe("function");
    expect(typeof observability.getAgentEnv).toBe("function");
    expect(typeof observability.getPromptInstructions).toBe("function");

    const env = observability.getAgentEnv();
    expect(env.NR_API_KEY).toBe("NRAK-test");
    expect(env.NR_ACCOUNT_ID).toBe("12345");
  });

  it("creates providers with loki observability", () => {
    const registry = createProviders(
      makeConfig({
        observabilityProvider: "loki",
        observabilityCredentials: {
          baseUrl: "https://loki.example.com",
          apiKey: "loki-key",
          orgId: "tenant-1",
        },
      }),
    );
    const observability = registry.get<ObservabilityProvider>("observability");
    expect(observability).toBeDefined();
    expect(typeof observability.verifyAccess).toBe("function");
    expect(typeof observability.queryLogs).toBe("function");
    expect(typeof observability.aggregate).toBe("function");
    expect(typeof observability.getAgentEnv).toBe("function");
    expect(typeof observability.getPromptInstructions).toBe("function");

    const env = observability.getAgentEnv();
    expect(env.LOKI_URL).toBe("https://loki.example.com");
    expect(env.LOKI_API_KEY).toBe("loki-key");
  });

  it("creates providers with jira issue tracker", () => {
    const registry = createProviders(
      makeConfig({
        issueTrackerProvider: "jira",
        jiraBaseUrl: "https://myco.atlassian.net",
        jiraEmail: "bot@myco.com",
        jiraApiToken: "jira-tok",
      }),
    );
    const issueTracker = registry.get<IssueTrackingProvider>("issueTracker");
    expect(issueTracker).toBeDefined();
    expect(typeof issueTracker.verifyAccess).toBe("function");
    expect(typeof issueTracker.createIssue).toBe("function");
    expect(typeof issueTracker.getIssue).toBe("function");
    expect(typeof issueTracker.updateIssue).toBe("function");
    expect(typeof issueTracker.searchIssues).toBe("function");
    expect(typeof issueTracker.addComment).toBe("function");
    expect(typeof (issueTracker as any).linkPr).toBe("function");
  });

  it("creates providers with github-issues issue tracker", () => {
    const registry = createProviders(
      makeConfig({
        issueTrackerProvider: "github-issues",
        githubToken: "ghp_test",
      }),
    );
    const issueTracker = registry.get<IssueTrackingProvider>("issueTracker");
    expect(issueTracker).toBeDefined();
    expect(typeof issueTracker.verifyAccess).toBe("function");
    expect(typeof issueTracker.createIssue).toBe("function");
    expect(typeof issueTracker.getIssue).toBe("function");
    expect(typeof issueTracker.updateIssue).toBe("function");
    expect(typeof issueTracker.searchIssues).toBe("function");
    expect(typeof issueTracker.addComment).toBe("function");
    expect(typeof (issueTracker as any).linkPr).toBe("function");
  });

  it("creates providers with gitlab source control", () => {
    const registry = createProviders(
      makeConfig({
        sourceControlProvider: "gitlab",
        gitlabToken: "glpat-test",
        gitlabProjectId: "my-group/my-project",
        gitlabBaseUrl: "https://gitlab.com",
      }),
    );
    const sourceControl = registry.get<SourceControlProvider>("sourceControl");
    expect(sourceControl).toBeDefined();
    expect(typeof sourceControl.verifyAccess).toBe("function");
    expect(typeof sourceControl.createBranch).toBe("function");
    expect(typeof sourceControl.createPullRequest).toBe("function");
    expect(typeof sourceControl.findExistingPr).toBe("function");
    expect(typeof sourceControl.hasNewCommits).toBe("function");
    expect(typeof sourceControl.getChangedFiles).toBe("function");
    expect(typeof sourceControl.resetPaths).toBe("function");
    expect(typeof sourceControl.dispatchWorkflow).toBe("function");
  });

  it("creates providers with slack notification", () => {
    const registry = createProviders(
      makeConfig({
        notificationProvider: "slack",
        notificationWebhookUrl: "https://hooks.slack.com/services/T/B/X",
      }),
    );
    const notification = registry.get<NotificationProvider>("notification");
    expect(notification).toBeDefined();
    expect(typeof notification.send).toBe("function");
  });

  it("creates providers with email notification", () => {
    const registry = createProviders(
      makeConfig({
        notificationProvider: "email",
        sendgridApiKey: "SG.test",
        emailFrom: "bot@example.com",
        emailTo: "team@example.com, lead@example.com",
      }),
    );
    const notification = registry.get<NotificationProvider>("notification");
    expect(notification).toBeDefined();
    expect(typeof notification.send).toBe("function");
  });

  it("creates providers with generic webhook notification", () => {
    const registry = createProviders(
      makeConfig({
        notificationProvider: "webhook",
        notificationWebhookUrl: "https://hooks.example.com/sweny",
        webhookSigningSecret: "secret123",
      }),
    );
    const notification = registry.get<NotificationProvider>("notification");
    expect(notification).toBeDefined();
    expect(typeof notification.send).toBe("function");
  });

  it("defaults to github-summary notification", () => {
    const registry = createProviders(makeConfig());
    const notification = registry.get<NotificationProvider>("notification");
    expect(notification).toBeDefined();
    expect(typeof notification.send).toBe("function");
  });

  it("throws for unsupported observability provider", () => {
    expect(() => createProviders(makeConfig({ observabilityProvider: "prometheus" }))).toThrow(
      "Unsupported observability provider: prometheus",
    );
  });

  it("throws for unsupported issue tracker provider", () => {
    expect(() => createProviders(makeConfig({ issueTrackerProvider: "asana" }))).toThrow(
      "Unsupported issue tracker provider: asana",
    );
  });

  it("throws for unsupported source control provider", () => {
    expect(() => createProviders(makeConfig({ sourceControlProvider: "bitbucket" }))).toThrow(
      "Unsupported source control provider: bitbucket",
    );
  });

  it("creates providers with file observability", () => {
    const registry = createProviders(
      makeConfig({
        observabilityProvider: "file",
        observabilityCredentials: { path: "/tmp/logs.json" },
        logFilePath: "/tmp/logs.json",
      }),
    );
    const obs = registry.get<ObservabilityProvider>("observability");
    expect(obs).toBeDefined();
    expect(typeof obs.queryLogs).toBe("function");
    expect(typeof obs.aggregate).toBe("function");
    expect(typeof obs.getAgentEnv).toBe("function");
    const env = obs.getAgentEnv();
    expect(env.SWENY_LOG_FILE).toBe("/tmp/logs.json");
  });

  it("creates claude coding agent by default", () => {
    const registry = createProviders(makeConfig());
    const agent = registry.get<CodingAgent>("codingAgent");
    expect(agent).toBeDefined();
    expect(typeof agent.install).toBe("function");
    expect(typeof agent.run).toBe("function");
  });

  it("creates codex coding agent when codingAgentProvider is codex", () => {
    const registry = createProviders(makeConfig({ codingAgentProvider: "codex" }));
    const agent = registry.get<CodingAgent>("codingAgent");
    expect(agent).toBeDefined();
    expect(typeof agent.install).toBe("function");
    expect(typeof agent.run).toBe("function");
  });

  it("creates gemini coding agent when codingAgentProvider is gemini", () => {
    const registry = createProviders(makeConfig({ codingAgentProvider: "gemini" }));
    const agent = registry.get<CodingAgent>("codingAgent");
    expect(agent).toBeDefined();
    expect(typeof agent.install).toBe("function");
    expect(typeof agent.run).toBe("function");
  });
});
