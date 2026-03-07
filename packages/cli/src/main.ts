#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { runWorkflow, triageWorkflow } from "@sweny-ai/engine";
import type { StepCache, TriageConfig, WorkflowPhase } from "@sweny-ai/engine";
import { createFsCache, hashConfig } from "./cache.js";
import { loadDotenv, loadConfigFile, STARTER_CONFIG } from "./config-file.js";
import { registerTriageCommand, parseCliInputs, validateInputs } from "./config.js";
import type { CliConfig } from "./config.js";
import { createProviders } from "./providers/index.js";
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
} from "./output.js";

// Auto-load .env before Commander parses (so env vars are available for defaults)
loadDotenv();

const program = new Command()
  .name("sweny")
  .description("SWEny CLI \u2014 autonomous engineering workflows")
  .version("0.2.0");

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
    console.log(formatBanner(config, program.version() ?? "0.2.0"));
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
  const totalSteps = triageWorkflow.steps.length;

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

        startSpinner(step.name);
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
        console.log(formatStepLine(icon, counter, step.name, elapsed, reason));

        // Inline data details
        const details = getStepDetails(step.name, stepResult.data as Record<string, unknown>);
        for (const detail of details) {
          console.log(`    ${c.subtle("\u21B3")} ${c.subtle(detail)}`);
        }
      },
    });

    // Output
    if (config.json) {
      console.log(formatResultJson(result));
    } else {
      console.log(formatResultHuman(result));
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

function mapToTriageConfig(config: CliConfig): TriageConfig {
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
    stateBacklog: config.linearStateBacklog || (config.issueTrackerProvider === "file" ? "open" : ""),
    stateInProgress: config.linearStateInProgress || (config.issueTrackerProvider === "file" ? "in-progress" : ""),
    statePeerReview: config.linearStatePeerReview || (config.issueTrackerProvider === "file" ? "peer-review" : ""),

    repository: config.repository,

    baseBranch: config.baseBranch,
    prLabels: config.prLabels,

    dryRun: config.dryRun,
    noveltyMode: config.noveltyMode,
    issueOverride: config.issueOverride,
    additionalInstructions: config.additionalInstructions,

    agentEnv,
  };
}

program.parse();
