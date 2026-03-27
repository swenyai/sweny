#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";

const _require = createRequire(import.meta.url);
const { version } = _require("../../package.json") as { version: string };
import chalk from "chalk";

import { execute } from "../executor.js";
import type { ExecuteOptions } from "../executor.js";
import { triageWorkflow } from "../workflows/triage.js";
import { implementWorkflow } from "../workflows/implement.js";
import type { ExecutionEvent, NodeResult, Workflow, McpServerConfig, Observer } from "../types.js";
import { consoleLogger } from "../types.js";
import { ClaudeClient } from "../claude.js";
import { createSkillMap, configuredSkills } from "../skills/index.js";
import { buildAutoMcpServers, buildProviderContext } from "../mcp.js";
import type { McpAutoConfig } from "../types.js";
import { validateWorkflow as validateWorkflowSchema } from "../schema.js";
import { parseWorkflow } from "../schema.js";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { DagRenderer } from "./renderer.js";
import * as readline from "node:readline";

import { loadDotenv, loadConfigFile, STARTER_CONFIG } from "./config-file.js";
import {
  registerTriageCommand,
  registerImplementCommand,
  parseCliInputs,
  validateInputs,
  validateWarnings,
} from "./config.js";
import type { CliConfig } from "./config.js";
import {
  c,
  phaseColor,
  formatBanner,
  formatPhaseHeader,
  getStepDetails,
  formatStepLine,
  formatDagResultHuman,
  formatResultJson,
  formatValidationErrors,
  formatCrashError,
  formatCheckResults,
} from "./output.js";
import { checkProviderConnectivity } from "./check.js";
import { registerSetupCommand } from "./setup.js";

// ── Stream observer (NDJSON) ────────────────────────────────────────
/**
 * Create an observer that writes NDJSON ExecutionEvents to stdout.
 * Studio and other consumers parse these line-by-line.
 */
function createStreamObserver(): Observer {
  return (event: ExecutionEvent) => {
    process.stdout.write(JSON.stringify(event) + "\n");
  };
}

/** Compose multiple observers into one. */
function composeObservers(...observers: (Observer | undefined)[]): Observer | undefined {
  const valid = observers.filter((o): o is Observer => o != null);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return (event: ExecutionEvent) => {
    for (const o of valid) o(event);
  };
}

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

// ── Credential map builder ──────────────────────────────────────────
/**
 * Read env vars into the flat credential map expected by buildAutoMcpServers.
 */
function buildCredentialMap(): Record<string, string> {
  const creds: Record<string, string> = {};
  const env = process.env;
  const keys = [
    "GITHUB_TOKEN",
    "GITLAB_TOKEN",
    "GITLAB_URL",
    "LINEAR_API_KEY",
    "JIRA_URL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "DD_API_KEY",
    "DD_APP_KEY",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_URL",
    "NR_API_KEY",
    "NR_REGION",
    "BETTERSTACK_API_TOKEN",
    "BETTERSTACK_SOURCE_ID",
    "BETTERSTACK_TABLE_NAME",
    "SLACK_BOT_TOKEN",
    "SLACK_TEAM_ID",
    "NOTION_TOKEN",
    "PAGERDUTY_API_TOKEN",
    "MONDAY_TOKEN",
    "ASANA_ACCESS_TOKEN",
  ];
  for (const k of keys) {
    if (env[k]) creds[k] = env[k]!;
  }
  return creds;
}

/**
 * Build the McpAutoConfig from CLI config for buildAutoMcpServers.
 */
function buildMcpAutoConfig(config: CliConfig): McpAutoConfig {
  return {
    sourceControlProvider: config.sourceControlProvider,
    issueTrackerProvider: config.issueTrackerProvider,
    observabilityProvider: config.observabilityProvider,
    credentials: buildCredentialMap(),
    workspaceTools: config.workspaceTools,
    userMcpServers: Object.keys(config.mcpServers).length > 0 ? config.mcpServers : undefined,
  };
}

/**
 * Combine provider context + user instructions into a single additionalContext string.
 */
function buildAdditionalContext(config: CliConfig, mcpServers: Record<string, unknown>): string {
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

  const parts = [providerCtx];
  if (config.additionalInstructions) {
    parts.push(config.additionalInstructions);
  }
  return parts.join("\n\n");
}

// ── sweny triage ──────────────────────────────────────────────────────
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
    console.warn(chalk.yellow(`  \u26A0  ${warning}`));
  }

  // Banner
  if (!config.json) {
    console.log(formatBanner(config, version));
  }

  // ── Build skill map + MCP servers + Claude client ──────────
  const skills = createSkillMap(configuredSkills());
  const mcpAutoConfig = buildMcpAutoConfig(config);
  const mcpServers = buildAutoMcpServers(mcpAutoConfig);
  const claude = new ClaudeClient({
    maxTurns: config.maxInvestigateTurns || 50,
    cwd: process.cwd(),
    logger: consoleLogger,
    mcpServers,
  });

  // ── Progress display state ─────────────────────────────────
  const FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  const isTTY = !config.json && (process.stderr.isTTY ?? false);
  const MAX_ACTIVITY = 3;
  let spinnerInterval: ReturnType<typeof setInterval> | undefined;
  let spinnerActive = false;
  let frameIdx = 0;
  let stepStart = 0;
  let stepLabel = "";
  let recentActivity: string[] = [];
  let renderedLines = 0; // how many lines the progress block currently occupies
  let stepIndex = 0;
  const totalNodes = Object.keys(triageWorkflow.nodes).length;

  function formatElapsed(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  /** Render the multi-line progress block (spinner + activity lines). */
  function renderProgressBlock() {
    const cols = process.stderr.columns || 80;
    const frame = chalk.cyan(FRAMES[frameIdx++ % FRAMES.length]);
    const counter = c.subtle(`[${stepIndex}/${totalNodes}]`);
    const elapsed = c.subtle(formatElapsed(Date.now() - stepStart));
    const headerLine = `  ${frame} ${counter} ${stepLabel}  ${elapsed}`;

    const lines = [headerLine];
    for (const msg of recentActivity) {
      // Truncate to terminal width
      const line = `    ${c.subtle("\u21B3")} ${c.subtle(msg)}`;
      const vis = line.replace(/\x1B\[[0-9;]*m/g, "").length;
      lines.push(vis > cols ? line.slice(0, cols - 1) : line);
    }

    // Move cursor up to clear previous render, then clear to end of screen
    if (renderedLines > 0) {
      process.stderr.write(`\x1B[${renderedLines}A\x1B[J`);
    }
    process.stderr.write(lines.join("\n") + "\n");
    renderedLines = lines.length;
  }

  function startSpinner(label: string) {
    stepStart = Date.now();
    stepLabel = label;
    recentActivity = [];
    frameIdx = 0;
    spinnerActive = true;
    renderedLines = 0;

    if (isTTY) {
      process.stderr.write("\x1B[?25l"); // hide cursor
      renderProgressBlock();
      spinnerInterval = setInterval(() => renderProgressBlock(), 100);
    } else if (!config.json) {
      spinnerInterval = setInterval(() => {
        const elapsed = formatElapsed(Date.now() - stepStart);
        process.stderr.write(`  > [${stepIndex}/${totalNodes}] ${stepLabel} ${elapsed}\n`);
      }, 15_000);
    }
  }

  function stopSpinner() {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = undefined;
    }
    if (isTTY && renderedLines > 0) {
      process.stderr.write(`\x1B[${renderedLines}A\x1B[J`);
      process.stderr.write("\x1B[?25h"); // show cursor
      renderedLines = 0;
    }
    spinnerActive = false;
  }

  // ── Build observer for DAG events ──────────────────────────
  const runStart = Date.now();

  const progressObserver: Observer | undefined = config.json
    ? undefined
    : (event: ExecutionEvent) => {
        switch (event.type) {
          case "workflow:start":
            break;
          case "node:enter":
            stepIndex++;
            startSpinner(event.node);
            break;
          case "node:progress":
            if (spinnerActive) {
              recentActivity.push(event.message);
              if (recentActivity.length > MAX_ACTIVITY) recentActivity.shift();
            }
            break;
          case "tool:call":
            // tool:call is now superseded by the richer node:progress events
            break;
          case "node:exit": {
            stopSpinner();
            const elapsed = formatElapsed(Date.now() - stepStart);
            const icon =
              event.result.status === "success"
                ? c.ok("\u2713")
                : event.result.status === "skipped"
                  ? c.subtle("\u2212")
                  : c.fail("\u2717");
            const reason = event.result.status !== "success" ? (event.result.data?.error as string) : undefined;
            const counter = `[${stepIndex}/${totalNodes}]`;
            console.log(formatStepLine(icon, counter, event.node, elapsed, reason));

            const details = getStepDetails(event.node, event.result.data);
            for (const detail of details) {
              console.log(`    ${c.subtle("\u21B3")} ${c.subtle(detail)}`);
            }
            break;
          }
          case "route":
            break;
          case "workflow:end":
            break;
        }
      };

  const observer = composeObservers(progressObserver, config.stream ? createStreamObserver() : undefined);

  // ── Build workflow input from config ──────────────────────
  // TODO: The triage workflow input structure may need further refinement
  // once the workflow nodes have stabilized. For now, pass config fields
  // that the workflow instructions can reference via the `input` context.
  const workflowInput = {
    timeRange: config.timeRange,
    severityFocus: config.severityFocus,
    serviceFilter: config.serviceFilter,
    investigationDepth: config.investigationDepth,
    repository: config.repository,
    dryRun: config.dryRun,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    issueLabels: config.issueLabels,
    additionalInstructions: config.additionalInstructions,
    issueOverride: config.issueOverride,
    noveltyMode: config.noveltyMode,
    reviewMode: config.reviewMode,
    observabilityProvider: config.observabilityProvider,
    ...(config.observabilityCredentials.sourceId && {
      betterstackSourceId: config.observabilityCredentials.sourceId,
    }),
    ...(config.observabilityCredentials.tableName && {
      betterstackTableName: config.observabilityCredentials.tableName,
    }),
    additionalContext: buildAdditionalContext(config, mcpServers),
  };

  try {
    const results = await execute(triageWorkflow, workflowInput, {
      skills,
      claude,
      observer,
      logger: consoleLogger,
    });

    const durationMs = Date.now() - runStart;

    // Output
    if (config.json) {
      console.log(formatResultJson(results));
    } else {
      console.log(formatDagResultHuman(results, durationMs, config));
    }

    // Terminal bell
    if (config.bell) process.stderr.write("\x07");

    // Check if any node failed
    const hasFailed = [...results.values()].some((r) => r.status === "failed");
    process.exit(hasFailed ? 1 : 0);
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

  const skills = createSkillMap(configuredSkills());
  const mcpAutoConfig = buildMcpAutoConfig(config);
  const mcpServers = buildAutoMcpServers(mcpAutoConfig);
  const claude = new ClaudeClient({
    maxTurns: config.maxImplementTurns || 40,
    cwd: process.cwd(),
    logger: consoleLogger,
    mcpServers,
  });

  console.log(chalk.cyan(`\n  sweny implement ${issueId}\n`));

  const isTTY = process.stderr.isTTY ?? false;
  const implProgressObserver: Observer = (event: ExecutionEvent) => {
    switch (event.type) {
      case "workflow:start":
        process.stderr.write(`\n  \u25B2 ${chalk.bold(event.workflow)}\n\n`);
        break;
      case "node:enter":
        process.stderr.write(`  ${c.subtle("\u25CB")} ${chalk.dim(event.node)}\u2026\n`);
        break;
      case "node:exit": {
        const icon =
          event.result.status === "success"
            ? c.ok("\u2713")
            : event.result.status === "skipped"
              ? c.subtle("\u2212")
              : c.fail("\u2717");
        if (isTTY) {
          process.stderr.write(`\x1B[1A\x1B[2K  ${icon} ${event.node}\n`);
        } else {
          process.stderr.write(`  ${icon} ${event.node}\n`);
        }
        break;
      }
      case "workflow:end":
        process.stderr.write(`\n`);
        break;
    }
  };

  const observer = composeObservers(
    implProgressObserver,
    Boolean(options.stream) ? createStreamObserver() : undefined,
  )!;

  // Build workflow input for implement
  const workflowInput = {
    issueIdentifier: issueId,
    repository: config.repository,
    dryRun: config.dryRun,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    reviewMode: config.reviewMode,
    additionalInstructions: config.additionalInstructions,
  };

  try {
    const results = await execute(implementWorkflow, workflowInput, {
      skills,
      claude,
      observer,
      logger: consoleLogger,
    });

    const hasFailed = [...results.values()].some((r) => r.status === "failed");
    if (hasFailed) {
      console.error(chalk.red(`\n  Implement workflow failed\n`));
      process.exit(1);
    }
    const prResult = results.get("create_pr");
    const prUrl = prResult?.data?.prUrl as string | undefined;
    if (prUrl) {
      console.log(chalk.green(`\n  PR created: ${prUrl}\n`));
    } else {
      console.log(chalk.green(`\n  Implement workflow completed\n`));
    }
    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
});

// ── sweny workflow ─────────────────────────────────────────────────────

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const workflowCmd = program.command("workflow").description("Manage and run workflow files");

/** Reads and parses a workflow file (YAML or JSON). Throws on I/O or parse error. */
function parseWorkflowFileContent(filePath: string): unknown {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".yaml" || ext === ".yml" ? parseYaml(content) : JSON.parse(content);
}

export function loadWorkflowFile(filePath: string): Workflow {
  const raw = parseWorkflowFileContent(filePath);
  const errors = validateWorkflowSchema(raw as Workflow);
  if (errors.length > 0) {
    throw new Error(`Invalid workflow file:\n${errors.map((e) => `  ${e.message}`).join("\n")}`);
  }
  return raw as Workflow;
}

export async function workflowRunAction(
  file: string,
  options: Record<string, unknown> & { json?: boolean; stream?: boolean },
): Promise<void> {
  let workflow: Workflow;
  try {
    workflow = loadWorkflowFile(file);
  } catch (err) {
    console.error(chalk.red(`  Error loading workflow file: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
    return;
  }

  if (options.dryRun) {
    console.log(chalk.green(`  Workflow "${workflow.name}" is valid (${Object.keys(workflow.nodes).length} nodes)`));
    for (const [id, node] of Object.entries(workflow.nodes)) {
      console.log(
        chalk.dim(`    ${id}: ${node.name}${node.skills.length ? ` skills=[${node.skills.join(",")}]` : ""}`),
      );
    }
    process.exit(0);
  }

  const fileConfig = loadConfigFile();
  const config = parseCliInputs(options, fileConfig);
  const isJson = Boolean(options.json);
  const isTTY = !isJson && (process.stderr.isTTY ?? false);

  const skills = createSkillMap(configuredSkills());
  const mcpAutoConfig = buildMcpAutoConfig(config);
  const mcpServers = buildAutoMcpServers(mcpAutoConfig);
  const claude = new ClaudeClient({
    maxTurns: config.maxInvestigateTurns || 50,
    cwd: process.cwd(),
    logger: consoleLogger,
    mcpServers,
  });

  // Track per-node entry time to compute elapsed on exit
  const nodeEnterTimes = new Map<string, number>();

  const wfProgressObserver: Observer | undefined = isJson
    ? undefined
    : (event: ExecutionEvent) => {
        switch (event.type) {
          case "workflow:start":
            process.stderr.write(`\n  \u25B2 ${chalk.bold(event.workflow)}\n\n`);
            break;
          case "node:enter":
            nodeEnterTimes.set(event.node, Date.now());
            process.stderr.write(`  ${c.subtle("\u25CB")} ${chalk.dim(event.node)}\u2026\n`);
            break;
          case "node:exit": {
            const icon =
              event.result.status === "success"
                ? c.ok("\u2713")
                : event.result.status === "skipped"
                  ? c.subtle("\u2212")
                  : c.fail("\u2717");
            const enterTime = nodeEnterTimes.get(event.node) ?? Date.now();
            const elapsedMs = Date.now() - enterTime;
            const elapsed = chalk.dim(elapsedMs < 1000 ? `${elapsedMs}ms` : `${Math.round(elapsedMs / 100) / 10}s`);
            if (isTTY) {
              process.stderr.write(`\x1B[1A\x1B[2K  ${icon} ${event.node}  ${elapsed}\n`);
            } else {
              process.stderr.write(`  ${icon} ${event.node}  ${elapsed}\n`);
            }
            break;
          }
          case "workflow:end":
            process.stderr.write(`\n`);
            break;
        }
      };

  const observer = composeObservers(wfProgressObserver, options.stream ? createStreamObserver() : undefined);

  // Build workflow input from config
  const workflowInput = {
    timeRange: config.timeRange,
    severityFocus: config.severityFocus,
    serviceFilter: config.serviceFilter,
    repository: config.repository,
    dryRun: config.dryRun,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    additionalInstructions: config.additionalInstructions,
    observabilityProvider: config.observabilityProvider,
    ...(config.observabilityCredentials.sourceId && {
      betterstackSourceId: config.observabilityCredentials.sourceId,
    }),
    ...(config.observabilityCredentials.tableName && {
      betterstackTableName: config.observabilityCredentials.tableName,
    }),
    additionalContext: buildAdditionalContext(config, mcpServers),
  };

  try {
    const results = await execute(workflow, workflowInput, {
      skills,
      claude,
      observer,
      logger: consoleLogger,
    });

    if (isJson) {
      process.stdout.write(JSON.stringify(Object.fromEntries(results), null, 2) + "\n");
      const hasFailed = [...results.values()].some((r) => r.status === "failed");
      process.exit(hasFailed ? 1 : 0);
      return;
    }

    const hasFailed = [...results.values()].some((r) => r.status === "failed");
    if (hasFailed) {
      console.error(chalk.red(`  Workflow failed\n`));
      process.exit(1);
      return;
    }
    console.log(chalk.green(`  Workflow completed\n`));
    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}

export function workflowExportAction(name: string): void {
  let workflow: Workflow;
  if (name === "triage") {
    workflow = triageWorkflow;
  } else if (name === "implement") {
    workflow = implementWorkflow;
  } else {
    console.error(chalk.red(`  Unknown workflow "${name}". Available: triage, implement`));
    process.exit(1);
    return;
  }
  // Export as YAML
  process.stdout.write(stringifyYaml(workflow, { indent: 2, lineWidth: 120 }));
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
      console.error(chalk.red(`  \u2717 ${file}: ${message}`));
    }
    process.exit(1);
    return;
  }

  const errors = validateWorkflowSchema(raw as Workflow);

  if (options.json) {
    process.stdout.write(JSON.stringify({ valid: errors.length === 0, errors }, null, 2) + "\n");
  } else if (errors.length === 0) {
    console.log(chalk.green(`  \u2713 ${file} is valid`));
  } else {
    console.error(chalk.red(`  \u2717 ${file} has ${errors.length} validation error${errors.length > 1 ? "s" : ""}:`));
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
  .option("--json", "Output result as JSON on stdout; suppress progress output")
  .option("--stream", "Stream NDJSON events to stdout (for Studio / automation)")
  .action(workflowRunAction);

workflowCmd
  .command("export <name>")
  .description("Print a built-in workflow as YAML (triage or implement)")
  .action(workflowExportAction);

workflowCmd
  .command("create <description>")
  .description("Generate a new workflow from a natural language description")
  .option("--json", "Output workflow JSON to stdout (no interactive prompt)")
  .action(async (description: string, options: { json?: boolean }) => {
    const skills = configuredSkills();
    const claude = new ClaudeClient({
      maxTurns: 3,
      cwd: process.cwd(),
      logger: consoleLogger,
    });

    try {
      let workflow = await buildWorkflow(description, { claude, skills, logger: consoleLogger });

      if (options.json) {
        process.stdout.write(JSON.stringify(workflow, null, 2) + "\n");
        process.exit(0);
        return;
      }

      while (true) {
        console.log("");
        const renderer = new DagRenderer(workflow, { animate: false });
        console.log(renderer.renderToString());
        console.log("");

        const defaultPath = `.sweny/workflows/${workflow.id}.yml`;
        const answer = await promptUser(`  Save to ${defaultPath}? [Y/n/refine] `);
        const choice = answer.toLowerCase() || "y";

        if (choice === "y" || choice === "yes") {
          const dir = path.dirname(defaultPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(defaultPath, stringifyYaml(workflow, { indent: 2, lineWidth: 120 }), "utf-8");
          console.log(chalk.green(`\n  Saved to ${defaultPath}\n`));
          process.exit(0);
          return;
        } else if (choice === "n" || choice === "no") {
          console.log(chalk.dim("\n  Discarded.\n"));
          process.exit(0);
          return;
        } else if (choice === "refine" || choice === "r") {
          const refinement = await promptUser("  What would you like to change? ");
          if (!refinement) continue;
          console.log(chalk.dim("\n  Refining...\n"));
          workflow = await refineWorkflow(workflow, refinement, { claude, skills, logger: consoleLogger });
        } else {
          console.log(chalk.dim("\n  Refining...\n"));
          workflow = await refineWorkflow(workflow, choice, { claude, skills, logger: consoleLogger });
        }
      }
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

workflowCmd
  .command("edit <file> [instruction]")
  .description("Edit an existing workflow file with natural language instructions")
  .option("--json", "Output updated workflow JSON to stdout (no interactive prompt)")
  .action(async (file: string, instruction: string | undefined, options: { json?: boolean }) => {
    let workflow: Workflow;
    try {
      workflow = loadWorkflowFile(file);
    } catch (err) {
      console.error(chalk.red(`  Error loading ${file}: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
      return;
    }

    const skills = configuredSkills();
    const claude = new ClaudeClient({
      maxTurns: 3,
      cwd: process.cwd(),
      logger: consoleLogger,
    });

    if (!instruction) {
      instruction = await promptUser("  What would you like to change? ");
      if (!instruction) {
        console.log(chalk.dim("  No changes.\n"));
        process.exit(0);
        return;
      }
    }

    try {
      let updated = await refineWorkflow(workflow, instruction, { claude, skills, logger: consoleLogger });

      if (options.json) {
        process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
        process.exit(0);
        return;
      }

      while (true) {
        console.log("");
        const renderer = new DagRenderer(updated, { animate: false });
        console.log(renderer.renderToString());
        console.log("");

        const answer = await promptUser(`  Save changes to ${file}? [Y/n/refine] `);
        const choice = answer.toLowerCase() || "y";

        if (choice === "y" || choice === "yes") {
          fs.writeFileSync(file, stringifyYaml(updated, { indent: 2, lineWidth: 120 }), "utf-8");
          console.log(chalk.green(`\n  Saved to ${file}\n`));
          process.exit(0);
          return;
        } else if (choice === "n" || choice === "no") {
          console.log(chalk.dim("\n  Discarded.\n"));
          process.exit(0);
          return;
        } else if (choice === "refine" || choice === "r") {
          const refinement = await promptUser("  What would you like to change? ");
          if (!refinement) continue;
          console.log(chalk.dim("\n  Refining...\n"));
          updated = await refineWorkflow(updated, refinement, { claude, skills, logger: consoleLogger });
        } else {
          console.log(chalk.dim("\n  Refining...\n"));
          updated = await refineWorkflow(updated, choice, { claude, skills, logger: consoleLogger });
        }
      }
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// TODO: The old CLI had `workflow list` that showed registered step types
// from the engine. In the new DAG model, we list available skills instead.
workflowCmd
  .command("list")
  .description("List available skills")
  .option("--json", "Output as JSON array")
  .action((options: { json?: boolean }) => {
    const skills = configuredSkills();
    if (options.json) {
      const data = skills.map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category }));
      process.stdout.write(JSON.stringify(data, null, 2) + "\n");
      return;
    }

    console.log(chalk.bold("\nConfigured skills:\n"));
    for (const skill of skills) {
      console.log(`  ${chalk.cyan(skill.id)} (${skill.category})`);
      console.log(chalk.dim(`    ${skill.description}`));
    }
    console.log();
  });

program.parse();
