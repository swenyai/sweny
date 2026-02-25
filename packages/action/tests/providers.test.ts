import { describe, it, expect } from "vitest";
import { createProviders } from "../src/providers/index.js";
import type { ActionConfig } from "../src/config.js";

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    anthropicApiKey: "",
    claudeOauthToken: "",
    observabilityProvider: "datadog",
    ddApiKey: "test-api-key",
    ddAppKey: "test-app-key",
    ddSite: "datadoghq.com",
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
  it("creates providers with datadog + linear", () => {
    const providers = createProviders(makeConfig());
    expect(providers.observability).toBeDefined();
    expect(typeof providers.observability.verifyAccess).toBe("function");
    expect(typeof providers.observability.queryLogs).toBe("function");
    expect(typeof providers.observability.aggregate).toBe("function");
  });

  it("issue tracker has core + capability methods", () => {
    const providers = createProviders(makeConfig());
    expect(typeof providers.issueTracker.verifyAccess).toBe("function");
    expect(typeof providers.issueTracker.createIssue).toBe("function");
    expect(typeof providers.issueTracker.getIssue).toBe("function");
    expect(typeof providers.issueTracker.updateIssue).toBe("function");
    expect(typeof providers.issueTracker.searchIssues).toBe("function");
    expect(typeof providers.issueTracker.addComment).toBe("function");
    // Capabilities
    expect(typeof providers.issueTracker.linkPr).toBe("function");
    expect(typeof providers.issueTracker.listTriageHistory).toBe("function");
  });

  it("throws for unsupported observability provider", () => {
    expect(() =>
      createProviders(makeConfig({ observabilityProvider: "splunk" })),
    ).toThrow("Unsupported observability provider: splunk");
  });

  it("throws for unsupported issue tracker provider", () => {
    expect(() =>
      createProviders(makeConfig({ issueTrackerProvider: "jira" })),
    ).toThrow("Unsupported issue tracker provider: jira");
  });
});
