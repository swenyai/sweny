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
import { configuredSkills, configuredSkillsWithDiagnostics } from "../skills/custom-loader.js";
import { buildAutoMcpServers, buildSkillMcpServers, buildProviderContext } from "../mcp.js";
import { loadAdditionalContext } from "../templates.js";
import type { McpAutoConfig } from "../types.js";
import { loadAndValidateWorkflow } from "../loader.js";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { toMermaid, toMermaidBlock } from "../mermaid.js";
import type { NodeStatus } from "../mermaid.js";
import { runWorkflowDiagram } from "./diagram.js";
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
import { registerSkillCommand } from "./skill.js";
import { reportToCloud } from "./cloud-report.js";
import { beginCloudLifecycle, finishCloudLifecycle } from "./cloud-lifecycle.js";
import { runUpgrade, fetchLatestFromNpm } from "./upgrade.js";
import { maybeNudge, defaultCachePath } from "./version-check.js";
import { spawnSync } from "node:child_process";

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
  .command("new [id]")
  .description(
    "Create a new workflow. With no id, opens the interactive picker. With an id, installs that workflow from the marketplace (swenyai/workflows).",
  )
  .action(async (id: string | undefined) => {
    await runNew(id ? { marketplaceId: id } : undefined);
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
registerSkillCommand(program);

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
    observabilityProviders: config.observabilityProviders,
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
  const bsCreds = config.observabilityCredentials["betterstack"];
  if (bsCreds?.sourceId) {
    extras["BetterStack source ID"] = bsCreds.sourceId;
  }
  if (bsCreds?.tableName) {
    extras["BetterStack table name"] = bsCreds.tableName;
  }

  return buildProviderContext({
    observabilityProviders: config.observabilityProviders,
    issueTrackerProvider: config.issueTrackerProvider,
    sourceControlProvider: config.sourceControlProvider,
    mcpServers: Object.keys(mcpServers),
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  });
}

/**
 * Resolve rules and context from config into structured workflow input fields.
 * All source kinds (inline, file, URL) are resolved eagerly.
 *
 * `offline` and `fetchAuth` are threaded through so CLI-preloaded rules/context
 * honor the same policy as Sources resolved later by the executor (Fix #16).
 */
async function resolveRulesAndContext(config: CliConfig): Promise<{
  rules: string;
  context: string;
}> {
  const loadOptions = {
    cwd: process.cwd(),
    offline: config.offline,
    fetchAuth: config.fetchAuth,
    env: process.env,
  };
  const [rulesResult, contextResult] = await Promise.all([
    loadAdditionalContext(config.rules, loadOptions),
    loadAdditionalContext(config.context, loadOptions),
  ]);

  return {
    rules: rulesResult.resolved,
    context: contextResult.resolved,
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
  const triageSkillDiscovery = configuredSkillsWithDiagnostics(process.env, process.cwd());
  for (const w of triageSkillDiscovery.warnings) {
    console.error(chalk.yellow(`  ⚠  ${w.message}`));
  }
  const skills = createSkillMap(triageSkillDiscovery.skills);
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
  const { rules, context } = await resolveRulesAndContext(config);

  // Combine provider context + additional instructions into the context field
  const contextParts = [providerCtx];
  if (config.additionalInstructions) contextParts.push(config.additionalInstructions);
  const fullContext = [contextParts.join("\n\n"), context].filter(Boolean).join("\n\n---\n\n");

  const bsCreds = config.observabilityCredentials["betterstack"];
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
    observabilityProviders: config.observabilityProviders,
    ...(bsCreds?.sourceId && {
      betterstackSourceId: bsCreds.sourceId,
    }),
    ...(bsCreds?.tableName && {
      betterstackTableName: bsCreds.tableName,
    }),
    // Structured rules/context for executor (URLs resolved eagerly by loadAdditionalContext)
    rules,
    context: fullContext,
  };

  // Open the cloud lifecycle session BEFORE execute() so the dashboard
  // link can be printed early and node-streaming wire-up (a follow-up
  // task) has a runId to attach events to. Null when token is unset or
  // the call fails — cloud reporting must never block the workflow.
  const cloudHandle = await beginCloudLifecycle(config, triageWorkflow);
  if (cloudHandle?.dashboardUrl) {
    console.log(c.subtle(`  cloud: ${cloudHandle.dashboardUrl}`));
  }

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

    // Close the cloud lifecycle session opened above. Status reflects
    // whether any node failed — cloud's runs.status enum accepts the
    // same vocabulary the engine uses.
    const triageHasFailed = [...results.values()].some((r) => r.status === "failed");
    try {
      await finishCloudLifecycle(config, cloudHandle, results, durationMs, triageHasFailed ? "failed" : "success");
    } catch {
      // silent
    }

    // Report to SWEny Cloud (best-effort, legacy /api/report path for
    // back-compat with cloud builds that haven't deployed lifecycle
    // endpoints yet — runs through both paths so neither side breaks).
    try {
      await reportToCloud(results, durationMs, config, "triage");
    } catch {
      // silent — cloud reporting is optional
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

  const implementSkillDiscovery = configuredSkillsWithDiagnostics(process.env, process.cwd());
  for (const w of implementSkillDiscovery.warnings) {
    console.error(chalk.yellow(`  ⚠  ${w.message}`));
  }
  const skills = createSkillMap(implementSkillDiscovery.skills);
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
  const { rules, context } = await resolveRulesAndContext(config);
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
  };

  // Open cloud lifecycle session. See triage path for rationale.
  const implCloudHandle = await beginCloudLifecycle(config, implementWorkflow);
  if (implCloudHandle?.dashboardUrl) {
    console.log(c.subtle(`  cloud: ${implCloudHandle.dashboardUrl}`));
  }

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
    const implDurationMs = Date.now() - implRunStart;

    // Close the cloud lifecycle session. We do this BEFORE the early
    // process.exit(1) on failure so cloud sees the final status — a
    // crashed-without-finish run would stay stuck at "started" forever.
    try {
      await finishCloudLifecycle(config, implCloudHandle, results, implDurationMs, hasFailed ? "failed" : "success");
    } catch {
      // silent
    }

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

    // Legacy /api/report back-compat — see triage path.
    try {
      await reportToCloud(results, implDurationMs, config, "implement");
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

export function loadWorkflowFile(filePath: string, knownSkills?: Set<string>): Workflow {
  const result = loadAndValidateWorkflow(filePath, { knownSkills });
  if (!result.ok) {
    throw new Error(`Invalid workflow file:\n${result.errors.map((e) => `  ${e.message}`).join("\n")}`);
  }
  return result.workflow;
}

export async function workflowRunAction(
  file: string,
  options: Record<string, unknown> & { json?: boolean; stream?: boolean; mermaid?: boolean },
): Promise<void> {
  // Discover skills first so the loader can flag UNKNOWN_SKILL at parse
  // time. validateWorkflowSkills below still runs for richer category /
  // env-var diagnostics, but the loader's structural check fires earlier
  // and gives users a clear "you typed `gtihub`" pointer before any other
  // validation noise.
  const earlySkillDiscovery = configuredSkillsWithDiagnostics(process.env, process.cwd());
  for (const w of earlySkillDiscovery.warnings) {
    console.error(chalk.yellow(`  ⚠  ${w.message}`));
  }
  const knownSkillIds = new Set(earlySkillDiscovery.skills.map((s) => s.id));

  let workflow: Workflow;
  try {
    workflow = loadWorkflowFile(file, knownSkillIds);
  } catch (err) {
    console.error(chalk.red(`  Error loading workflow file: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
    return;
  }

  // --list-nodes: lightweight static inspection, no execution. Used to be
  // the behavior of --dry-run before Fix #6.
  if (options.listNodes) {
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

  // Reuse the discovery pulled before workflow load (above). Diagnostics
  // already surfaced; just turn the skill list into a map for the executor.
  const skills = createSkillMap(earlySkillDiscovery.skills);

  // Hard-fail at startup if the workflow references skills that aren't available.
  // Each node lists alternatives by category (e.g. [sentry, datadog, betterstack]);
  // we require at least one configured skill per category.
  const validation = validateWorkflowSkills(workflow, skills, workflow.skills);
  if (validation.errors.length > 0) {
    console.error(chalk.red(`\n  Workflow cannot run — missing required skills:\n`));
    for (const err of validation.errors) console.error(chalk.red(`    \u2717 ${err}`));

    const unknown = validation.missing.filter((m) => m.category === "unknown");
    const envGaps = validation.missing.filter((m) => m.category !== "unknown" && m.missingEnv.length > 0);

    if (unknown.length > 0) {
      console.error(
        chalk.dim(
          `\n  These skill IDs aren't built-in or discovered in .{claude,sweny,agents,gemini}/skills/.\n  Scaffold one with:\n`,
        ),
      );
      for (const m of unknown) {
        console.error(chalk.dim(`    sweny skill new ${m.id}`));
      }
    }
    if (envGaps.length > 0) {
      console.error(chalk.dim(`\n  These skills are built-in but their env vars aren't set:`));
      for (const m of envGaps) {
        console.error(chalk.dim(`    - ${m.id}: ${m.missingEnv.join(", ")}`));
      }
    }
    console.error(chalk.dim(`\n  Run \`sweny skill list\` to see what's available.\n`));
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
      observabilityProviders: config.observabilityProviders,
      ...(config.observabilityCredentials["betterstack"]?.sourceId && {
        betterstackSourceId: config.observabilityCredentials["betterstack"].sourceId,
      }),
      ...(config.observabilityCredentials["betterstack"]?.tableName && {
        betterstackTableName: config.observabilityCredentials["betterstack"].tableName,
      }),
      context: buildProviderCtx(config, mcpServers),
    };
  }

  // Open cloud lifecycle session. See triage path for rationale.
  const wfCloudHandle = await beginCloudLifecycle(config, workflow);
  if (wfCloudHandle?.dashboardUrl && !isJson) {
    console.log(c.subtle(`  cloud: ${wfCloudHandle.dashboardUrl}`));
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

    const wfDurationMs = Date.now() - runStart;
    const wfHasFailed = [...results.values()].some((r) => r.status === "failed");

    // Close the cloud lifecycle session BEFORE the JSON early-exit so
    // every workflow run reports a terminal status, regardless of how
    // the CLI returns (json, mermaid, or normal stdout).
    try {
      await finishCloudLifecycle(config, wfCloudHandle, results, wfDurationMs, wfHasFailed ? "failed" : "success");
    } catch {
      // silent
    }

    if (isJson) {
      process.stdout.write(JSON.stringify(Object.fromEntries(results), null, 2) + "\n");
      process.exit(wfHasFailed ? 1 : 0);
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

    // Legacy /api/report back-compat — see triage path.
    try {
      await reportToCloud(results, wfDurationMs, config, workflow.id);
    } catch {
      // silent
    }

    if (wfHasFailed) {
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
  const result = loadAndValidateWorkflow(file);

  if (options.json) {
    const errs = result.ok ? [] : result.errors;
    process.stdout.write(JSON.stringify({ valid: result.ok, errors: errs }, null, 2) + "\n");
  } else if (result.ok) {
    console.log(chalk.green(`  \u2713 ${file} is valid`));
  } else {
    console.error(
      chalk.red(`  \u2717 ${file} has ${result.errors.length} validation error${result.errors.length > 1 ? "s" : ""}:`),
    );
    for (const err of result.errors) {
      console.error(chalk.dim(`    ${err.message}`));
    }
  }

  process.exit(result.ok ? 0 : 1);
}

workflowCmd
  .command("validate <file>")
  .description("Validate a workflow YAML or JSON file")
  .option("--json", "Output result as JSON")
  .action(workflowValidateAction);

workflowCmd
  .command("run <file>")
  .description("Run a workflow from a YAML or JSON file")
  .option(
    "--dry-run",
    "Execute until the first conditional routing decision, then stop (no side effects past that point). NOTE: behavior changed in this release — previously --dry-run only printed the node list. For that behavior use --list-nodes.",
  )
  .option(
    "--list-nodes",
    "Validate, print nodes/skills, and exit without running. (Replaces the pre-Fix-#6 --dry-run behavior.)",
  )
  .option("--json", "Output result as JSON on stdout; suppress progress output")
  .option("--stream", "Stream NDJSON events to stdout (for Studio / automation)")
  .option("--mermaid", "Output a Mermaid diagram with execution state after run")
  .option("--input <json>", "JSON string of input data to pass to the workflow")
  .action(workflowRunAction);

workflowCmd
  .command("diagram <file>")
  .description("Render a workflow as a Mermaid diagram (raw .mmd by default; .md output auto-fences)")
  .option("--direction <dir>", "Graph direction: TB (top-bottom) or LR (left-right)", "TB")
  .option("--title <title>", "Inject a title header (off by default — raw Mermaid has no title)")
  .option("--block", "Wrap in ```mermaid fenced code block (forces fencing in any output)")
  .option("--no-block", "Force raw Mermaid even when writing to a .md file")
  .option("-o, --output <path>", "Write to a file instead of stdout (.mmd/.mermaid raw; .md fenced)")
  .action((file: string, options: { direction?: string; title?: string; block?: boolean; output?: string }) => {
    runWorkflowDiagram(file, options, { loadWorkflowFile });
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

// ── sweny upgrade / update ────────────────────────────────────────────
// Self-update the globally-installed @sweny-ai/core. Mirrors the UX of
// `bun upgrade`, `deno upgrade`, `rustup update`, etc.
program
  .command("upgrade")
  .alias("update")
  .description("Upgrade sweny to the latest published version")
  .option("--check", "Report what would be installed without running the installer")
  .option("--force", "Reinstall even if the current version is already latest")
  .option("--tag <tag>", "npm dist-tag to install (default: latest)", "latest")
  .action(async (options: { check?: boolean; force?: boolean; tag?: string }) => {
    // process.argv[1] is the CLI entrypoint — resolve through any symlinks
    // (nvm, homebrew, etc. symlink the bin into a PATH dir) so PM detection
    // looks at the real install location.
    const argv1 = process.argv[1] ?? "";
    let installPath = argv1;
    try {
      installPath = fs.realpathSync(argv1);
    } catch {
      // Fall through with the unresolved path; detection degrades gracefully.
    }
    await runUpgrade(options, {
      currentVersion: version,
      installPath,
      fetchLatestVersion: fetchLatestFromNpm,
      runInstall: (cmd, args) => {
        // Windows: `npm`/`pnpm`/`yarn` are `.cmd` shims and Node's spawn can't
        // resolve them without a shell. Everywhere else we skip the shell to
        // keep argv unambiguous and avoid injection surface.
        const res = spawnSync(cmd, args, {
          stdio: "inherit",
          shell: process.platform === "win32",
        });
        if (res.error) {
          process.stderr.write(chalk.red(`  Error: couldn't run ${cmd} — ${res.error.message}`) + "\n");
          return 127;
        }
        return typeof res.status === "number" ? res.status : 1;
      },
      canWrite: (dir) => {
        try {
          fs.accessSync(dir, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      },
    });
  });

// ── Passive "new version available" nudge ─────────────────────────────
// Runs after every command. Non-blocking, bounded to 1.5s, silent on any
// failure, skipped in CI / non-TTY / opt-out environments.
program.hook("postAction", async (_thisCommand, actionCommand) => {
  const topLevel = actionCommand.parent?.name() === "sweny" ? actionCommand.name() : actionCommand.parent?.name();
  await maybeNudge({
    currentVersion: version,
    cachePath: defaultCachePath(),
    now: Date.now(),
    env: process.env,
    isTty: Boolean(process.stderr.isTTY),
    commandName: topLevel,
  });
});

await program.parseAsync();
