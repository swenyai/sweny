import * as core from "@actions/core";
import {
  execute,
  ClaudeClient,
  createSkillMap,
  configuredSkills,
  buildAutoMcpServers,
  consoleLogger,
} from "@sweny-ai/core";
import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows";
import type { ExecutionEvent, NodeResult } from "@sweny-ai/core";
import { parseInputs, validateInputs, ActionConfig } from "./config.js";

const actionsLogger = {
  info: core.info,
  debug: core.debug,
  warn: core.warning,
  error: core.error,
};

async function run(): Promise<void> {
  try {
    const config = parseInputs();
    const validationErrors = validateInputs(config);
    if (validationErrors.length > 0) {
      core.setFailed(validationErrors.join("\n"));
      return;
    }

    // Populate process.env from action inputs so skills can resolve config via env vars
    populateEnv(config);

    // Build auto-injected MCP servers from provider config
    const mcpServers = buildAutoMcpServers({
      sourceControlProvider: config.sourceControlProvider,
      issueTrackerProvider: config.issueTrackerProvider,
      observabilityProvider: config.observabilityProvider,
      credentials: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)),
      workspaceTools: config.workspaceTools,
      userMcpServers: config.mcpServers,
    });

    // Build skill map from configured skills
    const skills = createSkillMap(configuredSkills());

    // Create Claude client with external MCP servers
    const claude = new ClaudeClient({
      maxTurns: config.workflow === "implement" ? config.maxImplementTurns : config.maxInvestigateTurns,
      cwd: process.cwd(),
      logger: actionsLogger,
      mcpServers,
    });

    // Select workflow
    const workflow = config.workflow === "implement" ? implementWorkflow : triageWorkflow;

    // Build workflow input
    const input = buildWorkflowInput(config);

    // Execute workflow
    const results = await execute(workflow, input, {
      skills,
      claude,
      observer: (event: ExecutionEvent) => handleEvent(event),
      logger: actionsLogger,
    });

    setGitHubOutputs(results);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

/** Populate process.env from action inputs so skills can resolve config via env vars */
function populateEnv(config: ActionConfig): void {
  const set = (key: string, value: string | undefined) => {
    if (value) process.env[key] = value;
  };

  // Auth
  set("ANTHROPIC_API_KEY", config.anthropicApiKey);
  set("CLAUDE_CODE_OAUTH_TOKEN", config.claudeOauthToken);
  set("GITHUB_TOKEN", config.githubToken || config.botToken);

  // Issue tracker
  set("LINEAR_API_KEY", config.linearApiKey);
  set("LINEAR_TEAM_ID", config.linearTeamId);
  set("LINEAR_BUG_LABEL_ID", config.linearBugLabelId);

  // Observability — map from structured credentials to flat env vars
  const obs = config.observabilityCredentials;
  switch (config.observabilityProvider) {
    case "datadog":
      set("DD_API_KEY", obs.apiKey);
      set("DD_APP_KEY", obs.appKey);
      set("DD_SITE", obs.site);
      break;
    case "sentry":
      set("SENTRY_AUTH_TOKEN", obs.authToken);
      set("SENTRY_ORG", obs.organization);
      set("SENTRY_PROJECT", obs.project);
      break;
    case "cloudwatch":
      set("AWS_REGION", obs.region);
      set("CLOUDWATCH_LOG_GROUP_PREFIX", obs.logGroupPrefix);
      break;
    case "splunk":
      set("SPLUNK_URL", obs.baseUrl);
      set("SPLUNK_TOKEN", obs.token);
      break;
    case "elastic":
      set("ELASTIC_URL", obs.baseUrl);
      set("ELASTIC_API_KEY", obs.apiKey);
      break;
    case "newrelic":
      set("NR_API_KEY", obs.apiKey);
      set("NR_ACCOUNT_ID", obs.accountId);
      set("NR_REGION", obs.region);
      break;
    case "loki":
      set("LOKI_URL", obs.baseUrl);
      set("LOKI_API_KEY", obs.apiKey);
      set("LOKI_ORG_ID", obs.orgId);
      break;
    case "betterstack":
      set("BETTERSTACK_API_TOKEN", obs.apiToken);
      break;
  }

  // Coding agent
  set("OPENAI_API_KEY", config.openaiApiKey);
  set("GEMINI_API_KEY", config.geminiApiKey);

  // Source control
  set("GITLAB_TOKEN", config.gitlabToken);
  set("GITLAB_URL", config.gitlabBaseUrl);

  // Jira
  set("JIRA_URL", config.jiraBaseUrl);
  set("JIRA_EMAIL", config.jiraEmail);
  set("JIRA_API_TOKEN", config.jiraApiToken);

  // Notification
  set("SLACK_WEBHOOK_URL", config.notificationWebhookUrl);
  set("SENDGRID_API_KEY", config.sendgridApiKey);
}

/** Build workflow input from action config */
function buildWorkflowInput(config: ActionConfig): Record<string, unknown> {
  return {
    timeRange: config.timeRange,
    severityFocus: config.severityFocus,
    serviceFilter: config.serviceFilter,
    investigationDepth: config.investigationDepth,
    dryRun: config.dryRun,
    reviewMode: config.reviewMode,
    noveltyMode: config.noveltyMode,
    repository: config.repository,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    issueOverride: config.linearIssue,
    additionalInstructions: config.additionalInstructions,
    serviceMapPath: config.serviceMapPath,
    issueTrackerName: config.issueTrackerProvider,
    projectId: config.linearTeamId,
    issueIdentifier: config.linearIssue,
  };
}

/** Handle execution events — map to GitHub Actions log groups */
function handleEvent(event: ExecutionEvent): void {
  switch (event.type) {
    case "node:enter":
      core.startGroup(`${event.node}: ${event.instruction.slice(0, 80)}`);
      break;
    case "node:exit":
      core.info(`${event.node}: ${event.result.status}`);
      core.endGroup();
      break;
    case "tool:call":
      core.info(`  → ${event.tool}`);
      break;
  }
}

/** Set GitHub Action outputs from execution results */
function setGitHubOutputs(results: Map<string, NodeResult>): void {
  const investigateResult = results.get("investigate");
  if (investigateResult) {
    core.setOutput("issues-found", String(investigateResult.data.issuesFound ?? false));
    core.setOutput("recommendation", String(investigateResult.data.recommendation ?? "skip"));
  }

  const prResult = results.get("create_pr") ?? results.get("implement");
  const issueResult = results.get("create_issue") ?? results.get("create-issue");
  if (prResult) {
    core.setOutput("issue-identifier", String(prResult.data.issueIdentifier ?? ""));
    core.setOutput("issue-url", String(prResult.data.issueUrl ?? ""));
    core.setOutput("pr-url", String(prResult.data.prUrl ?? ""));
    core.setOutput("pr-number", String(prResult.data.prNumber ?? ""));
  } else if (issueResult) {
    core.setOutput("issue-identifier", String(issueResult.data.issueIdentifier ?? ""));
    core.setOutput("issue-url", String(issueResult.data.issueUrl ?? ""));
  }
}

run();
