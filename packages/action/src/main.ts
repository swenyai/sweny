import * as core from "@actions/core";
import { runWorkflow, triageWorkflow } from "@sweny-ai/engine";
import type { TriageConfig, WorkflowResult } from "@sweny-ai/engine";
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
    const triageConfig = mapToTriageConfig(config);

    const result = await runWorkflow(triageWorkflow, triageConfig, providers, {
      logger: actionsLogger,
      beforeStep: async (step) => {
        core.startGroup(`${step.phase}: ${step.name}`);
      },
      afterStep: async (step, stepResult) => {
        core.info(`${step.name}: ${stepResult.status}${stepResult.reason ? ` — ${stepResult.reason}` : ""}`);
        core.endGroup();
      },
    });

    setGitHubOutputs(result);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

function mapToTriageConfig(config: ActionConfig): TriageConfig {
  // Build agent env vars for coding agent auth
  const agentEnv: Record<string, string> = {};
  if (config.anthropicApiKey) agentEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken) agentEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;

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
