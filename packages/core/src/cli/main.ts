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
import type { ExecutionEvent, ExecutionTrace, NodeResult, Workflow, McpServerConfig, Observer } from "../types.js";
import { consoleLogger } from "../types.js";
import { createHarness } from "../harness/index.js";
import { builtinSkills, createSkillMap, validateWorkflowSkills } from "../skills/index.js";
import { formatMissingSkillLines, skillEnvWarnings } from "./skill-env.js";
import { configuredSkills, configuredSkillsWithDiagnostics } from "../skills/custom-loader.js";
import { buildAutoMcpServers, buildSkillMcpServers, buildProviderContext } from "../mcp.js";
import { loadAdditionalContext } from "../templates.js";
import type { McpAutoConfig } from "../types.js";
import { loadAndValidateWorkflow } from "../loader.js";
import { validateRuntimeInput } from "../inputs.js";
import { mergeDryRunIntoInput, parseRunBudgetFlags } from "./workflow-input.js";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { toMermaid, toMermaidBlock } from "../mermaid.js";
import type { NodeStatus } from "../mermaid.js";
import { runWorkflowDiagram } from "./diagram.js";
import { DagRenderer } from "./renderer.js";
import * as readline from "node:readline";

import { loadDotenv, loadConfigFile, applyAgentFileConfig } from "./config-file.js";
import { buildCredentialMap } from "./credentials.js";
import { nonInteractiveUsage, runNew } from "./new.js";
import { buildRunRecord, createNodeTimer, historyDisabled, newRunId, recordRun } from "./run-history.js";
import { registerRunsCommand } from "./runs.js";
import { runE2eRun, runWithWallClockBudget, DEFAULT_WORKFLOW_TIMEOUT_MS } from "./e2e.js";
import { createVerboseToolObserver } from "./verbose-observer.js";
import {
  createRunLogger,
  renderReceiptLine,
  summarizeRun,
  writeStepSummary,
  WORKFLOW_RUN_DESCRIPTION,
  WORKFLOW_RUN_OPTIONS,
} from "./run-output.js";
import { writeRunComment } from "./comment-output.js";
import {
  registerTriageCommand,
  registerImplementCommand,
  parseCliInputs,
  validateInputs,
  validateWarnings,
  parsePositiveInt,
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
import {
  checkProviderConnectivity,
  detectClaudeCodeLogin,
  discoverWorkflowSkillIds,
  validateCheckInputs,
} from "./check.js";
import { registerSetupCommand } from "./setup.js";
import { registerPublishCommand } from "./publish.js";
import { registerSkillCommand } from "./skill.js";
import { reportToCloud } from "./cloud-report.js";
import { beginCloudLifecycle, finishCloudLifecycle, createCloudStreamObserver } from "./cloud-lifecycle.js";
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

// Verbose tool-detail observer lives in ./verbose-observer.ts so tests can
// import it without triggering main.ts's top-level CLI parser.

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
// Agent sandbox / env-passthrough keys from .sweny.yml -> SWENY_* env (#360).
applyAgentFileConfig(loadConfigFile());

const program = new Command()
  .name("sweny")
  .description("SWEny CLI \u2014 autonomous engineering workflows")
  .version(version);

// ── sweny new ─────────────────────────────────────────────────────────
program
  .command("new [id]")
  .description(
    "Create a new workflow. With no id, opens the interactive picker. With an id, uses that built-in template, or installs it from the marketplace (swenyai/workflows).",
  )
  .option("--template <id>", "Use a built-in template without the picker")
  .option("-y, --yes", "Skip every prompt (never overwrites existing files)")
  .action(async (id: string | undefined, options: { template?: string; yes?: boolean }) => {
    // Prompts need a terminal. Without one (CI, pipes), a prompt never
    // settles, so print usage and exit 2 instead of hanging.
    if (!options.yes && !process.stdin.isTTY) {
      console.error(nonInteractiveUsage());
      process.exit(2);
    }
    await runNew({ marketplaceId: id, template: options.template, yes: options.yes });
  });

// ── sweny check ───────────────────────────────────────────────────────
program
  .command("check")
  .description("Verify provider credentials and connectivity")
  .action(async () => {
    const fileConfig = loadConfigFile();
    const config = parseCliInputs({}, fileConfig);
    const workflows = discoverWorkflowSkillIds(process.cwd());
    const scope = workflows.found ? workflows.skillIds : undefined;
    const claudeCodeLogin = detectClaudeCodeLogin();
    const errors = validateCheckInputs(config, { scope, claudeCodeLogin });
    if (errors.length > 0) {
      console.error(formatValidationErrors(errors));
      process.exit(1);
    }
    console.log(chalk.dim("\n  Checking provider connectivity…\n"));
    const results = await checkProviderConnectivity(config, { scope, claudeCodeLogin });
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
    fileRoot: config.fileRoot || undefined,
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
  const claude = createHarness("claude-code", {
    maxTurns: config.maxInvestigateTurns || 50,
    cwd: process.cwd(),
    logger: consoleLogger,
    defaultMcpServers: mcpServers,
    mcpServers: config.mcpServers,
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

  // Open the cloud lifecycle session BEFORE composing observers so the
  // node-streaming observer can attach events to the correct runId.
  // Null when the token is unset or startRun fails — cloud reporting
  // must never block the workflow.
  //
  // Cloud sees the input *shape* (key names + observed types), never
  // the values. Per workflow spec Telemetry shape rule, a token in the
  // bag never leaves the host.
  const cloudHandle = await beginCloudLifecycle(config, triageWorkflow, {
    declaredInputs: triageWorkflow.inputs,
    resolvedInputs: workflowInput,
  });
  if (cloudHandle?.dashboardUrl) {
    console.log(c.subtle(`  cloud: ${cloudHandle.dashboardUrl}`));
  }

  const observer = composeObservers(
    progressObserver,
    config.verbose ? createVerboseToolObserver() : undefined,
    config.stream ? createStreamObserver() : undefined,
    createCloudStreamObserver(config, cloudHandle),
  );

  try {
    const { results, trace } = await execute(triageWorkflow, workflowInput, {
      skills,
      harness: claude,
      observer,
      logger: consoleLogger,
      cwd: process.cwd(),
      env: process.env,
      fetchAuth: config.fetchAuth,
      offline: config.offline,
      fileRoot: config.fileRoot || undefined,
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
    const crashMsg = error instanceof Error ? error.message : "Unknown error";
    if (config.json) {
      console.log(JSON.stringify({ error: crashMsg }));
    } else {
      console.error(formatCrashError(error));
    }

    // Finalize the cloud run as failed. execute() threw (including the
    // RouteEvaluationError the executor raises on route-eval failure), so
    // the in-try finish never ran and the run would otherwise stay stuck at
    // "running" forever. No results map exists on this path, so pass an empty
    // one; the error summary is a short message, never raw agent prose.
    try {
      // PRIVACY: pass the raw error, not crashMsg. finishCloudLifecycle reduces it
      // to error.name + a 200-char message: thrown messages can embed agent/LLM
      // prose or log text, and the cloud gets metadata only. It also sends at
      // most one finish per run, so a throw after the in-try finish cannot
      // overwrite the real result with a second "failed".
      await finishCloudLifecycle(config, cloudHandle, new Map(), Date.now() - runStart, "failed", error);
    } catch {
      // silent — cloud reporting must never block or mask the crash
    }

    // Best-effort GitHub Actions step summary on crash
    if (config.notificationProvider === "github-summary" && process.env.GITHUB_STEP_SUMMARY) {
      try {
        fs.appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `## ❌ SWEny Triage Crashed\n\n\`\`\`\n${crashMsg}\n\`\`\`\n`,
        );
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
    // parsePositiveInt mirrors the triage path: junk → NaN, which
    // validateInputs rejects via validateIntegerBound below.
    maxImplementTurns: parsePositiveInt(options.maxImplementTurns ?? (fileConfig["max-implement-turns"] as string), 40),
    baseBranch: (options.baseBranch as string) || (fileConfig["base-branch"] as string) || "main",
    repository: (options.repository as string) || process.env.GITHUB_REPOSITORY || "",
    outputDir:
      (options.outputDir as string) ||
      process.env.SWENY_OUTPUT_DIR ||
      (fileConfig["output-dir"] as string) ||
      ".sweny/output",
  };

  // Validate (parity with triage): surface the curated "Missing: ..." errors
  // and reject malformed integer flags before any execution.
  const implErrors = validateInputs(config);
  if (implErrors.length > 0) {
    console.error(formatValidationErrors(implErrors));
    console.error(c.subtle("\n  Run sweny implement --help for usage information.\n"));
    process.exit(1);
  }

  const implementSkillDiscovery = configuredSkillsWithDiagnostics(process.env, process.cwd());
  for (const w of implementSkillDiscovery.warnings) {
    console.error(chalk.yellow(`  ⚠  ${w.message}`));
  }
  const skills = createSkillMap(implementSkillDiscovery.skills);
  const mcpAutoConfig = buildMcpAutoConfig(config);
  const mcpServers = buildAutoMcpServers(mcpAutoConfig);
  const claude = createHarness("claude-code", {
    maxTurns: config.maxImplementTurns || 40,
    cwd: process.cwd(),
    logger: consoleLogger,
    defaultMcpServers: mcpServers,
    mcpServers: config.mcpServers,
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

  // Open cloud lifecycle session BEFORE composing observers so the
  // node-streaming observer can attach to the correct runId. See
  // triage path for rationale. Cloud sees the input *shape* only.
  const implCloudHandle = await beginCloudLifecycle(config, implementWorkflow, {
    declaredInputs: implementWorkflow.inputs,
    resolvedInputs: workflowInput,
  });
  if (implCloudHandle?.dashboardUrl) {
    console.log(c.subtle(`  cloud: ${implCloudHandle.dashboardUrl}`));
  }

  const observer = composeObservers(
    implProgressObserver,
    config.verbose ? createVerboseToolObserver() : undefined,
    Boolean(options.stream) ? createStreamObserver() : undefined,
    createCloudStreamObserver(config, implCloudHandle),
  );

  try {
    const { results } = await execute(implementWorkflow, workflowInput, {
      skills,
      harness: claude,
      observer,
      logger: consoleLogger,
      cwd: process.cwd(),
      env: process.env,
      fetchAuth: config.fetchAuth,
      offline: config.offline,
      fileRoot: config.fileRoot || undefined,
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
    const crashMsg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  Error: ${crashMsg}\n`));
    // Finalize the cloud run as failed (covers thrown errors, incl.
    // RouteEvaluationError). Without this a crashed implement run stays
    // "running" in cloud forever.
    try {
      // PRIVACY: pass the raw error, not crashMsg. finishCloudLifecycle reduces it
      // to error.name + a 200-char message: thrown messages can embed agent/LLM
      // prose or log text, and the cloud gets metadata only. It also sends at
      // most one finish per run, so a throw after the in-try finish cannot
      // overwrite the real result with a second "failed".
      await finishCloudLifecycle(config, implCloudHandle, new Map(), Date.now() - implRunStart, "failed", err);
    } catch {
      // silent
    }
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
  file: string | undefined,
  options: Record<string, unknown> & {
    json?: boolean;
    stream?: boolean;
    mermaid?: boolean;
    commentFile?: string;
    verbose?: boolean;
    timeout?: string;
    maxSteps?: string;
    yes?: boolean;
  },
): Promise<void> {
  // Reject junk --timeout/--max-steps up front (both paths) instead of
  // silently falling back to a default.
  let budget: ReturnType<typeof parseRunBudgetFlags>;
  try {
    budget = parseRunBudgetFlags(options.timeout, options.maxSteps, DEFAULT_WORKFLOW_TIMEOUT_MS);
  } catch (err) {
    console.error(chalk.red(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  // No file given → batch-run the e2e workflows in .sweny/e2e/. This is the
  // home for what used to be `sweny e2e run`; it lists what will run and
  // confirms first (bypass with --yes).
  if (!file) {
    await runE2eRun({
      timeout: options.timeout === undefined ? undefined : budget.timeoutMs,
      yes: Boolean(options.yes),
    });
    return;
  }

  // Discover skills first so the loader can flag UNKNOWN_SKILL at parse
  // time. validateWorkflowSkills below still runs for richer category /
  // env-var diagnostics, but the loader's structural check fires earlier
  // and gives users a clear "you typed `gtihub`" pointer before any other
  // validation noise.
  const earlySkillDiscovery = configuredSkillsWithDiagnostics(process.env, process.cwd());
  for (const w of earlySkillDiscovery.warnings) {
    console.error(chalk.yellow(`  ⚠  ${w.message}`));
  }
  // A built-in skill with unset env is not "unknown": include every built-in id
  // so the loader only flags genuine typos; missing env is reported below.
  const knownSkillIds = new Set([...earlySkillDiscovery.skills.map((s) => s.id), ...builtinSkills.map((s) => s.id)]);

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
    console.error(chalk.red(`\n  Workflow cannot run:\n`));
    for (const line of formatMissingSkillLines(validation)) console.error(chalk.red(`    \u2717 ${line}`));

    const unknown = validation.missing.filter((m) => m.category === "unknown");
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

  // Raw [info]/[debug] lines are verbose-only; warnings are rendered (#383).
  const runLogger = createRunLogger({ verbose: Boolean(options.verbose), tty: isTTY });

  const claude = createHarness("claude-code", {
    maxTurns: config.maxInvestigateTurns || 50,
    cwd: process.cwd(),
    logger: runLogger,
    defaultMcpServers: mcpServers,
    mcpServers: config.mcpServers,
    model: workflow.model,
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
            runLogger.flush();
            break;
          }
          case "workflow:end":
            process.stderr.write(`\n`);
            break;
        }
      };

  // Build workflow input — prefer --input JSON if provided, else fall back to config-derived input
  let workflowInput: Record<string, unknown>;

  if (options.input && typeof options.input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.input as string);
    } catch {
      console.error(chalk.red("  --input must be valid JSON"));
      process.exit(1);
      return;
    }
    // Validate against the workflow's declared `inputs` contract (when present).
    // Workflows without an `inputs` block pass through unchanged.
    const validated = validateRuntimeInput(workflow.inputs, parsed);
    if (!validated.ok) {
      console.error(chalk.red(`\n  --input does not match workflow "${workflow.id}" inputs contract:\n`));
      for (const err of validated.errors) {
        console.error(chalk.red(`    ✗ ${err.field}: ${err.message}`));
      }
      if (workflow.inputs) {
        console.error(chalk.dim(`\n  Declared inputs:`));
        for (const [name, field] of Object.entries(workflow.inputs)) {
          const flags: string[] = [field.type];
          if (field.required) flags.push("required");
          if (field.default !== undefined) flags.push(`default=${JSON.stringify(field.default)}`);
          console.error(
            chalk.dim(`    - ${name} (${flags.join(", ")})${field.description ? `: ${field.description}` : ""}`),
          );
        }
      }
      console.error("");
      process.exit(1);
      return;
    }
    workflowInput = mergeDryRunIntoInput(validated.value, config.dryRun);
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

    // If the workflow declared `inputs`, apply defaults to the config-derived bag.
    // This lets a CI caller omit --input entirely and still get the documented
    // defaults filled in (e.g. since_tag/until_tag pulled from a release-notes
    // workflow's declaration).
    if (workflow.inputs) {
      const validated = validateRuntimeInput(workflow.inputs, workflowInput);
      if (!validated.ok) {
        console.error(
          chalk.red(`\n  Workflow "${workflow.id}" declares required inputs not satisfied by default config:\n`),
        );
        for (const err of validated.errors) {
          console.error(chalk.red(`    ✗ ${err.field}: ${err.message}`));
        }
        console.error(chalk.dim(`\n  Pass them via --input '{ ... }'.\n`));
        process.exit(1);
        return;
      }
      workflowInput = validated.value;
    }
  }

  // Open cloud lifecycle session BEFORE composing observers so the
  // node-streaming observer can attach to the correct runId. See
  // triage path for rationale. Cloud sees the input *shape* only,
  // never the values. Enforces the workflow spec Telemetry rule
  // even when the workflow's declared inputs include secrets.
  const wfCloudHandle = await beginCloudLifecycle(config, workflow, {
    declaredInputs: workflow.inputs,
    resolvedInputs: workflowInput,
  });
  if (wfCloudHandle?.dashboardUrl && !isJson) {
    console.log(c.subtle(`  cloud: ${wfCloudHandle.dashboardUrl}`));
  }

  // Run history (#388): metadata-only record under .sweny/runs/, written once at run end.
  const nodeTimer = createNodeTimer();
  const runId = newRunId(runStart);
  let historyRecorded = false;
  const recordHistory = (results: Map<string, NodeResult>, trace: ExecutionTrace | undefined, crashed: boolean) => {
    if (historyRecorded || historyDisabled(options.history, fileConfig["history"])) return;
    historyRecorded = true;
    try {
      recordRun(
        buildRunRecord({
          runId,
          workflow,
          startedAtMs: runStart,
          durationMs: Date.now() - runStart,
          results,
          trace,
          nodeDurations: nodeTimer.durations,
          crashed,
        }),
      );
    } catch {
      // history must never fail a run
    }
  };

  const observer = composeObservers(
    wfProgressObserver,
    nodeTimer.observer,
    options.verbose ? createVerboseToolObserver() : undefined,
    options.stream ? createStreamObserver() : undefined,
    createCloudStreamObserver(config, wfCloudHandle),
  );

  // #325: this is the primary run path (GitHub Action / CLI / MCP all land
  // here), and previously never passed signal/timeoutMs/max_steps to
  // execute() at all: a wedged node (hung tool call, runaway model turn)
  // could hang the run indefinitely despite the abort/timeout plumbing
  // existing in the executor. --timeout is a whole-run wall-clock budget,
  // enforced by runWithWallClockBudget (shared with the .sweny/e2e/ batch
  // runner in e2e.ts). Absent = DEFAULT_WORKFLOW_TIMEOUT_MS (60 min);
  // `--timeout 0` = no wall-clock budget; junk is rejected above.
  // --max-steps overrides the executor's own DEFAULT_MAX_STEPS when set.
  const wfTimeoutMs = budget.timeoutMs;
  const wfMaxSteps = budget.maxSteps;

  try {
    const { results, trace } = await runWithWallClockBudget(
      (signal) =>
        execute(workflow, workflowInput, {
          skills,
          harness: claude,
          observer,
          logger: runLogger,
          cwd: process.cwd(),
          env: process.env,
          fetchAuth: config.fetchAuth,
          offline: config.offline,
          fileRoot: config.fileRoot || undefined,
          signal,
          max_steps: wfMaxSteps,
          stageOutputs: options.stage === true,
        }),
      wfTimeoutMs,
      `Workflow ${workflow.name}`,
    );

    const wfDurationMs = Date.now() - runStart;
    const wfHasFailed = [...results.values()].some((r) => r.status === "failed");
    recordHistory(results, trace, false);

    // Close the cloud lifecycle session BEFORE the JSON early-exit so
    // every workflow run reports a terminal status, regardless of how
    // the CLI returns (json, mermaid, or normal stdout).
    try {
      await finishCloudLifecycle(config, wfCloudHandle, results, wfDurationMs, wfHasFailed ? "failed" : "success");
    } catch {
      // silent
    }

    // PR billboard markdown (metadata only). Written before any early exit so
    // --json runs and failed runs still get a comment.
    if (options.commentFile) {
      writeRunComment(options.commentFile, workflow, results, summarizeRun(results, wfDurationMs), {
        trace,
        durationsMs: Object.fromEntries(nodeTimer.durations),
      });
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

    // Run receipt (metadata only) + optional $GITHUB_STEP_SUMMARY.
    runLogger.flush();
    const receipt = summarizeRun(results, wfDurationMs);
    writeStepSummary(workflow, results, receipt, trace);
    if (wfHasFailed) {
      console.error(`  ${renderReceiptLine(receipt, isTTY)}\n`);
      process.exit(1);
      return;
    }
    console.log(`  ${renderReceiptLine(receipt, isTTY)}\n`);
    process.exit(0);
  } catch (err) {
    const crashMsg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  Error: ${crashMsg}\n`));
    runLogger.flush();
    recordHistory(nodeTimer.lastResults, undefined, true);
    console.error(`  ${renderReceiptLine(summarizeRun(new Map(), Date.now() - runStart, true), isTTY)}\n`);
    // A crash must not leave a stale success comment behind.
    if (options.commentFile) {
      writeRunComment(options.commentFile, workflow, new Map(), summarizeRun(new Map(), Date.now() - runStart, true), {
        crashed: true,
      });
    }
    // Finalize the cloud run as failed (covers thrown errors, incl.
    // RouteEvaluationError). Without this a crashed workflow run stays
    // "running" in cloud forever.
    try {
      // PRIVACY: pass the raw error, not crashMsg. finishCloudLifecycle reduces it
      // to error.name + a 200-char message: thrown messages can embed agent/LLM
      // prose or log text, and the cloud gets metadata only. It also sends at
      // most one finish per run, so a throw after the in-try finish cannot
      // overwrite the real result with a second "failed".
      await finishCloudLifecycle(config, wfCloudHandle, new Map(), Date.now() - runStart, "failed", err);
    } catch {
      // silent
    }
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
  // Missing skill env is a warning here, not a failure: `run` is where it blocks.
  const warnings = result.ok
    ? skillEnvWarnings(result.workflow, process.env, builtinSkills.concat(configuredSkills(process.env, process.cwd())))
    : [];

  if (options.json) {
    const errs = result.ok ? [] : result.errors;
    const payload: Record<string, unknown> = { valid: result.ok, errors: errs };
    if (warnings.length > 0) payload.warnings = warnings;
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else if (result.ok) {
    console.log(chalk.green(`  \u2713 ${file} is valid`));
    for (const w of warnings) console.error(chalk.yellow(`  \u26A0 ${w}`));
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

const workflowRunCmd = workflowCmd
  .command("run [file]")
  .description(WORKFLOW_RUN_DESCRIPTION)
  .action(workflowRunAction);
for (const [flags, description] of WORKFLOW_RUN_OPTIONS) {
  workflowRunCmd.option(flags, description);
}
workflowRunCmd.option("--no-history", "Do not record this run in .sweny/runs/ (or set `history: off` in .sweny.yml)");
registerRunsCommand(program);

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
    const claude = createHarness("claude-code", {
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
    const claude = createHarness("claude-code", {
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

// ── sweny tool-bridge (hidden, #414) ──────────────────────────────────
// stdio MCP shim a harness starts to reach this run's skill tools over the
// per-run unix socket. Not for humans; started by harness/tool-bridge/server.ts.
program
  .command("tool-bridge", { hidden: true })
  .description("Internal: stdio MCP shim for sweny skill tools")
  .requiredOption("--socket <path>", "Per-run bridge socket")
  .option("--token <token>", "Per-run token (default: SWENY_TOOL_BRIDGE_TOKEN)")
  .action(async (options: { socket: string; token?: string }) => {
    const { runToolBridgeShim } = await import("../harness/tool-bridge/shim.js");
    await runToolBridgeShim({ socket: options.socket, token: options.token, version });
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
