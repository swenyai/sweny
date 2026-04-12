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
import { triageWorkflow, implementWorkflow, seedContentWorkflow } from "../workflows/index.js";
import type { ExecutionEvent, NodeResult, Workflow, McpServerConfig, Observer } from "../types.js";
import { consoleLogger } from "../types.js";
import { ClaudeClient } from "../claude.js";
import { createSkillMap, validateWorkflowSkills } from "../skills/index.js";
import { configuredSkills } from "../skills/custom-loader.js";
import { buildAutoMcpServers, buildSkillMcpServers, buildProviderContext } from "../mcp.js";
import { loadAdditionalContext } from "../templates.js";
import type { McpAutoConfig } from "../types.js";
import { validateWorkflow as validateWorkflowSchema } from "../schema.js";
import { parseWorkflow } from "../schema.js";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { toMermaid, toMermaidBlock } from "../mermaid.js";
import type { NodeStatus } from "../mermaid.js";
import { DagRenderer } from "./renderer.js";
import * as readline from "node:readline";

import { loadDotenv, loadConfigFile } from "./config-file.js";
import { buildCredentialMap } from "./credentials.js";
import { runNew } from "./new.js";
import { runE2eRun } from "./e2e.js";
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
  formatDagResultMarkdown,
  formatResultJson,
  formatValidationErrors,
  formatCrashError,
  formatCheckResults,
} from "./output.js";
import { checkProviderConnectivity } from "./check.js";
import { registerSetupCommand } from "./setup.js";
import { registerPublishCommand } from "./publish.js";
import { reportToCloud } from "./cloud-report.js";

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

// ── sweny new ─────────────────────────────────────────────────────────
program
  .command("new")
  .description("Create a new workflow — interactive picker or direct template")
  .action(async () => {
    await runNew();
  });

// ── sweny e2e ────────────────────────────────────────────────────────
const e2eCmd = program.command("e2e").description("End-to-end browser testing");

e2eCmd
  .command("run [file]")
  .description("Run e2e workflow files from .sweny/e2e/")
  .option("--timeout <ms>", "Timeout per workflow in milliseconds (default: 900000 = 15 min)")
  .action(async (file: string | undefined, options: { timeout?: string }) => {
    await runE2eRun({
      file,
      timeout: options.timeout ? parseInt(options.timeout, 10) : undefined,
    });
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
registerPublishCommand(program);

// ── Credential map builder ──────────────────────────────────────────
// buildCredentialMap lives in ./credentials.ts so tests can import it
// without triggering main.ts's top-level program.parse() side effect.

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
 * Build provider context string (available tools/providers).
 */
function buildProviderCtx(config: CliConfig, mcpServers: Record<string, unknown>): string {
  const extras: Record<string, string> = {};
  if (config.observabilityCredentials.sourceId) {
    extras["BetterStack source ID"] = config.observabilityCredentials.sourceId;
  }
  if (config.observabilityCredentials.tableName) {
    extras["BetterStack table name"] = config.observabilityCredentials.tableName;
  }

  return buildProviderContext({
    observabilityProvider: config.observabilityProvider,
    issueTrackerProvider: config.issueTrackerProvider,
    sourceControlProvider: config.sourceControlProvider,
    mcpServers: Object.keys(mcpServers),
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  });
}

/**
 * Resolve rules and context from config into structured workflow input fields.
 * Local files + inline text are resolved now; URLs are passed to the prepare node.
 */
async function resolveRulesAndContext(config: CliConfig): Promise<{
  rules: string;
  context: string;
  rulesUrls: string[];
  contextUrls: string[];
}> {
  const [rulesResult, contextResult] = await Promise.all([
    loadAdditionalContext(config.rules),
    loadAdditionalContext(config.context),
  ]);

  return {
    rules: rulesResult.resolved,
    context: contextResult.resolved,
    rulesUrls: rulesResult.urls,
    contextUrls: contextResult.urls,
  };
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
  const skills = createSkillMap(configuredSkills(process.env, process.cwd()));
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
  const providerCtx = buildProviderCtx(config, mcpServers);
  const { rules, context, rulesUrls, contextUrls } = await resolveRulesAndContext(config);

  // Combine provider context + additional instructions into the context field
  const contextParts = [providerCtx];
  if (config.additionalInstructions) contextParts.push(config.additionalInstructions);
  const fullContext = [contextParts.join("\n\n"), context].filter(Boolean).join("\n\n---\n\n");

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
    // Structured rules/context for executor (URLs resolved eagerly by loadAdditionalContext)
    rules,
    context: fullContext,
    rulesUrls,
    contextUrls,
  };

  try {
    const { results, trace } = await execute(triageWorkflow, workflowInput, {
      skills,
      claude,
      observer,
      logger: consoleLogger,
      cwd: process.cwd(),
      env: process.env,
      fetchAuth: config.fetchAuth,
      offline: config.offline,
    });

    const durationMs = Date.now() - runStart;

    // Output
    if (config.json) {
      console.log(formatResultJson(results));
    } else {
      console.log(formatDagResultHuman(results, durationMs, config));
    }

    // GitHub Actions step summary
    if (config.notificationProvider === "github-summary" && process.env.GITHUB_STEP_SUMMARY) {
      try {
        const md = formatDagResultMarkdown(results, durationMs, config, {
          workflow: triageWorkflow,
          trace,
        });
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
      } catch (err) {
        // Don't fail the run if the summary file can't be written
        console.error(c.subtle(`  ⚠ could not write GITHUB_STEP_SUMMARY: ${err instanceof Error ? err.message : err}`));
      }
    }

    // Report to SWEny Cloud (best-effort, never block the run)
    try {
      await reportToCloud(results, durationMs, config, "triage");
    } catch {
      // silent
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

    // Best-effort GitHub Actions step summary on crash
    if (config.notificationProvider === "github-summary" && process.env.GITHUB_STEP_SUMMARY) {
      try {
        const msg = error instanceof Error ? error.message : "Unknown error";
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ❌ SWEny Triage Crashed\n\n\`\`\`\n${msg}\n\`\`\`\n`);
      } catch {
        // ignore
      }
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
    issueTrackerProvider:
      (options.issueTrackerProvider as string) || (fileConfig["issue-tracker-provider"] as string) || "linear",
    sourceControlProvider:
      (options.sourceControlProvider as string) || (fileConfig["source-control-provider"] as string) || "github",
    codingAgentProvider:
      (options.codingAgentProvider as string) || (fileConfig["coding-agent-provider"] as string) || "claude",
    dryRun: Boolean(options.dryRun),
    maxImplementTurns: parseInt(
      String(options.maxImplementTurns || (fileConfig["max-implement-turns"] as string) || "40"),
      10,
    ),
    baseBranch: (options.baseBranch as string) || (fileConfig["base-branch"] as string) || "main",
    repository: (options.repository as string) || process.env.GITHUB_REPOSITORY || "",
    outputDir:
      (options.outputDir as string) ||
      process.env.SWENY_OUTPUT_DIR ||
      (fileConfig["output-dir"] as string) ||
      ".sweny/output",
  };

  const skills = createSkillMap(configuredSkills(process.env, process.cwd()));
  const mcpAutoConfig = buildMcpAutoConfig(config);
  const mcpServers = buildAutoMcpServers(mcpAutoConfig);
  const claude = new ClaudeClient({
    maxTurns: config.maxImplementTurns || 40,
    cwd: process.cwd(),
    logger: consoleLogger,
    mcpServers,
  });

  console.log(chalk.cyan(`\n  sweny implement ${issueId}\n`));

  const implRunStart = Date.now();

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

  // Resolve rules/context from .sweny.yml (same as triage path)
  const providerCtx = buildProviderCtx(config, mcpServers);
  const { rules, context, rulesUrls, contextUrls } = await resolveRulesAndContext(config);
  const implContextParts = [providerCtx];
  if (config.additionalInstructions) implContextParts.push(config.additionalInstructions);
  const fullImplContext = [implContextParts.join("\n\n"), context].filter(Boolean).join("\n\n---\n\n");

  // Build workflow input for implement
  const workflowInput = {
    issueIdentifier: issueId,
    repository: config.repository,
    dryRun: config.dryRun,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    reviewMode: config.reviewMode,
    additionalInstructions: config.additionalInstructions,
    // Structured rules/context for executor
    rules,
    context: fullImplContext,
    rulesUrls,
    contextUrls,
  };

  try {
    const { results } = await execute(implementWorkflow, workflowInput, {
      skills,
      claude,
      observer,
      logger: consoleLogger,
      cwd: process.cwd(),
      env: process.env,
      fetchAuth: config.fetchAuth,
      offline: config.offline,
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

    // Report to SWEny Cloud (best-effort)
    try {
      await reportToCloud(results, Date.now() - implRunStart, config, "implement");
    } catch {
      // silent
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
  options: Record<string, unknown> & { json?: boolean; stream?: boolean; mermaid?: boolean },
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

  const runStart = Date.now();

  const fileConfig = loadConfigFile();
  const config = parseCliInputs(options, fileConfig);
  const isJson = Boolean(options.json);
  const isTTY = !isJson && (process.stderr.isTTY ?? false);

  const skills = createSkillMap(configuredSkills(process.env, process.cwd()));

  // Hard-fail at startup if the workflow references skills that aren't available.
  // Each node lists alternatives by category (e.g. [sentry, datadog, betterstack]);
  // we require at least one configured skill per category.
  const validation = validateWorkflowSkills(workflow, skills);
  if (validation.errors.length > 0) {
    console.error(chalk.red(`\n  Workflow cannot run — missing required skills:\n`));
    for (const err of validation.errors) console.error(chalk.red(`    \u2717 ${err}`));
    if (validation.missing.length > 0) {
      console.error(chalk.dim(`\n  Set the missing env vars and try again:`));
      for (const m of validation.missing) {
        if (m.missingEnv.length > 0) {
          console.error(chalk.dim(`    - ${m.id}: ${m.missingEnv.join(", ")}`));
        }
      }
    }
    console.error("");
    process.exit(1);
    return;
  }
  for (const warn of validation.warnings) console.error(chalk.yellow(`  \u26A0 ${warn}`));

  // Engine-driven MCP wiring: only inject MCPs for skills that the workflow
  // actually references AND whose env vars are present.
  const referencedSkillIds = new Set<string>();
  for (const node of Object.values(workflow.nodes)) {
    for (const id of node.skills) referencedSkillIds.add(id);
  }
  const mcpServers = buildSkillMcpServers({
    referencedSkills: referencedSkillIds,
    credentials: buildCredentialMap(),
    userMcpServers: Object.keys(config.mcpServers).length > 0 ? config.mcpServers : undefined,
  });

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

  // Build workflow input — prefer --input JSON if provided, else fall back to config-derived input
  let workflowInput: Record<string, unknown>;

  if (options.input && typeof options.input === "string") {
    try {
      workflowInput = JSON.parse(options.input as string);
    } catch {
      console.error(chalk.red("  --input must be valid JSON"));
      process.exit(1);
      return;
    }
  } else {
    workflowInput = {
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
      context: buildProviderCtx(config, mcpServers),
    };
  }

  try {
    const { results, trace } = await execute(workflow, workflowInput, {
      skills,
      claude,
      observer,
      logger: consoleLogger,
      cwd: process.cwd(),
      env: process.env,
      fetchAuth: config.fetchAuth,
      offline: config.offline,
    });

    if (isJson) {
      process.stdout.write(JSON.stringify(Object.fromEntries(results), null, 2) + "\n");
      const hasFailed = [...results.values()].some((r) => r.status === "failed");
      process.exit(hasFailed ? 1 : 0);
      return;
    }

    // Mermaid diagram with execution state
    if (options.mermaid) {
      const state: Record<string, NodeStatus> = {};
      for (const [nodeId, result] of results) {
        state[nodeId] = result.status === "success" ? "success" : result.status === "failed" ? "failed" : "skipped";
      }
      process.stdout.write(toMermaidBlock(workflow, { state, trace, title: workflow.name }) + "\n");
    }

    // Report to SWEny Cloud (best-effort)
    try {
      await reportToCloud(results, Date.now() - runStart, config, workflow.id);
    } catch {
      // silent
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
  } else if (name === "seed-content") {
    workflow = seedContentWorkflow;
  } else {
    console.error(chalk.red(`  Unknown workflow "${name}". Available: triage, implement, seed-content`));
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
  .option("--mermaid", "Output a Mermaid diagram with execution state after run")
  .option("--input <json>", "JSON string of input data to pass to the workflow")
  .action(workflowRunAction);

workflowCmd
  .command("diagram <file>")
  .description("Render a workflow as a Mermaid diagram")
  .option("--direction <dir>", "Graph direction: TB (top-bottom) or LR (left-right)", "TB")
  .option("--title <title>", "Diagram title (defaults to workflow name)")
  .option("--block", "Wrap in ```mermaid fenced code block (default)", true)
  .option("--no-block", "Output raw Mermaid without code fence")
  .action((file: string, options: { direction?: string; title?: string; block?: boolean }) => {
    let workflow: Workflow;

    // Support builtin workflow names
    if (file === "triage") {
      workflow = triageWorkflow;
    } else if (file === "implement") {
      workflow = implementWorkflow;
    } else if (file === "seed-content") {
      workflow = seedContentWorkflow;
    } else {
      try {
        workflow = loadWorkflowFile(file);
      } catch (err) {
        console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
        return;
      }
    }

    const direction = (options.direction === "LR" ? "LR" : "TB") as "TB" | "LR";
    const title = options.title ?? workflow.name;
    const render = options.block !== false ? toMermaidBlock : toMermaid;
    process.stdout.write(render(workflow, { direction, title }) + "\n");
  });

workflowCmd
  .command("export <name>")
  .description("Print a built-in workflow as YAML (triage or implement)")
  .action(workflowExportAction);

workflowCmd
  .command("create <description>")
  .description("[DEPRECATED] Use `sweny new` and pick 'Describe your own'")
  .option("--json", "Output workflow JSON to stdout (no interactive prompt)")
  .action(async (description: string, options: { json?: boolean }) => {
    if (!options.json) {
      console.warn("\x1B[33m  ⚠  `sweny workflow create` is deprecated. Use `sweny new` instead.\x1B[0m\n");
    }
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
