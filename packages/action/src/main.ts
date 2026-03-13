import * as core from "@actions/core";
import { runRecipe, triageRecipe, implementRecipe } from "@sweny-ai/engine";
import type { TriageConfig, ImplementConfig, WorkflowResult } from "@sweny-ai/engine";
import { parseInputs, validateInputs, ActionConfig } from "./config.js";
import { createProviders } from "./providers/index.js";
import type { MCPServerConfig } from "@sweny-ai/providers";

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
      beforeStep: async (step: { id: string; phase: string }) => {
        core.startGroup(`${step.phase}: ${step.id}`);
      },
      afterStep: async (step: { id: string }, stepResult: { status: string; reason?: string }) => {
        core.info(`${step.id}: ${stepResult.status}${stepResult.reason ? ` — ${stepResult.reason}` : ""}`);
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
    reviewMode: config.reviewMode,
    maxImplementTurns: config.maxImplementTurns,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    projectId: config.linearTeamId,
    stateInProgress: config.linearStateInProgress,
    statePeerReview: config.linearStatePeerReview,
    issueTrackerName: config.issueTrackerProvider,
    agentEnv,
    mcpServers: buildAutoMcpServers(config),
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
    reviewMode: config.reviewMode,
    noveltyMode: config.noveltyMode,
    issueOverride: config.linearIssue,
    additionalInstructions: config.additionalInstructions,
    issueTrackerName: config.issueTrackerProvider,

    agentEnv,
    mcpServers: buildAutoMcpServers(config),
  };
}

/**
 * Auto-inject well-known MCP servers for providers the user already configured.
 *
 * Design rules:
 * - HTTP transport preferred for cloud-hosted services (no local install, vendor-managed).
 * - stdio (npx) used when no stable HTTP endpoint exists; the agent handles process spawning.
 * - Category A: injected from structured provider config (sourceControlProvider, etc.)
 * - Category B: injected when specific env vars are present — zero new action inputs required.
 *   Users set these as workflow env vars: `env: { SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }} }`
 * - User-supplied mcpServers always win on key conflict (explicit > auto).
 */
function buildAutoMcpServers(config: ActionConfig): Record<string, MCPServerConfig> | undefined {
  const auto: Record<string, MCPServerConfig> = {};
  const obsCreds = config.observabilityCredentials;

  // ── Category A: Provider-config triggered ─────────────────────────────────

  // GitHub MCP — inject when using GitHub source control OR GitHub Issues tracker.
  // @modelcontextprotocol/server-github requires GITHUB_PERSONAL_ACCESS_TOKEN (not GITHUB_TOKEN).
  const githubToken = config.githubToken || config.botToken;
  if ((config.sourceControlProvider === "github" || config.issueTrackerProvider === "github-issues") && githubToken) {
    auto["github"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
    };
  }

  // GitLab MCP — inject when source control provider is gitlab.
  if (config.sourceControlProvider === "gitlab" && config.gitlabToken) {
    const gitlabEnv: Record<string, string> = { GITLAB_PERSONAL_ACCESS_TOKEN: config.gitlabToken };
    // For self-hosted GitLab, point to the instance API
    const baseUrl = config.gitlabBaseUrl || "https://gitlab.com";
    if (baseUrl !== "https://gitlab.com") gitlabEnv.GITLAB_API_URL = `${baseUrl}/api/v4`;
    auto["gitlab"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gitlab@latest"],
      env: gitlabEnv,
    };
  }

  // Linear MCP — official HTTP remote MCP endpoint (https://linear.app/changelog/2025-04-09-mcp)
  if (config.issueTrackerProvider === "linear" && config.linearApiKey) {
    auto["linear"] = {
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${config.linearApiKey}` },
    };
  }

  // Datadog MCP — HTTP transport (/unstable is the current versioned path for this endpoint)
  const ddKey = obsCreds.apiKey;
  const ddAppKey = obsCreds.appKey;
  if (config.observabilityProvider === "datadog" && ddKey && ddAppKey) {
    auto["datadog"] = {
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: ddKey, DD_APPLICATION_KEY: ddAppKey },
    };
  }

  // Sentry MCP — inject when observability provider is sentry with auth token present.
  if (config.observabilityProvider === "sentry" && obsCreds.authToken) {
    const sentryEnv: Record<string, string> = { SENTRY_AUTH_TOKEN: obsCreds.authToken };
    // For self-hosted Sentry, override the host (hostname only, no protocol)
    if (obsCreds.baseUrl && obsCreds.baseUrl !== "https://sentry.io") {
      try {
        sentryEnv.SENTRY_HOST = new URL(obsCreds.baseUrl).hostname;
      } catch {
        // malformed URL — leave SENTRY_HOST unset, server defaults to sentry.io
      }
    }
    auto["sentry"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp-server@latest"],
      env: sentryEnv,
    };
  }

  // ── Category B: Environment-variable triggered (zero new action inputs required) ─

  // Slack MCP — inject when SLACK_BOT_TOKEN is present in the environment.
  // Bot token provides full bidirectional API access for agent queries/posts.
  // This is separate from the one-way NOTIFICATION_WEBHOOK_URL used for triage summaries.
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  if (slackBotToken) {
    const slackEnv: Record<string, string> = { SLACK_BOT_TOKEN: slackBotToken };
    if (process.env.SLACK_TEAM_ID) slackEnv.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID;
    auto["slack"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack@latest"],
      env: slackEnv,
    };
  }

  // Notion MCP — inject when NOTION_API_KEY is present in the environment.
  // Gives the agent read access to Notion pages/databases (runbooks, on-call docs, etc.)
  const notionApiKey = process.env.NOTION_API_KEY;
  if (notionApiKey) {
    auto["notion"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server@latest"],
      env: { NOTION_API_KEY: notionApiKey },
    };
  }

  const merged = { ...auto, ...config.mcpServers };
  return Object.keys(merged).length > 0 ? merged : undefined;
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
