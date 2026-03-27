import * as core from "@actions/core";
import {
  execute,
  ClaudeClient,
  createSkillMap,
  configuredSkills,
  buildAutoMcpServers,
  buildProviderContext,
  consoleLogger,
  resolveTemplates,
  loadAdditionalContext,
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

    // Load templates & additional context
    const templates = await resolveTemplates(
      { issueTemplate: config.issueTemplate, prTemplate: config.prTemplate },
      process.cwd(),
    );
    const userContextResult = await loadAdditionalContext(config.additionalContext, process.cwd());

    // Build dynamic provider context
    const extras: Record<string, string> = {};
    if (config.observabilityCredentials.sourceId) {
      extras["BetterStack source ID"] = config.observabilityCredentials.sourceId;
    }
    if (config.observabilityCredentials.tableName) {
      extras["BetterStack table name"] = config.observabilityCredentials.tableName;
    }
    const providerCtx = buildProviderContext({
      observabilityProvider: config.observabilityProvider,
      issueTrackerProvider: config.issueTrackerProvider,
      sourceControlProvider: config.sourceControlProvider,
      mcpServers: Object.keys(mcpServers),
      extras: Object.keys(extras).length > 0 ? extras : undefined,
    });

    const contextParts = [providerCtx, userContextResult.resolved, config.additionalInstructions].filter(Boolean);
    const context = contextParts.join("\n\n");

    // Build workflow input
    const input = {
      ...buildWorkflowInput(config),
      ...templates,
      // Structured rules/context for executor
      ...(context ? { context } : {}),
      // URLs for the prepare node to fetch at runtime
      ...(userContextResult.urls.length > 0 ? { contextUrls: userContextResult.urls } : {}),
    };

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
      set("BETTERSTACK_SOURCE_ID", obs.sourceId);
      set("BETTERSTACK_TABLE_NAME", obs.tableName);
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
    observabilityProvider: config.observabilityProvider,
    ...(config.observabilityCredentials.sourceId && {
      betterstackSourceId: config.observabilityCredentials.sourceId,
    }),
    ...(config.observabilityCredentials.tableName && {
      betterstackTableName: config.observabilityCredentials.tableName,
    }),
  };
}

/** Handle execution events — map to GitHub Actions log groups with full streaming detail */
function handleEvent(event: ExecutionEvent): void {
  switch (event.type) {
    case "workflow:start":
      core.info(`▲ ${event.workflow}`);
      break;

    case "node:enter":
      core.startGroup(`${event.node}: ${event.instruction.slice(0, 80)}`);
      core.info(`→ ${event.node}`);
      break;

    case "node:progress":
      core.info(`  ↳ ${event.message}`);
      break;

    case "tool:call":
      core.info(`  → ${event.tool}(${summarizeInput(event.input)})`);
      break;

    case "tool:result":
      core.info(`  ✓ ${event.tool} → ${summarizeOutput(event.output)}`);
      break;

    case "node:exit":
      if (event.result.status === "failed") {
        core.error(`✗ ${event.node}: ${event.result.status}`);
        if (event.result.data?.error) core.error(`  ${event.result.data.error}`);
      } else {
        core.info(`✓ ${event.node}: ${event.result.status} (${event.result.toolCalls.length} tool calls)`);
      }
      core.endGroup();
      break;

    case "route":
      core.info(`⤳ ${event.from} → ${event.to} (${event.reason})`);
      break;

    case "workflow:end": {
      const statuses = Object.entries(event.results)
        .map(([id, r]) => `${id}:${r.status}`)
        .join(", ");
      core.info(`▼ workflow complete — ${statuses}`);
      break;
    }
  }
}

/** Summarize tool input for logging (truncated, no secrets) */
function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      parts.push(`${k}=${v.length > 60 ? v.slice(0, 59) + "…" : v}`);
    } else if (typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join(", ");
}

/** Summarize tool output for logging (truncated) */
function summarizeOutput(output: unknown): string {
  if (output === undefined || output === null) return "ok";
  if (typeof output === "string") return output.length > 120 ? output.slice(0, 119) + "…" : output;
  const s = JSON.stringify(output);
  return s.length > 120 ? s.slice(0, 119) + "…" : s;
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
