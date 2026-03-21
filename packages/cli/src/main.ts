#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };
import chalk from "chalk";
import {
  runWorkflow,
  triageWorkflow,
  implementWorkflow,
  validateWorkflow,
  resolveWorkflow,
  listStepTypes,
  triageDefinition,
  implementDefinition,
  WORKFLOW_YAML_SCHEMA_HEADER,
} from "@sweny-ai/engine";
// Register built-in step types so resolveWorkflow() can look them up
import "@sweny-ai/engine/builtin-steps";
import type {
  StepCache,
  TriageConfig,
  WorkflowPhase,
  ImplementConfig,
  WorkflowDefinition,
  RunObserver,
} from "@sweny-ai/engine";
import { createFsCache, hashConfig } from "./cache.js";
import { loadDotenv, loadConfigFile, STARTER_CONFIG } from "./config-file.js";
import {
  registerTriageCommand,
  registerImplementCommand,
  parseCliInputs,
  validateInputs,
  validateWarnings,
} from "./config.js";
import type { CliConfig } from "./config.js";
import { createProviders, createImplementProviders } from "./providers/index.js";
import type { MCPServerConfig } from "@sweny-ai/providers";
import {
  c,
  phaseColor,
  formatBanner,
  formatPhaseHeader,
  getStepDetails,
  formatStepLine,
  formatResultHuman,
  formatResultJson,
  formatValidationErrors,
  formatCrashError,
  formatCheckResults,
} from "./output.js";
import { checkProviderConnectivity } from "./check.js";
import { registerSetupCommand } from "./setup.js";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// Auto-load .env before Commander parses (so env vars are available for defaults)
loadDotenv();

const program = new Command()
  .name("sweny")
  .description("SWEny CLI \u2014 autonomous engineering workflows")
  .version(version);

// ── sweny init ────────────────────────────────────────────────────────
program
  .command("init")
  .description("Create a starter .sweny.yml config file")
  .action(() => {
    const target = path.join(process.cwd(), ".sweny.yml");
    if (fs.existsSync(target)) {
      console.error(chalk.yellow("  .sweny.yml already exists — skipping."));
      process.exit(1);
    }
    fs.writeFileSync(target, STARTER_CONFIG, "utf-8");
    console.log(chalk.green("  Created .sweny.yml"));
    console.log(chalk.dim("  Add your secrets to .env and run: sweny triage --dry-run"));
  });

// ── sweny check ───────────────────────────────────────────────────────
program
  .command("check")
  .description("Verify provider credentials and connectivity")
  .action(async () => {
    const fileConfig = loadConfigFile();
    const config = parseCliInputs({}, fileConfig);
    const errors = validateInputs(config);
    if (errors.length > 0) {
      console.error(formatValidationErrors(errors));
      process.exit(1);
    }
    console.log(chalk.dim("\n  Checking provider connectivity…\n"));
    const results = await checkProviderConnectivity(config);
    console.log(formatCheckResults(results));
    const hasFailure = results.some((r) => r.status === "fail");
    process.exit(hasFailure ? 1 : 0);
  });

registerSetupCommand(program);

const triageCmd = registerTriageCommand(program);

triageCmd.action(async (options: Record<string, unknown>) => {
  const fileConfig = loadConfigFile();
  const config = parseCliInputs(options, fileConfig);

  // Validate
  const errors = validateInputs(config);
  if (errors.length > 0) {
    console.error(formatValidationErrors(errors));
    console.error(c.subtle("\n  Run sweny triage --help for usage information.\n"));
    process.exit(1);
  }

  // Non-fatal warnings (e.g. missing service map file)
  for (const warning of validateWarnings(config)) {
    console.warn(chalk.yellow(`  ⚠  ${warning}`));
  }

  // ── Shared logger ─────────────────────────────────────────
  // Created early so providers can capture the same object.
  // Methods are upgraded to spinner-aware after spinner setup below.
  const logger = {
    info: config.json ? () => {} : (...args: unknown[]) => console.log(...args),
    debug: config.json ? () => {} : (...args: unknown[]) => console.debug(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  };

  // Create providers (they capture `logger` by reference — method upgrades propagate)
  const providers = createProviders(config, logger);
  const triageConfig = mapToTriageConfig(config);

  // ── Step cache ──────────────────────────────────────────
  let stepCache: StepCache | undefined;
  if (!config.noCache && config.cacheDir) {
    const configHash = hashConfig(triageConfig, config);
    const cacheDir = `${config.cacheDir}/${configHash}`;
    const ttlMs = config.cacheTtl > 0 ? config.cacheTtl * 1000 : Number.MAX_SAFE_INTEGER;
    stepCache = createFsCache(cacheDir, ttlMs);
  }

  // Banner
  if (!config.json) {
    console.log(formatBanner(config, version));
  }

  // ── Spinner state ──────────────────────────────────────────
  const FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  const isTTY = !config.json && (process.stderr.isTTY ?? false);
  let spinnerInterval: ReturnType<typeof setInterval> | undefined;
  let spinnerActive = false;
  let frameIdx = 0;
  let stepStart = 0;
  let stepLabel = "";
  let spinnerStatus = "";
  let currentPhaseColor: (s: string) => string = chalk.cyan;
  let lastPhase: string | null = null;
  let stepIndex = 0;
  const totalSteps = Object.keys(triageWorkflow.definition.steps).length;

  function formatElapsed(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  function clearSpinnerLine() {
    if (spinnerActive && isTTY) {
      process.stderr.write("\r\x1b[K");
    }
  }

  function startSpinner(label: string) {
    stepStart = Date.now();
    stepLabel = label;
    spinnerStatus = "";
    frameIdx = 0;
    spinnerActive = true;

    if (isTTY) {
      const cols = process.stderr.columns || 80;
      spinnerInterval = setInterval(() => {
        const frame = currentPhaseColor(FRAMES[frameIdx++ % FRAMES.length]);
        const counter = c.subtle(`[${stepIndex}/${totalSteps}]`);
        const elapsed = c.subtle(formatElapsed(Date.now() - stepStart));
        const status = spinnerStatus ? ` ${c.subtle("\u2014")} ${c.subtle(spinnerStatus)}` : "";
        // Truncate to terminal width to prevent line wrapping
        let line = `  ${frame} ${counter} ${stepLabel}${status} ${elapsed}`;
        const visibleLen = line.replace(/\x1B\[[0-9;]*m/g, "").length;
        if (visibleLen > cols) {
          // Re-render without status if too wide
          line = `  ${frame} ${counter} ${stepLabel} ${elapsed}`;
        }
        process.stderr.write(`\r\x1b[K${line}`);
      }, 80);
    } else if (!config.json) {
      spinnerInterval = setInterval(() => {
        const elapsed = formatElapsed(Date.now() - stepStart);
        process.stderr.write(`  > [${stepIndex}/${totalSteps}] ${stepLabel} ${elapsed}\n`);
      }, 15_000);
    }
  }

  function stopSpinner() {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = undefined;
    }
    if (isTTY) {
      process.stderr.write("\r\x1b[K");
    }
    spinnerActive = false;
  }

  // ── Upgrade logger to spinner-aware ──────────────────────
  // info/debug fold into spinner status text; warn/error always print.
  if (!config.json) {
    logger.info = (...args: unknown[]) => {
      const msg = args.map(String).join(" ");
      // Skip engine runner status messages (already shown by phase headers & step lines)
      if (msg.startsWith("[triage]")) return;
      if (spinnerActive && isTTY) {
        spinnerStatus = msg;
      } else {
        clearSpinnerLine();
        console.log(...args);
      }
    };
    logger.debug = (...args: unknown[]) => {
      const msg = args.map(String).join(" ");
      if (msg.startsWith("[triage]")) return;
      if (spinnerActive && isTTY) {
        spinnerStatus = msg;
      } else {
        clearSpinnerLine();
        console.debug(...args);
      }
    };
  }
  logger.warn = (...args: unknown[]) => {
    clearSpinnerLine();
    console.warn(...args);
  };
  logger.error = (...args: unknown[]) => {
    clearSpinnerLine();
    console.error(...args);
  };

  try {
    const result = await runWorkflow(triageWorkflow, triageConfig, providers, {
      logger,
      cache: stepCache,
      beforeStep: async (step) => {
        if (config.json) return;

        stepIndex++;

        // Phase transition header
        if (step.phase !== lastPhase) {
          lastPhase = step.phase;
          currentPhaseColor = phaseColor(step.phase);
          console.log(formatPhaseHeader(step.phase as WorkflowPhase));
        }

        startSpinner(step.id);
      },
      afterStep: async (step, stepResult) => {
        if (config.json) return;

        stopSpinner();

        const isCached = stepResult.cached === true;
        const elapsed = isCached ? "cached" : formatElapsed(Date.now() - stepStart);
        const icon = isCached
          ? c.subtle("\u21BB")
          : stepResult.status === "success"
            ? c.ok("\u2713")
            : stepResult.status === "skipped"
              ? c.subtle("\u2212")
              : c.fail("\u2717");
        const reason = !isCached && stepResult.status !== "success" ? stepResult.reason : undefined;

        const counter = `[${stepIndex}/${totalSteps}]`;
        console.log(formatStepLine(icon, counter, step.id, elapsed, reason));

        // Inline data details
        const details = getStepDetails(step.id, stepResult.data as Record<string, unknown>);
        for (const detail of details) {
          console.log(`    ${c.subtle("\u21B3")} ${c.subtle(detail)}`);
        }
      },
    });

    // Output
    if (config.json) {
      console.log(formatResultJson(result));
    } else {
      console.log(formatResultHuman(result, config));
    }

    // Terminal bell
    if (config.bell) process.stderr.write("\x07");

    process.exit(result.status === "failed" ? 1 : 0);
  } catch (error) {
    if (config.json) {
      console.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
    } else {
      console.error(formatCrashError(error));
    }

    // Terminal bell even on crash
    if (config.bell) process.stderr.write("\x07");

    process.exit(1);
  }
});

// ── sweny implement ───────────────────────────────────────────────────
const implementCmd = registerImplementCommand(program);

implementCmd.action(async (issueId: string, options: Record<string, unknown>) => {
  const fileConfig = loadConfigFile();
  // Build a minimal CliConfig for the implement command by merging CLI opts with env/file
  const config: CliConfig = {
    ...parseCliInputs(options, fileConfig),
    // Override specific fields that differ for implement
    issueTrackerProvider: (options.issueTrackerProvider as string) || fileConfig["issue-tracker-provider"] || "linear",
    sourceControlProvider:
      (options.sourceControlProvider as string) || fileConfig["source-control-provider"] || "github",
    codingAgentProvider: (options.codingAgentProvider as string) || fileConfig["coding-agent-provider"] || "claude",
    dryRun: Boolean(options.dryRun),
    maxImplementTurns: parseInt(String(options.maxImplementTurns || fileConfig["max-implement-turns"] || "40"), 10),
    baseBranch: (options.baseBranch as string) || fileConfig["base-branch"] || "main",
    repository: (options.repository as string) || process.env.GITHUB_REPOSITORY || "",
    outputDir:
      (options.outputDir as string) || process.env.SWENY_OUTPUT_DIR || fileConfig["output-dir"] || ".sweny/output",
  };

  const logger = {
    info: (...args: unknown[]) => console.log(...args),
    debug: () => {},
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  };

  const providers = createImplementProviders(config, logger);
  const implementConfig = mapToImplementConfig(issueId, config);

  console.log(chalk.cyan(`\n  sweny implement ${issueId}\n`));

  try {
    const result = await runWorkflow(implementWorkflow, implementConfig, providers, { logger });
    if (result.status === "failed") {
      console.error(chalk.red(`\n  Implement workflow failed\n`));
      process.exit(1);
    }
    const prStep = result.steps.find((s) => s.name === "create-pr");
    const prUrl = prStep?.result.data?.prUrl as string | undefined;
    if (prUrl) {
      console.log(chalk.green(`\n  PR created: ${prUrl}\n`));
    } else {
      console.log(chalk.green(`\n  Implement workflow completed (${result.status})\n`));
    }
    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
});

/**
 * Auto-inject well-known MCP servers for providers the user already configured.
 *
 * Design rules:
 * - HTTP transport preferred for cloud-hosted services (no local install, vendor-managed).
 * - stdio (npx) used when no stable HTTP endpoint exists; the agent handles process spawning.
 * - Category A: injected from structured provider config (sourceControlProvider, etc.)
 * - Category B: injected when specific env vars are present — zero new config required.
 * - User-supplied mcpServers always win on key conflict (explicit > auto).
 */
function buildAutoMcpServers(config: CliConfig): Record<string, MCPServerConfig> | undefined {
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
  // Note: @sentry/mcp-server reads SENTRY_ACCESS_TOKEN (not SENTRY_AUTH_TOKEN).
  if (config.observabilityProvider === "sentry" && obsCreds.authToken) {
    const sentryEnv: Record<string, string> = { SENTRY_ACCESS_TOKEN: obsCreds.authToken };
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

  // New Relic MCP — HTTP transport; region-aware endpoint.
  // Header key is `Api-Key` (not `Authorization`), unique to New Relic's MCP.
  // Trailing slash is intentional — New Relic's MCP spec requires it.
  const nrApiKey = obsCreds.apiKey;
  if (config.observabilityProvider === "newrelic" && nrApiKey) {
    const nrEndpoint = obsCreds.region === "eu" ? "https://mcp.eu.newrelic.com/mcp/" : "https://mcp.newrelic.com/mcp/";
    auto["newrelic"] = {
      type: "http",
      url: nrEndpoint,
      headers: { "Api-Key": nrApiKey },
    };
  }

  // Better Stack MCP — HTTP remote MCP; supports Bearer token auth (no OAuth required).
  // Exposes ClickHouse SQL query tools for logs, metrics, spans, and error tracking.
  if (config.observabilityProvider === "betterstack" && obsCreds.apiToken) {
    auto["betterstack"] = {
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: `Bearer ${obsCreds.apiToken}` },
    };
  }

  // ── Category B: Workspace tools (explicit opt-in via workspaceTools config) ─
  // Both the tool name must appear in workspaceTools AND the credential env var must be set.

  const tools = new Set(config.workspaceTools);

  // Slack MCP — requires workspace-tools includes "slack" AND SLACK_BOT_TOKEN is set.
  if (tools.has("slack")) {
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
  }

  // Notion MCP — requires workspace-tools includes "notion" AND NOTION_TOKEN is set.
  if (tools.has("notion")) {
    const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
    if (notionToken) {
      auto["notion"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server@latest"],
        env: { NOTION_TOKEN: notionToken },
      };
    }
  }

  // PagerDuty MCP — requires workspace-tools includes "pagerduty" AND PAGERDUTY_API_TOKEN is set.
  if (tools.has("pagerduty")) {
    const pagerdutyToken = process.env.PAGERDUTY_API_TOKEN;
    if (pagerdutyToken) {
      auto["pagerduty"] = {
        type: "http",
        url: "https://mcp.pagerduty.com/mcp",
        headers: { Authorization: `Token token=${pagerdutyToken}` },
      };
    }
  }

  // Monday.com MCP — requires workspace-tools includes "monday" AND MONDAY_TOKEN is set.
  if (tools.has("monday")) {
    const mondayToken = process.env.MONDAY_TOKEN;
    if (mondayToken) {
      auto["monday"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
        env: { MONDAY_TOKEN: mondayToken },
      };
    }
  }

  const merged = { ...auto, ...config.mcpServers };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mapToImplementConfig(issueId: string, config: CliConfig): ImplementConfig {
  const agentEnv: Record<string, string> = {};
  if (config.anthropicApiKey) agentEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken) agentEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;
  if (config.openaiApiKey) agentEnv.OPENAI_API_KEY = config.openaiApiKey;
  if (config.geminiApiKey) agentEnv.GEMINI_API_KEY = config.geminiApiKey;
  if (config.githubToken) agentEnv.GITHUB_TOKEN = config.githubToken;
  if (config.linearApiKey) agentEnv.LINEAR_API_KEY = config.linearApiKey;
  if (config.linearTeamId) agentEnv.LINEAR_TEAM_ID = config.linearTeamId;
  if (config.jiraBaseUrl) agentEnv.JIRA_BASE_URL = config.jiraBaseUrl;
  if (config.jiraEmail) agentEnv.JIRA_EMAIL = config.jiraEmail;
  if (config.jiraApiToken) agentEnv.JIRA_API_TOKEN = config.jiraApiToken;
  if (config.gitlabToken) agentEnv.GITLAB_TOKEN = config.gitlabToken;

  return {
    issueIdentifier: issueId,
    repository: config.repository,
    dryRun: config.dryRun,
    maxImplementTurns: config.maxImplementTurns,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    projectId: config.linearTeamId || (config.issueTrackerProvider === "file" ? "local" : ""),
    stateInProgress: config.linearStateInProgress || (config.issueTrackerProvider === "file" ? "in-progress" : ""),
    statePeerReview: config.linearStatePeerReview || (config.issueTrackerProvider === "file" ? "peer-review" : ""),
    issueTrackerName: config.issueTrackerProvider,
    reviewMode: config.reviewMode,
    agentEnv,
    mcpServers: buildAutoMcpServers(config),
  };
}

export function mapToTriageConfig(config: CliConfig): TriageConfig {
  // Build agent env vars for coding agent auth
  const agentEnv: Record<string, string> = {};
  if (config.anthropicApiKey) agentEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken) agentEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;
  if (config.openaiApiKey) agentEnv.OPENAI_API_KEY = config.openaiApiKey;
  if (config.geminiApiKey) agentEnv.GEMINI_API_KEY = config.geminiApiKey;

  // Issue tracker env vars
  if (config.linearApiKey) agentEnv.LINEAR_API_KEY = config.linearApiKey;
  if (config.linearTeamId) agentEnv.LINEAR_TEAM_ID = config.linearTeamId;
  if (config.linearBugLabelId) agentEnv.LINEAR_BUG_LABEL_ID = config.linearBugLabelId;

  // Observability env vars
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
    case "betterstack":
      if (obsCreds.apiToken) agentEnv.BETTERSTACK_API_TOKEN = obsCreds.apiToken;
      if (obsCreds.sourceId) agentEnv.BETTERSTACK_SOURCE_ID = obsCreds.sourceId;
      if (obsCreds.tableName) agentEnv.BETTERSTACK_TABLE_NAME = obsCreds.tableName;
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

    projectId: config.linearTeamId || (config.issueTrackerProvider === "file" ? "local" : ""),
    bugLabelId: config.linearBugLabelId || (config.issueTrackerProvider === "file" ? "bug" : ""),
    triageLabelId: config.linearTriageLabelId || (config.issueTrackerProvider === "file" ? "triage" : ""),
    issueLabels: config.issueLabels.length > 0 ? config.issueLabels : undefined,
    stateBacklog: config.linearStateBacklog || (config.issueTrackerProvider === "file" ? "open" : ""),
    stateInProgress: config.linearStateInProgress || (config.issueTrackerProvider === "file" ? "in-progress" : ""),
    statePeerReview: config.linearStatePeerReview || (config.issueTrackerProvider === "file" ? "peer-review" : ""),

    repository: config.repository,

    baseBranch: config.baseBranch,
    prLabels: config.prLabels,

    dryRun: config.dryRun,
    reviewMode: config.reviewMode,
    noveltyMode: config.noveltyMode,
    issueOverride: config.issueOverride,
    additionalInstructions: config.additionalInstructions,
    issueTrackerName: config.issueTrackerProvider,

    agentEnv,
    mcpServers: buildAutoMcpServers(config),
  };
}

// ── sweny workflow ─────────────────────────────────────────────────────
const workflowCmd = program.command("workflow").description("Manage and run workflow files");

/** Reads and parses a workflow file (YAML or JSON). Throws on I/O or parse error. */
function parseWorkflowFileContent(filePath: string): unknown {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".yaml" || ext === ".yml" ? parseYaml(content) : JSON.parse(content);
}

export function loadWorkflowFile(filePath: string): WorkflowDefinition {
  const raw = parseWorkflowFileContent(filePath);
  const errors = validateWorkflow(raw as WorkflowDefinition);
  if (errors.length > 0) {
    throw new Error(`Invalid workflow file:\n${errors.map((e) => `  ${e.message}`).join("\n")}`);
  }
  return raw as WorkflowDefinition;
}

export async function workflowRunAction(
  file: string,
  options: Record<string, unknown> & { steps?: string; json?: boolean },
): Promise<void> {
  if (options.steps) {
    const stepsPath = path.resolve(options.steps);
    try {
      await import(stepsPath);
    } catch (err) {
      console.error(chalk.red(`  Failed to load steps module: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
      return;
    }
  }

  let definition: WorkflowDefinition;
  try {
    definition = loadWorkflowFile(file);
  } catch (err) {
    console.error(chalk.red(`  Error loading workflow file: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
    return;
  }

  if (options.dryRun) {
    console.log(
      chalk.green(`  Workflow "${definition.name}" is valid (${Object.keys(definition.steps).length} steps)`),
    );
    for (const [id, step] of Object.entries(definition.steps)) {
      console.log(chalk.dim(`    ${id}: phase=${step.phase}${step.type ? ` type=${step.type}` : ""}`));
    }
    process.exit(0);
  }

  let workflow;
  try {
    workflow = resolveWorkflow(definition);
  } catch (err) {
    console.error(chalk.red(`  Error resolving workflow: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
    return;
  }

  const fileConfig = loadConfigFile();
  const config = parseCliInputs(options, fileConfig);
  const isJson = Boolean(options.json);
  const isTTY = !isJson && (process.stderr.isTTY ?? false);

  const logger = {
    info: isJson ? () => {} : (...args: unknown[]) => console.log(...args),
    debug: () => {},
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  };

  const providers = createProviders(config, logger);

  // Track per-step entry time to compute elapsed on exit
  const stepEnterTimes = new Map<string, number>();

  const observer: RunObserver | undefined = isJson
    ? undefined
    : {
        onEvent(event) {
          switch (event.type) {
            case "workflow:start":
              process.stderr.write(`\n  ▲ ${chalk.bold(event.workflowName)}\n\n`);
              break;
            case "step:enter":
              stepEnterTimes.set(event.stepId, Date.now());
              process.stderr.write(`  ${c.subtle("○")} ${chalk.dim(event.stepId)}…\n`);
              break;
            case "step:exit": {
              const icon =
                event.result.status === "success"
                  ? c.ok("✓")
                  : event.result.status === "skipped"
                    ? c.subtle("−")
                    : c.fail("✗");
              const cached = event.cached ? chalk.dim(" [cached]") : "";
              const enterTime = stepEnterTimes.get(event.stepId) ?? event.timestamp;
              const elapsedMs = Date.now() - enterTime;
              const elapsed = chalk.dim(elapsedMs < 1000 ? `${elapsedMs}ms` : `${Math.round(elapsedMs / 100) / 10}s`);
              if (isTTY) {
                // Overwrite the pending "○ stepId…" line with the final status
                process.stderr.write(`\x1B[1A\x1B[2K  ${icon} ${event.stepId}${cached}  ${elapsed}\n`);
              } else {
                process.stderr.write(`  ${icon} ${event.stepId}${cached}  ${elapsed}\n`);
              }
              break;
            }
            case "workflow:end":
              process.stderr.write(`\n`);
              break;
          }
        },
      };

  try {
    const result = await runWorkflow(workflow, mapToTriageConfig(config), providers, { logger, observer });

    if (isJson) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(result.status === "failed" ? 1 : 0);
      return;
    }

    if (result.status === "failed") {
      console.error(chalk.red(`  Workflow failed\n`));
      process.exit(1);
      return;
    }
    console.log(chalk.green(`  Workflow completed (${result.status})\n`));
    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}

export function workflowExportAction(name: string): void {
  let definition: WorkflowDefinition;
  if (name === "triage") {
    definition = triageDefinition;
  } else if (name === "implement") {
    definition = implementDefinition;
  } else {
    console.error(chalk.red(`  Unknown workflow "${name}". Available: triage, implement`));
    process.exit(1);
    return;
  }
  process.stdout.write(WORKFLOW_YAML_SCHEMA_HEADER + stringifyYaml(definition, { indent: 2, lineWidth: 120 }));
}

export function workflowValidateAction(file: string, options: { json?: boolean }): void {
  let raw: unknown;
  try {
    raw = parseWorkflowFileContent(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      process.stderr.write(JSON.stringify({ valid: false, errors: [{ message }] }, null, 2) + "\n");
    } else {
      console.error(chalk.red(`  Cannot read "${file}": ${message}`));
    }
    process.exit(1);
    return;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    const kind = raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw;
    const message = `Expected a YAML/JSON object, got ${kind}`;
    if (options.json) {
      process.stderr.write(JSON.stringify({ valid: false, errors: [{ message }] }, null, 2) + "\n");
    } else {
      console.error(chalk.red(`  ✗ ${file}: ${message}`));
    }
    process.exit(1);
    return;
  }

  const errors = validateWorkflow(raw as WorkflowDefinition);

  if (options.json) {
    process.stdout.write(JSON.stringify({ valid: errors.length === 0, errors }, null, 2) + "\n");
  } else if (errors.length === 0) {
    console.log(chalk.green(`  ✓ ${file} is valid`));
  } else {
    console.error(chalk.red(`  ✗ ${file} has ${errors.length} validation error${errors.length > 1 ? "s" : ""}:`));
    for (const err of errors) {
      console.error(chalk.dim(`    ${err.message}`));
    }
  }

  process.exit(errors.length === 0 ? 0 : 1);
}

workflowCmd
  .command("validate <file>")
  .description("Validate a workflow YAML or JSON file")
  .option("--json", "Output result as JSON")
  .action(workflowValidateAction);

workflowCmd
  .command("run <file>")
  .description("Run a workflow from a YAML or JSON file")
  .option("--dry-run", "Validate workflow without running")
  .option("--steps <path>", "Path to a module that registers custom step types")
  .option("--json", "Output result as JSON on stdout; suppress progress output")
  .action(workflowRunAction);

workflowCmd
  .command("export <name>")
  .description("Print a built-in workflow as YAML (triage or implement)")
  .action(workflowExportAction);

export function workflowListAction(options: { json?: boolean }): void {
  const types = listStepTypes();

  if (options.json) {
    process.stdout.write(JSON.stringify(types, null, 2) + "\n");
    return;
  }

  console.log(chalk.bold("\nBuilt-in step types:\n"));
  for (const { type, description } of types) {
    console.log(`  ${chalk.cyan(type)}`);
    console.log(chalk.dim(`    ${description}`));
  }
  console.log();
}

workflowCmd
  .command("list")
  .description("List all registered built-in step types")
  .option("--json", "Output as JSON array")
  .action(workflowListAction);

program.parse();
