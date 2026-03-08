import * as core from "@actions/core";
import { runRecipe, triageRecipe, implementRecipe } from "@sweny-ai/engine";
import type { TriageConfig, ImplementConfig, WorkflowResult } from "@sweny-ai/engine";
import { parseInputs, validateInputs, ActionConfig } from "./config.js";
import { createProviders } from "./providers/index.js";

const actionsLogger = { info: core.info, debug: core.debug, warn: core.warning, error: core.error };

async function run(): Promise<void> {
  try {
    const config = parseInputs();
    const validationErrors = validateInputs(config);
    if (validationErrors.length > 0) {
      core.setFailed(validationErrors.join("\n"));
      return;
    }
    const providers = createProviders(config);

    const runOptions = {
      logger: actionsLogger,
      beforeStep: async (step: { phase: string; name: string }) => {
        core.startGroup(`${step.phase}: ${step.name}`);
      },
      afterStep: async (step: { name: string }, stepResult: { status: string; reason?: string }) => {
        core.info(`${step.name}: ${stepResult.status}${stepResult.reason ? ` — ${stepResult.reason}` : ""}`);
        core.endGroup();
      },
    };

    let result: WorkflowResult;
    if (config.recipe === "implement") {
      const implementConfig = mapToImplementConfig(config);
      result = await runRecipe(implementRecipe, implementConfig, providers, runOptions);
    } else {
      const triageConfig = mapToTriageConfig(config);
      result = await runRecipe(triageRecipe, triageConfig, providers, runOptions);
    }

    setGitHubOutputs(result);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

export function mapToImplementConfig(config: ActionConfig): ImplementConfig {
  const agentEnv: Record<string, string> = {};
  if (config.anthropicApiKey) agentEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken) agentEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;
  if (config.openaiApiKey) agentEnv.OPENAI_API_KEY = config.openaiApiKey;
  if (config.geminiApiKey) agentEnv.GEMINI_API_KEY = config.geminiApiKey;
  if (config.githubToken) agentEnv.GITHUB_TOKEN = config.githubToken;
  if (config.linearApiKey) agentEnv.LINEAR_API_KEY = config.linearApiKey;
  if (config.linearTeamId) agentEnv.LINEAR_TEAM_ID = config.linearTeamId;

  return {
    issueIdentifier: config.linearIssue,
    repository: config.repository,
    dryRun: config.dryRun,
    maxImplementTurns: config.maxImplementTurns,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    projectId: config.linearTeamId,
    stateInProgress: config.linearStateInProgress,
    statePeerReview: config.linearStatePeerReview,
    agentEnv,
  };
}

export function mapToTriageConfig(config: ActionConfig): TriageConfig {
  // Build agent env vars for coding agent auth
  const agentEnv: Record<string, string> = {};
  if (config.anthropicApiKey) agentEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken) agentEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;
  if (config.openaiApiKey) agentEnv.OPENAI_API_KEY = config.openaiApiKey;
  if (config.geminiApiKey) agentEnv.GEMINI_API_KEY = config.geminiApiKey;

  // Issue tracker env vars (only set when relevant)
  if (config.linearApiKey) agentEnv.LINEAR_API_KEY = config.linearApiKey;
  if (config.linearTeamId) agentEnv.LINEAR_TEAM_ID = config.linearTeamId;
  if (config.linearBugLabelId) agentEnv.LINEAR_BUG_LABEL_ID = config.linearBugLabelId;

  // Add observability env vars
  const obsCreds = config.observabilityCredentials;
  switch (config.observabilityProvider) {
    case "datadog":
      if (obsCreds.apiKey) agentEnv.DD_API_KEY = obsCreds.apiKey;
      if (obsCreds.appKey) agentEnv.DD_APP_KEY = obsCreds.appKey;
      if (obsCreds.site) agentEnv.DD_SITE = obsCreds.site;
      break;
    case "sentry":
      if (obsCreds.authToken) agentEnv.SENTRY_AUTH_TOKEN = obsCreds.authToken;
      if (obsCreds.organization) agentEnv.SENTRY_ORG = obsCreds.organization;
      if (obsCreds.project) agentEnv.SENTRY_PROJECT = obsCreds.project;
      break;
    case "cloudwatch":
      if (obsCreds.region) agentEnv.AWS_REGION = obsCreds.region;
      if (obsCreds.logGroupPrefix) agentEnv.CLOUDWATCH_LOG_GROUP_PREFIX = obsCreds.logGroupPrefix;
      break;
    case "splunk":
      if (obsCreds.baseUrl) agentEnv.SPLUNK_URL = obsCreds.baseUrl;
      if (obsCreds.token) agentEnv.SPLUNK_TOKEN = obsCreds.token;
      break;
    case "elastic":
      if (obsCreds.baseUrl) agentEnv.ELASTIC_URL = obsCreds.baseUrl;
      if (obsCreds.apiKey) agentEnv.ELASTIC_API_KEY = obsCreds.apiKey;
      break;
    case "newrelic":
      if (obsCreds.apiKey) agentEnv.NR_API_KEY = obsCreds.apiKey;
      if (obsCreds.accountId) agentEnv.NR_ACCOUNT_ID = obsCreds.accountId;
      break;
    case "loki":
      if (obsCreds.baseUrl) agentEnv.LOKI_URL = obsCreds.baseUrl;
      if (obsCreds.apiKey) agentEnv.LOKI_API_KEY = obsCreds.apiKey;
      if (obsCreds.orgId) agentEnv.LOKI_ORG_ID = obsCreds.orgId;
      break;
  }

  return {
    timeRange: config.timeRange,
    severityFocus: config.severityFocus,
    serviceFilter: config.serviceFilter,
    investigationDepth: config.investigationDepth,
    maxInvestigateTurns: config.maxInvestigateTurns,
    maxImplementTurns: config.maxImplementTurns,
    serviceMapPath: config.serviceMapPath,

    projectId: config.linearTeamId,
    bugLabelId: config.linearBugLabelId,
    triageLabelId: config.linearTriageLabelId,
    stateBacklog: config.linearStateBacklog,
    stateInProgress: config.linearStateInProgress,
    statePeerReview: config.linearStatePeerReview,

    repository: config.repository,

    baseBranch: config.baseBranch,
    prLabels: config.prLabels,

    dryRun: config.dryRun,
    noveltyMode: config.noveltyMode,
    issueOverride: config.linearIssue,
    additionalInstructions: config.additionalInstructions,

    agentEnv,
  };
}

function setGitHubOutputs(result: WorkflowResult): void {
  // Investigation results
  const investigateData = result.steps.find((s) => s.name === "investigate")?.result.data;
  if (investigateData) {
    core.setOutput("issues-found", String(investigateData.issuesFound ?? false));
    core.setOutput("recommendation", String(investigateData.recommendation ?? "skip"));
  }

  // PR results
  const prData = result.steps.find((s) => s.name === "create-pr")?.result.data;
  const issueData = result.steps.find((s) => s.name === "create-issue")?.result.data;
  if (prData) {
    core.setOutput("issue-identifier", String(prData.issueIdentifier ?? ""));
    core.setOutput("issue-url", String(prData.issueUrl ?? ""));
    core.setOutput("pr-url", String(prData.prUrl ?? ""));
    core.setOutput("pr-number", String(prData.prNumber ?? ""));
  } else if (issueData) {
    core.setOutput("issue-identifier", String(issueData.issueIdentifier ?? ""));
    core.setOutput("issue-url", String(issueData.issueUrl ?? ""));
  }
}

run();
