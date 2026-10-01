/**
 * Run-end output for `sweny workflow run`: the receipt line, the
 * GITHUB_STEP_SUMMARY writer, the quiet-by-default logger, and the help text.
 *
 * METADATA ONLY. Nothing here reads prompts, node outputs, tool inputs, or
 * model prose: only counts, durations, token totals, and cost.
 */

import { workspaceRoot, writeFileNoFollow } from "../safe-file.js";
import { consoleLogger, type ExecutionTrace, type Logger, type NodeResult, type Workflow } from "../types.js";
import { toMermaidBlock, type NodeStatus } from "../mermaid.js";
import { createPaint } from "./style.js";
import { colorEnabled, glyphs } from "./terminal.js";
import { trustedEnvValue } from "../startup-env.js";

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
  /**
   * What the run's opinions did, from facts the nodes reported: env scope and
   * sandbox (Claude Code only) and safe-output counts. Absent when the run
   * knows none of it.
   */
  policy?: RunPolicy;
  /** The spend budget a node crossed (#449). Absent when none was. */
  budget?: { node: string; scope: "node" | "run"; unit: "tokens" | "cost_usd"; limit: number; spent: number };
  /**
   * Who decided the run's conditional routes (#357), counts only: a `when`
   * expression, the decision model, or the agent. The decider and expression
   * counts are routes with no agent call. Absent when no route was a decision.
   */
  routes?: RouteCounts;
  /** Why the decider did not run for some or all routes (missing config, breaker, cap). */
  deciderOff?: string;
}

export interface RouteCounts {
  total: number;
  decider: number;
  expr: number;
  agent: number;
}

export interface RunPolicy {
  /** Agent env narrowed to the allowlist. Absent when no node reported it. */
  envScope?: boolean;
  /** Sandbox facts. `started` is false when the mode asked for one but the host could not. */
  sandbox?: { mode: "off" | "auto" | "strict"; started: boolean };
  /** Safe outputs staged (previewed) and applied (written), summed over nodes. */
  outputs?: { staged: number; applied: number };
}

/** The short key of a `degraded` entry: the text before its first colon. */
export function degradedKey(entry: string): string {
  const i = entry.indexOf(":");
  return (i === -1 ? entry : entry.slice(0, i)).trim();
}

/** Sum the per-node results into one run summary. */
export function summarizeRun(
  results: Map<string, NodeResult>,
  durationMs: number,
  crashed = false,
  trace?: ExecutionTrace,
): RunSummary {
  let nodesOk = 0;
  let nodesSkipped = 0;
  let failed = crashed;
  let toolCalls = 0;
  let tokens: number | undefined;
  let costUsd: number | undefined;
  let harness: string | undefined;
  const degraded = new Set<string>();
  let budget: RunSummary["budget"];
  const policy: RunPolicy = {};
  let staged = 0;
  let applied = 0;
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

  for (const [nodeId, r] of results) {
    if (r.budget && !budget) budget = { node: nodeId, ...r.budget };
    harness ??= r.harness?.id;
    for (const d of r.degraded ?? []) degraded.add(degradedKey(d));
    if (r.policy) {
      // Any node that ran unscoped or unsandboxed counts: the receipt must not overstate.
      policy.envScope = policy.envScope === undefined ? r.policy.envScope : policy.envScope && r.policy.envScope;
      const sb = { mode: r.policy.sandbox, started: r.policy.sandboxStarted };
      // Keep the weakest node: the first one that did not run sandboxed.
      if (!policy.sandbox || (policy.sandbox.started && !sb.started)) policy.sandbox = sb;
    }
    for (const o of r.outputs ?? []) {
      if (o.status === "staged") staged++;
      else if (o.status === "applied") applied++;
    }
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

  if (staged > 0 || applied > 0) policy.outputs = { staged, applied };

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
    ...(Object.keys(policy).length > 0 ? { policy } : {}),
    ...(budget ? { budget } : {}),
    ...(trace && countRoutes(trace).total > 0 ? { routes: countRoutes(trace) } : {}),
    ...(trace?.deciderOff ? { deciderOff: trace.deciderOff } : {}),
  };
}

/** Conditional routes by rung. Unconditional edges decide nothing and are not counted. */
export function countRoutes(trace: ExecutionTrace): RouteCounts {
  const c: RouteCounts = { total: 0, decider: 0, expr: 0, agent: 0 };
  for (const e of trace.edges) {
    if (!e.rung) continue;
    c.total++;
    c[e.rung]++;
  }
  return c;
}

/**
 * The policy facts the run knew, as short phrases: `env scoped`, `sandbox on`,
 * `1 output staged`. No phrase for a fact no node reported.
 */
export function policyParts(p: RunPolicy | undefined): string[] {
  if (!p) return [];
  const parts: string[] = [];
  if (p.envScope !== undefined) parts.push(p.envScope ? "env scoped" : "env unscoped");
  if (p.sandbox) {
    parts.push(
      p.sandbox.mode === "off"
        ? "sandbox off"
        : p.sandbox.started
          ? "sandbox on"
          : "sandbox unavailable (ran unsandboxed)",
    );
  }
  if (p.outputs) {
    const n = (count: number) => `${count} ${count === 1 ? "output" : "outputs"}`;
    if (p.outputs.staged > 0) parts.push(`${n(p.outputs.staged)} staged`);
    if (p.outputs.applied > 0) parts.push(`${n(p.outputs.applied)} applied`);
  }
  return parts;
}

/**
 * `policy: env scoped, sandbox on, 1 output staged`. Only what the run knew:
 * no segment for a fact no node reported. Undefined when there is nothing to say.
 */
export function formatPolicySegment(p: RunPolicy | undefined): string | undefined {
  const parts = policyParts(p);
  return parts.length > 0 ? `policy: ${parts.join(", ")}` : undefined;
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

/** `tokens 52k of 50k`: the overrun, in the budget's unit. */
export function formatBudgetAmount(b: NonNullable<RunSummary["budget"]>): string {
  const amount = (n: number) =>
    b.unit === "cost_usd" ? (n < 0.01 ? `$${n.toFixed(4)}` : formatCost(n)) : formatTokenCount(n);
  const unit = b.unit === "cost_usd" ? "cost" : "tokens";
  return `${unit} ${amount(b.spent)} of ${amount(b.limit)}`;
}

/** `budget exceeded: tokens 52k of 50k (run, at node gather)`. */
export function formatBudgetOverrun(b: NonNullable<RunSummary["budget"]>): string {
  return `budget exceeded: ${formatBudgetAmount(b)} (${b.scope}, at node ${b.node})`;
}

/** `5 (3 decider, 1 expr, 1 agent)`: zero rungs are left out. */
export function formatRouteCounts(r: RouteCounts): string {
  const parts = (["decider", "expr", "agent"] as const).filter((k) => r[k] > 0).map((k) => `${r[k]} ${k}`);
  return parts.length > 0 ? `${r.total} (${parts.join(", ")})` : String(r.total);
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
    ...(formatPolicySegment(s.policy) ? [formatPolicySegment(s.policy)!] : []),
    ...(s.budget ? [formatBudgetOverrun(s.budget)] : []),
    ...(s.routes && s.routes.total > 0 ? [`routes ${formatRouteCounts(s.routes)}`] : []),
    ...(s.deciderOff ? [`decider off: ${s.deciderOff}`] : []),
  ];
  return parts.join(" · ");
}

/** Receipt for a terminal: in the success or error color only when `color` is true. */
export function renderReceiptLine(s: RunSummary, color: boolean): string {
  const line = formatReceipt(s);
  if (!color) return line;
  const paint = createPaint(true);
  return s.ok ? paint.success(line) : paint.error(line);
}

// ── Step summary ────────────────────────────────────────────────

/** Per-node Mermaid status from run results. */
export function nodeStates(results: Map<string, NodeResult>): Record<string, NodeStatus> {
  const state: Record<string, NodeStatus> = {};
  for (const [id, r] of results) {
    state[id] = r.status === "success" ? "success" : r.status === "failed" ? "failed" : "skipped";
  }
  return state;
}

/** Markdown for `$GITHUB_STEP_SUMMARY`: receipt + Mermaid DAG in the brand classDefs. */
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
    toMermaidBlock(workflow, { state, trace }),
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
  // The operator's value only: never one a workspace `.env` introduced.
  const file = trustedEnvValue(env, "GITHUB_STEP_SUMMARY");
  if (!file) return false;
  try {
    // Never through a link, in case the path sits in the agent-writable workspace.
    writeFileNoFollow(file, formatStepSummary(workflow, results, summary, trace), {
      ...workspaceRoot(file),
      append: true,
      mkdirs: false,
      mode: 0o644,
    });
    return true;
  } catch (err) {
    process.stderr.write(
      `  ${glyphs().warning} could not write GITHUB_STEP_SUMMARY: ${err instanceof Error ? err.message : err}\n`,
    );
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
export function createRunLogger(opts: {
  verbose: boolean;
  tty: boolean;
  /** Color the markers. Default: `tty` and color is enabled for stderr. */
  color?: boolean;
  write?: (s: string) => void;
}): RunLogger {
  const write = opts.write ?? ((s: string) => void process.stderr.write(s));
  if (opts.verbose) return { ...consoleLogger, flush() {} };

  const paint = createPaint(opts.color ?? (opts.tty && colorEnabled(process.stderr)));
  const g = glyphs();
  const held: string[] = [];
  const emit = (line: string) => {
    if (opts.tty) held.push(line);
    else write(line);
  };
  const noop = () => {};
  return {
    info: noop,
    debug: noop,
    warn: (msg) => emit(`  ${paint.warning(g.warning)} ${msg.trim()}\n`),
    error: (msg) => emit(`  ${paint.error(g.failure)} ${msg.trim()}\n`),
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
  [
    "--max-tokens <n>",
    "Run-wide token budget (input plus output) for a single workflow file. The lowest of this and the workflow's budget.tokens wins. A crossing stops the agent, fails the node and halts the run",
  ],
  [
    "--max-cost <usd>",
    "Run-wide cost budget in US dollars for a single workflow file, from harness-reported cost (never estimated). The lowest of this and the workflow's budget.cost_usd wins",
  ],
  ["-y, --yes", "Skip the batch confirmation prompt (for CI)"],
  [
    "--dry-run",
    "Run with read-only tools only: write tools, external MCP servers, and shell/file-edit tools are withheld, so nothing is created, posted, or sent. Stops at the first natural-language conditional edge. To inspect nodes without running, use --list-nodes.",
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
  ["--no-decider", "Skip the decision model for this run: the agent decides the routes of route_by: decider nodes"],
];
