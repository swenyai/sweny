/**
 * Run-end output for `sweny workflow run`: the receipt line, the
 * GITHUB_STEP_SUMMARY writer, the quiet-by-default logger, and the help text.
 *
 * METADATA ONLY. Nothing here reads prompts, node outputs, tool inputs, or
 * model prose: only counts, durations, token totals, and cost.
 */

import fs from "node:fs";
import chalk from "chalk";
import { consoleLogger, type ExecutionTrace, type Logger, type NodeResult, type Workflow } from "../types.js";
import { toMermaidBlock, type NodeStatus } from "../mermaid.js";

// ── Receipt ─────────────────────────────────────────────────────

export interface RunSummary {
  ok: boolean;
  nodesOk: number;
  nodesTotal: number;
  nodesSkipped: number;
  toolCalls: number;
  durationMs: number;
  /** input + output tokens. Undefined when no node reported usage. */
  tokens?: number;
  /** Sum of SDK-reported cost. Undefined when the SDK reported none (never estimated). */
  costUsd?: number;
  /** Harness that ran the nodes, when a result was tagged. */
  harness?: string;
  /**
   * Opinions some node's harness could not honor natively, as short keys
   * (`max_turns`, `egress allowlist`, `deny [write]`). Absent when none.
   */
  degraded?: string[];
}

/** The short key of a `degraded` entry: the text before its first colon. */
export function degradedKey(entry: string): string {
  const i = entry.indexOf(":");
  return (i === -1 ? entry : entry.slice(0, i)).trim();
}

/** Sum the per-node results into one run summary. */
export function summarizeRun(results: Map<string, NodeResult>, durationMs: number, crashed = false): RunSummary {
  let nodesOk = 0;
  let nodesSkipped = 0;
  let failed = crashed;
  let toolCalls = 0;
  let tokens: number | undefined;
  let costUsd: number | undefined;
  let harness: string | undefined;
  const degraded = new Set<string>();
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

  for (const r of results.values()) {
    harness ??= r.harness?.id;
    for (const d of r.degraded ?? []) degraded.add(degradedKey(d));
    if (r.status === "success") nodesOk++;
    else if (r.status === "skipped") nodesSkipped++;
    else failed = true;
    toolCalls += r.toolCalls?.length ?? 0;
    const u = r.usage;
    if (u) {
      if (isNum(u.inputTokens) || isNum(u.outputTokens)) {
        tokens =
          (tokens ?? 0) + (isNum(u.inputTokens) ? u.inputTokens : 0) + (isNum(u.outputTokens) ? u.outputTokens : 0);
      }
      if (isNum(u.costUsd)) costUsd = (costUsd ?? 0) + u.costUsd;
    }
  }

  return {
    ok: !failed,
    nodesOk,
    nodesTotal: results.size,
    nodesSkipped,
    toolCalls,
    durationMs,
    ...(tokens !== undefined ? { tokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(harness !== undefined ? { harness } : {}),
    ...(degraded.size > 0 ? { degraded: [...degraded] } : {}),
  };
}

export function formatReceiptDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${Math.round(n / 100) / 10}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n / 100_000) / 10}M`;
}

export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/**
 * One plain line: `✓ 3/3 nodes · 41 tool calls · 2m10s · 12k tokens · $0.18`.
 * Token and cost segments are omitted when the SDK reported none. A harness
 * other than Claude Code is named, and anything it could not honor natively
 * is listed (`· codex · degraded: max_turns`). No ANSI; callers colorize only
 * when writing to a TTY.
 */
export function formatReceipt(s: RunSummary): string {
  const parts = [
    `${s.ok ? "✓" : "✗"} ${s.nodesOk}/${s.nodesTotal} nodes`,
    ...(s.nodesSkipped > 0 ? [`${s.nodesSkipped} skipped`] : []),
    `${s.toolCalls} tool ${s.toolCalls === 1 ? "call" : "calls"}`,
    formatReceiptDuration(s.durationMs),
    ...(s.tokens !== undefined ? [`${formatTokenCount(s.tokens)} tokens`] : []),
    ...(s.costUsd !== undefined ? [formatCost(s.costUsd)] : []),
    ...(s.harness !== undefined && s.harness !== "claude-code" ? [s.harness] : []),
    ...(s.degraded && s.degraded.length > 0 ? [`degraded: ${s.degraded.join(", ")}`] : []),
  ];
  return parts.join(" · ");
}

/** Receipt for a terminal: colored only when `color` is true. */
export function renderReceiptLine(s: RunSummary, color: boolean): string {
  const line = formatReceipt(s);
  if (!color) return line;
  return s.ok ? chalk.green(line) : chalk.red(line);
}

// ── Step summary ────────────────────────────────────────────────

/** Brand blue (blue-600 / blue-700), not indigo. Applied to successful nodes. */
export const STEP_SUMMARY_CLASS_DEFS = {
  success: "fill:#2563eb,stroke:#1d4ed8,color:#fff,stroke-width:2px",
} as const;

/** Per-node Mermaid status from run results. */
export function nodeStates(results: Map<string, NodeResult>): Record<string, NodeStatus> {
  const state: Record<string, NodeStatus> = {};
  for (const [id, r] of results) {
    state[id] = r.status === "success" ? "success" : r.status === "failed" ? "failed" : "skipped";
  }
  return state;
}

/** Markdown for `$GITHUB_STEP_SUMMARY`: receipt + status-colored Mermaid DAG. */
export function formatStepSummary(
  workflow: Workflow,
  results: Map<string, NodeResult>,
  summary: RunSummary,
  trace?: ExecutionTrace,
): string {
  const state = nodeStates(results);
  return [
    `## ${summary.ok ? "✅" : "❌"} ${workflow.name}`,
    "",
    `\`${formatReceipt(summary)}\``,
    "",
    toMermaidBlock(workflow, { state, trace, classDefs: STEP_SUMMARY_CLASS_DEFS }),
    "",
    "",
  ].join("\n");
}

/**
 * Append the step summary to the file named by GITHUB_STEP_SUMMARY.
 * Runner-agnostic: does nothing when the variable is unset or empty.
 * Never throws; returns true only when something was written.
 */
export function writeStepSummary(
  workflow: Workflow,
  results: Map<string, NodeResult>,
  summary: RunSummary,
  trace?: ExecutionTrace,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  try {
    fs.appendFileSync(file, formatStepSummary(workflow, results, summary, trace));
    return true;
  } catch (err) {
    process.stderr.write(`  ⚠ could not write GITHUB_STEP_SUMMARY: ${err instanceof Error ? err.message : err}\n`);
    return false;
  }
}

// ── Logger ──────────────────────────────────────────────────────

export interface RunLogger extends Logger {
  /** Write any warnings held back while a node line was live. */
  flush(): void;
}

/**
 * Logger for `workflow run`. With `verbose`, the raw `[info]`/`[debug]` lines
 * pass through unchanged. Otherwise info/debug are dropped and warnings and
 * errors are rendered as `  ⚠ msg` / `  ✗ msg` on stderr. On a TTY they are held
 * while a node line is live (the progress line is redrawn in place) and written
 * by `flush()` after the node exits.
 */
export function createRunLogger(opts: { verbose: boolean; tty: boolean; write?: (s: string) => void }): RunLogger {
  const write = opts.write ?? ((s: string) => void process.stderr.write(s));
  if (opts.verbose) return { ...consoleLogger, flush() {} };

  const held: string[] = [];
  const emit = (line: string) => {
    if (opts.tty) held.push(line);
    else write(line);
  };
  const noop = () => {};
  return {
    info: noop,
    debug: noop,
    warn: (msg) => emit(`  ${chalk.yellow("⚠")} ${msg.trim()}\n`),
    error: (msg) => emit(`  ${chalk.red("✗")} ${msg.trim()}\n`),
    flush() {
      while (held.length) write(held.shift()!);
    },
  };
}

// ── Help text ───────────────────────────────────────────────────

export const WORKFLOW_RUN_DESCRIPTION =
  "Run a workflow from a YAML or JSON file. With no file, batch-runs every workflow in .sweny/e2e/ (lists and confirms first; use --yes to skip the prompt).";

export const WORKFLOW_RUN_OPTIONS: ReadonlyArray<readonly [flags: string, description: string]> = [
  [
    "--timeout <ms>",
    "Whole-run wall-clock timeout in ms. Applies to batch runs (.sweny/e2e/) and to a single workflow file (default: 3600000 = 60 min; 0 = no wall-clock budget)",
  ],
  [
    "--max-steps <n>",
    "Hard cap on total node executions for a single workflow file, including eval-failure retries (default: 200)",
  ],
  ["-y, --yes", "Skip the batch confirmation prompt (for CI)"],
  [
    "--dry-run",
    "Run with read-only tools only: write tools, external MCP servers, and shell/file-edit tools are withheld, so nothing is created, posted, or sent. Stops at the first conditional edge. To inspect nodes without running, use --list-nodes.",
  ],
  [
    "--stage",
    "Run normally, but preview every safe output (nodes with outputs:) instead of writing it: print what would be written and write nothing",
  ],
  ["--list-nodes", "Validate, print nodes and skills, and exit without running"],
  ["--json", "Output result as JSON on stdout; suppress progress output"],
  ["--stream", "Stream NDJSON events to stdout (for Studio / automation)"],
  [
    "--verbose",
    "Show raw log lines and each tool call's input and output inline (human-readable, truncated). Use --stream for full untruncated NDJSON.",
  ],
  ["--mermaid", "Output a Mermaid diagram with execution state after run"],
  [
    "--comment-file <path>",
    "Write a PR-comment markdown (run receipt, status-colored DAG, per-node table; metadata only) to <path> so any CI can post it",
  ],
  ["--input <json>", "JSON string of input data to pass to the workflow"],
  ["--agent <id>", "Coding agent that runs the nodes: claude (default), codex, or pi (experimental)"],
  [
    "--harness-policy <mode>",
    "strict: refuse a node whose policy the agent cannot enforce; warn: run it and report what was not enforced (default: strict under GitHub Actions, warn elsewhere; env SWENY_HARNESS_POLICY)",
  ],
];
