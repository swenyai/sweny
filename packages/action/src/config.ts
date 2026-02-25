import * as core from "@actions/core";

export interface ActionConfig {
  // Claude authentication
  anthropicApiKey: string;
  claudeOauthToken: string;

  // Observability
  observabilityProvider: string;
  ddApiKey: string;
  ddAppKey: string;
  ddSite: string;

  // Issue tracker
  issueTrackerProvider: string;
  linearApiKey: string;
  linearTeamId: string;
  linearBugLabelId: string;
  linearTriageLabelId: string;
  linearStateBacklog: string;
  linearStateInProgress: string;
  linearStatePeerReview: string;

  // Investigation params
  timeRange: string;
  severityFocus: string;
  serviceFilter: string;
  investigationDepth: string;
  maxInvestigateTurns: number;
  maxImplementTurns: number;

  // Behavior
  dryRun: boolean;
  noveltyMode: boolean;
  linearIssue: string;
  additionalInstructions: string;
  serviceMapPath: string;
  githubToken: string;
  botToken: string;

  // Runtime context
  repository: string;
  repositoryOwner: string;
}

export function parseInputs(): ActionConfig {
  return {
    anthropicApiKey: core.getInput("anthropic-api-key"),
    claudeOauthToken: core.getInput("claude-oauth-token"),

    observabilityProvider: core.getInput("observability-provider") || "datadog",
    ddApiKey: core.getInput("dd-api-key"),
    ddAppKey: core.getInput("dd-app-key"),
    ddSite: core.getInput("dd-site") || "datadoghq.com",

    issueTrackerProvider: core.getInput("issue-tracker-provider") || "linear",
    linearApiKey: core.getInput("linear-api-key"),
    linearTeamId: core.getInput("linear-team-id"),
    linearBugLabelId: core.getInput("linear-bug-label-id"),
    linearTriageLabelId: core.getInput("linear-triage-label-id"),
    linearStateBacklog: core.getInput("linear-state-backlog"),
    linearStateInProgress: core.getInput("linear-state-in-progress"),
    linearStatePeerReview: core.getInput("linear-state-peer-review"),

    timeRange: core.getInput("time-range") || "24h",
    severityFocus: core.getInput("severity-focus") || "errors",
    serviceFilter: core.getInput("service-filter") || "*",
    investigationDepth: core.getInput("investigation-depth") || "standard",
    maxInvestigateTurns: parseInt(core.getInput("max-investigate-turns") || "50", 10),
    maxImplementTurns: parseInt(core.getInput("max-implement-turns") || "30", 10),

    dryRun: core.getBooleanInput("dry-run"),
    noveltyMode: core.getBooleanInput("novelty-mode"),
    linearIssue: core.getInput("linear-issue"),
    additionalInstructions: core.getInput("additional-instructions"),
    serviceMapPath: core.getInput("service-map-path") || ".github/service-map.yml",
    githubToken: core.getInput("github-token"),
    botToken: core.getInput("bot-token"),

    repository: process.env.GITHUB_REPOSITORY || "",
    repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER || "",
  };
}
