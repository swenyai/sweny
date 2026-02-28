import { describe, it, expect } from "vitest";
import { createProviders } from "../src/providers/index.js";
import type { ActionConfig } from "../src/config.js";
import type { ObservabilityProvider } from "@sweny/providers/observability";
import type { IssueTrackingProvider } from "@sweny/providers/issue-tracking";
import type { SourceControlProvider } from "@sweny/providers/source-control";
import type { NotificationProvider } from "@sweny/providers/notification";
import type { CodingAgent } from "@sweny/providers/coding-agent";

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    anthropicApiKey: "",
    claudeOauthToken: "",
    observabilityProvider: "datadog",
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
    expect(typeof (issueTracker as any).listTriageHistory).toBe("function");
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

  it("throws for unsupported observability provider", () => {
    expect(() => createProviders(makeConfig({ observabilityProvider: "splunk" }))).toThrow(
      "Unsupported observability provider: splunk",
    );
  });

  it("throws for unsupported issue tracker provider", () => {
    expect(() => createProviders(makeConfig({ issueTrackerProvider: "jira" }))).toThrow(
      "Unsupported issue tracker provider: jira",
    );
  });
});
