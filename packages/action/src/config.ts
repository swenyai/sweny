import * as core from "@actions/core";
import type { MCPServerConfig } from "@sweny-ai/providers";

export interface ActionConfig {
  // Workflow selection
  workflow: "triage" | "implement";

  // Claude authentication
  anthropicApiKey: string;
  claudeOauthToken: string;

  // Observability
  observabilityProvider: string;
  observabilityCredentials: Record<string, string>;

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

  // PR / branch settings
  baseBranch: string;
  prLabels: string[];

  // Coding agent
  codingAgentProvider: string;
  openaiApiKey: string;
  geminiApiKey: string;

  // Behavior
  dryRun: boolean;
  noveltyMode: boolean;
  reviewMode: "auto" | "review";
  linearIssue: string;
  additionalInstructions: string;
  serviceMapPath: string;
  githubToken: string;
  botToken: string;

  // Source control
  sourceControlProvider: string;

  // Jira credentials (when issue tracker = jira)
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;

  // GitLab credentials (when source control = gitlab)
  gitlabToken: string;
  gitlabProjectId: string;
  gitlabBaseUrl: string;

  // Notification
  notificationProvider: string;
  notificationWebhookUrl: string;
  sendgridApiKey: string;
  emailFrom: string;
  emailTo: string;
  webhookSigningSecret: string;
  // Output (file providers)
  outputDir: string;

  // MCP servers for agent tool access
  mcpServers: Record<string, MCPServerConfig>;

  // Workspace tool integrations — explicit opt-in for Category B MCP servers.
  // Supported: slack, notion, pagerduty, monday
  workspaceTools: string[];

  // Runtime context
  repository: string;
  repositoryOwner: string;
  logFilePath: string;
}

export function parseInputs(): ActionConfig {
  const workflowRaw = core.getInput("workflow") || "triage";
  return {
    workflow: (workflowRaw === "implement" ? "implement" : "triage") as "triage" | "implement",
    anthropicApiKey: core.getInput("anthropic-api-key"),
    claudeOauthToken: core.getInput("claude-oauth-token"),

    codingAgentProvider: core.getInput("coding-agent-provider") || "claude",
    openaiApiKey: core.getInput("openai-api-key"),
    geminiApiKey: core.getInput("gemini-api-key"),

    observabilityProvider: core.getInput("observability-provider") || "datadog",
    observabilityCredentials: parseObservabilityCredentials(core.getInput("observability-provider") || "datadog"),

    issueTrackerProvider: core.getInput("issue-tracker-provider") || "github-issues",
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

    baseBranch: core.getInput("base-branch") || "main",
    prLabels: (core.getInput("pr-labels") || "agent,triage,needs-review").split(",").map((l) => l.trim()),

    dryRun: core.getBooleanInput("dry-run"),
    noveltyMode: core.getBooleanInput("novelty-mode"),
    reviewMode: (core.getInput("review-mode") || "review") as "auto" | "review",
    linearIssue: core.getInput("linear-issue"),
    additionalInstructions: core.getInput("additional-instructions"),
    serviceMapPath: core.getInput("service-map-path") || ".github/service-map.yml",
    githubToken: core.getInput("github-token"),
    botToken: core.getInput("bot-token"),

    sourceControlProvider: core.getInput("source-control-provider") || "github",

    jiraBaseUrl: core.getInput("jira-base-url"),
    jiraEmail: core.getInput("jira-email"),
    jiraApiToken: core.getInput("jira-api-token"),

    gitlabToken: core.getInput("gitlab-token"),
    gitlabProjectId: core.getInput("gitlab-project-id"),
    gitlabBaseUrl: core.getInput("gitlab-base-url") || "https://gitlab.com",

    notificationProvider: core.getInput("notification-provider") || "github-summary",
    notificationWebhookUrl: core.getInput("notification-webhook-url"),
    sendgridApiKey: core.getInput("sendgrid-api-key"),
    emailFrom: core.getInput("email-from"),
    emailTo: core.getInput("email-to"),
    webhookSigningSecret: core.getInput("webhook-signing-secret"),

    outputDir: core.getInput("output-dir") || ".github/sweny-output",

    mcpServers: parseMcpServers(core.getInput("mcp-servers")),

    workspaceTools: (core.getInput("workspace-tools") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),

    repository: process.env.GITHUB_REPOSITORY || "",
    repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER || "",
    logFilePath: core.getInput("log-file-path"),
  };
}

/**
 * Parse a JSON string into MCP server configs.
 * Returns empty object on blank input; throws on malformed JSON.
 *
 * Example action.yml usage:
 *   mcp-servers: '{"datadog":{"type":"http","url":"https://...","headers":{"DD_API_KEY":"${{ secrets.DD_API_KEY }}"}}}'
 */
function parseMcpServers(json: string): Record<string, MCPServerConfig> {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json) as Record<string, MCPServerConfig>;
  } catch {
    throw new Error(
      `Invalid mcp-servers input: expected a JSON object mapping server names to MCPServerConfig.\n  Got: ${json.slice(0, 120)}`,
    );
  }
}

/** All recognized workspace tool names. Update here when adding a new Category B MCP server. */
export const SUPPORTED_WORKSPACE_TOOLS = new Set<string>(["slack", "notion", "pagerduty", "monday"]);

export function validateInputs(config: ActionConfig): string[] {
  const errors: string[] = [];

  // Implement workflow requires an issue identifier
  if (config.workflow === "implement" && !config.linearIssue) {
    errors.push("Missing required input: `linear-issue` is required when `workflow` is `implement`");
  }

  // Auth: at least one required
  if (!config.anthropicApiKey && !config.claudeOauthToken) {
    errors.push("Missing required input: either `anthropic-api-key` or `claude-oauth-token` must be provided");
  }

  // Observability credentials by provider
  switch (config.observabilityProvider) {
    case "datadog":
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing required input: `dd-api-key` is required when `observability-provider` is `datadog`");
      if (!config.observabilityCredentials.appKey)
        errors.push("Missing required input: `dd-app-key` is required when `observability-provider` is `datadog`");
      break;
    case "sentry":
      if (!config.observabilityCredentials.authToken)
        errors.push(
          "Missing required input: `sentry-auth-token` is required when `observability-provider` is `sentry`",
        );
      if (!config.observabilityCredentials.organization)
        errors.push("Missing required input: `sentry-org` is required when `observability-provider` is `sentry`");
      if (!config.observabilityCredentials.project)
        errors.push("Missing required input: `sentry-project` is required when `observability-provider` is `sentry`");
      break;
    case "cloudwatch":
      if (!config.observabilityCredentials.logGroupPrefix)
        errors.push(
          "Missing required input: `cloudwatch-log-group-prefix` is required when `observability-provider` is `cloudwatch`",
        );
      break;
    case "splunk":
      if (!config.observabilityCredentials.baseUrl)
        errors.push("Missing required input: `splunk-url` is required when `observability-provider` is `splunk`");
      if (!config.observabilityCredentials.token)
        errors.push("Missing required input: `splunk-token` is required when `observability-provider` is `splunk`");
      break;
    case "elastic":
      if (!config.observabilityCredentials.baseUrl)
        errors.push("Missing required input: `elastic-url` is required when `observability-provider` is `elastic`");
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing required input: `elastic-api-key` is required when `observability-provider` is `elastic`");
      break;
    case "newrelic":
      if (!config.observabilityCredentials.apiKey)
        errors.push(
          "Missing required input: `newrelic-api-key` is required when `observability-provider` is `newrelic`",
        );
      if (!config.observabilityCredentials.accountId)
        errors.push(
          "Missing required input: `newrelic-account-id` is required when `observability-provider` is `newrelic`",
        );
      break;
    case "loki":
      if (!config.observabilityCredentials.baseUrl)
        errors.push("Missing required input: `loki-url` is required when `observability-provider` is `loki`");
      break;
    case "file":
      if (!config.logFilePath)
        errors.push("Missing required input: `log-file-path` is required when `observability-provider` is `file`");
      break;
    case "vercel":
      if (!config.observabilityCredentials.token)
        errors.push("Missing required input: `vercel-token` is required when `observability-provider` is `vercel`");
      if (!config.observabilityCredentials.projectId)
        errors.push(
          "Missing required input: `vercel-project-id` is required when `observability-provider` is `vercel`",
        );
      break;
    case "supabase":
      if (!config.observabilityCredentials.managementApiKey)
        errors.push(
          "Missing required input: `supabase-management-key` is required when `observability-provider` is `supabase`",
        );
      if (!config.observabilityCredentials.projectRef)
        errors.push(
          "Missing required input: `supabase-project-ref` is required when `observability-provider` is `supabase`",
        );
      break;
  }

  // Issue tracker credentials by provider
  switch (config.issueTrackerProvider) {
    case "linear":
      if (!config.linearApiKey)
        errors.push("Missing required input: `linear-api-key` is required when `issue-tracker-provider` is `linear`");
      if (!config.linearTeamId)
        errors.push("Missing required input: `linear-team-id` is required when `issue-tracker-provider` is `linear`");
      break;
    case "jira":
      if (!config.jiraBaseUrl)
        errors.push("Missing required input: `jira-base-url` is required when `issue-tracker-provider` is `jira`");
      if (!config.jiraEmail)
        errors.push("Missing required input: `jira-email` is required when `issue-tracker-provider` is `jira`");
      if (!config.jiraApiToken)
        errors.push("Missing required input: `jira-api-token` is required when `issue-tracker-provider` is `jira`");
      break;
  }

  // Source control credentials by provider
  switch (config.sourceControlProvider) {
    case "gitlab":
      if (!config.gitlabToken)
        errors.push("Missing required input: `gitlab-token` is required when `source-control-provider` is `gitlab`");
      if (!config.gitlabProjectId)
        errors.push(
          "Missing required input: `gitlab-project-id` is required when `source-control-provider` is `gitlab`",
        );
      break;
  }

  // Notification credentials by provider
  switch (config.notificationProvider) {
    case "slack":
    case "teams":
    case "discord":
    case "webhook":
      if (!config.notificationWebhookUrl)
        errors.push(
          `Missing required input: \`notification-webhook-url\` is required when \`notification-provider\` is \`${config.notificationProvider}\``,
        );
      break;
    case "email":
      if (!config.sendgridApiKey)
        errors.push("Missing required input: `sendgrid-api-key` is required when `notification-provider` is `email`");
      if (!config.emailFrom)
        errors.push("Missing required input: `email-from` is required when `notification-provider` is `email`");
      if (!config.emailTo)
        errors.push("Missing required input: `email-to` is required when `notification-provider` is `email`");
      break;
  }

  // Coding agent credentials by provider
  switch (config.codingAgentProvider) {
    case "codex":
      if (!config.openaiApiKey)
        errors.push("Missing required input: `openai-api-key` is required when `coding-agent-provider` is `codex`");
      break;
    case "gemini":
      if (!config.geminiApiKey)
        errors.push("Missing required input: `gemini-api-key` is required when `coding-agent-provider` is `gemini`");
      break;
  }

  // Workspace tools: reject unknown names early
  for (const tool of config.workspaceTools) {
    if (!SUPPORTED_WORKSPACE_TOOLS.has(tool)) {
      errors.push(`Unknown workspace tool: "${tool}". Supported values: ${[...SUPPORTED_WORKSPACE_TOOLS].join(", ")}`);
    }
  }

  // Enum validation
  if (!["auto", "review"].includes(config.reviewMode)) {
    errors.push("`review-mode` must be one of: auto, review");
  }

  // Integer bounds
  if (config.maxInvestigateTurns < 1 || config.maxInvestigateTurns > 500) {
    errors.push("`max-investigate-turns` must be between 1 and 500");
  }
  if (config.maxImplementTurns < 1 || config.maxImplementTurns > 500) {
    errors.push("`max-implement-turns` must be between 1 and 500");
  }

  return errors;
}

function parseObservabilityCredentials(provider: string): Record<string, string> {
  switch (provider) {
    case "datadog":
      return {
        apiKey: core.getInput("dd-api-key"),
        appKey: core.getInput("dd-app-key"),
        site: core.getInput("dd-site") || "datadoghq.com",
      };
    case "sentry":
      return {
        authToken: core.getInput("sentry-auth-token"),
        organization: core.getInput("sentry-org"),
        project: core.getInput("sentry-project"),
        baseUrl: core.getInput("sentry-base-url") || "https://sentry.io",
      };
    case "cloudwatch":
      return {
        region: core.getInput("cloudwatch-region") || "us-east-1",
        logGroupPrefix: core.getInput("cloudwatch-log-group-prefix"),
      };
    case "splunk":
      return {
        baseUrl: core.getInput("splunk-url"),
        token: core.getInput("splunk-token"),
        index: core.getInput("splunk-index") || "main",
      };
    case "elastic":
      return {
        baseUrl: core.getInput("elastic-url"),
        apiKey: core.getInput("elastic-api-key"),
        index: core.getInput("elastic-index") || "logs-*",
      };
    case "newrelic":
      return {
        apiKey: core.getInput("newrelic-api-key"),
        accountId: core.getInput("newrelic-account-id"),
        region: core.getInput("newrelic-region") || "us",
      };
    case "loki":
      return {
        baseUrl: core.getInput("loki-url"),
        apiKey: core.getInput("loki-api-key"),
        orgId: core.getInput("loki-org-id"),
      };
    case "file":
      return {
        path: core.getInput("log-file-path"),
      };
    case "vercel":
      return {
        token: core.getInput("vercel-token"),
        projectId: core.getInput("vercel-project-id"),
        teamId: core.getInput("vercel-team-id"),
      };
    case "supabase":
      return {
        managementApiKey: core.getInput("supabase-management-key"),
        projectRef: core.getInput("supabase-project-ref"),
      };
    default:
      return {};
  }
}
