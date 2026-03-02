#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { runWorkflow, triageWorkflow } from "@swenyai/engine";
import type { TriageConfig } from "@swenyai/engine";
import { registerTriageCommand, parseCliInputs, validateInputs } from "./config.js";
import type { CliConfig } from "./config.js";
import { createProviders } from "./providers/index.js";
import { formatResultHuman, formatResultJson } from "./output.js";

const program = new Command()
  .name("sweny")
  .description("SWEny CLI \u2014 autonomous engineering workflows")
  .version("0.2.0");

const triageCmd = registerTriageCommand(program);

triageCmd.action(async (options: Record<string, unknown>) => {
  const config = parseCliInputs(options);

  // Validate
  const errors = validateInputs(config);
  if (errors.length > 0) {
    console.error(chalk.red("\nConfiguration errors:\n"));
    for (const err of errors) {
      console.error(chalk.red(`  \u2022 ${err}`));
    }
    console.error("");
    process.exit(1);
  }

  // Create providers
  const providers = createProviders(config);
  const triageConfig = mapToTriageConfig(config);

  // Banner
  if (!config.json) {
    console.log("");
    console.log(chalk.bold("SWEny Triage"));
    console.log("\u2500".repeat(40));
    console.log(`  Repository:    ${config.repository}`);
    console.log(`  Coding agent:  ${config.codingAgentProvider}`);
    console.log(`  Observability: ${config.observabilityProvider}`);
    console.log(`  Time range:    ${config.timeRange}`);
    console.log(`  Issue tracker: ${config.issueTrackerProvider}`);
    console.log(`  Dry run:       ${config.dryRun}`);
    console.log("\u2500".repeat(40));
    console.log("");
  }

  // ── Spinner state ──────────────────────────────────────────────
  const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const isTTY = !config.json && (process.stderr.isTTY ?? false);
  let spinnerInterval: ReturnType<typeof setInterval> | undefined;
  let spinnerActive = false;
  let frameIdx = 0;
  let stepStart = 0;
  let stepLabel = "";

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
    frameIdx = 0;
    spinnerActive = true;

    if (isTTY) {
      spinnerInterval = setInterval(() => {
        const frame = chalk.cyan(FRAMES[frameIdx++ % FRAMES.length]);
        const elapsed = chalk.dim(formatElapsed(Date.now() - stepStart));
        process.stderr.write(`\r\x1b[K  ${frame} ${stepLabel} ${elapsed}`);
      }, 80);
    } else if (!config.json) {
      // Non-TTY fallback: periodic heartbeat lines
      spinnerInterval = setInterval(() => {
        const elapsed = formatElapsed(Date.now() - stepStart);
        process.stderr.write(`  ↳ ${stepLabel} ${elapsed}\n`);
      }, 15_000);
    }
  }

  function stopSpinner(icon: string, suffix: string) {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = undefined;
    }
    const elapsed = chalk.dim(formatElapsed(Date.now() - stepStart));
    if (isTTY) {
      process.stderr.write(`\r\x1b[K  ${icon} ${elapsed}${suffix}\n`);
    } else if (!config.json) {
      console.log(`  ${icon} ${elapsed}${suffix}`);
    }
    spinnerActive = false;
  }

  // Spinner-aware logger: clears the spinner line before printing
  // so log output doesn't collide with the animated spinner.
  // The next spinner tick redraws cleanly below the new output.
  const logger = {
    info: config.json
      ? () => {}
      : (...args: unknown[]) => {
          clearSpinnerLine();
          console.log(...args);
        },
    debug: config.json
      ? () => {}
      : (...args: unknown[]) => {
          clearSpinnerLine();
          console.debug(...args);
        },
    warn: (...args: unknown[]) => {
      clearSpinnerLine();
      console.warn(...args);
    },
    error: (...args: unknown[]) => {
      clearSpinnerLine();
      console.error(...args);
    },
  };

  try {
    const result = await runWorkflow(triageWorkflow, triageConfig, providers, {
      logger,
      beforeStep: async (step) => {
        if (!config.json) {
          console.log(chalk.dim(`\n[${step.phase}]`) + " " + chalk.bold(step.name));
          startSpinner(step.name);
        }
      },
      afterStep: async (_step, stepResult) => {
        if (!config.json) {
          const icon =
            stepResult.status === "success"
              ? chalk.green("✓")
              : stepResult.status === "skipped"
                ? chalk.dim("−")
                : chalk.red("✗");
          const reason = stepResult.reason ? chalk.dim(` — ${stepResult.reason}`) : "";
          stopSpinner(icon, reason);
        }
      },
    });

    // Output
    if (config.json) {
      console.log(formatResultJson(result));
    } else {
      console.log(formatResultHuman(result));
    }

    process.exit(result.status === "failed" ? 1 : 0);
  } catch (error) {
    if (config.json) {
      console.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
    } else {
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : "Unknown error"}\n`));
    }
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
    issueOverride: config.issueOverride,
    additionalInstructions: config.additionalInstructions,

    agentEnv,
  };
}

program.parse();
