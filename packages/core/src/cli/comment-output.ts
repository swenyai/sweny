/**
 * Legacy metadata billboard formatter (also used by the offline demo).
 * Actual CLI comment-file writes delegate to quiet-comment: routine metadata
 * stays in the job summary and review outputs own the PR findings comment.
 *
 * METADATA ONLY. Node names, statuses, counts, and durations. Never prompts,
 * tool inputs, node outputs, errors, or model prose.
 */

import type { ExecutionTrace, NodeResult, Workflow } from "../types.js";
import { toMermaidBlock } from "../mermaid.js";
import { formatReceiptDuration, nodeStates, type RunSummary } from "./run-output.js";
import { formatTicketText } from "./ticket.js";
import { glyphs } from "./terminal.js";
import { prCommentMarker } from "../pr-comment.js";
import { writeQuietBillboard } from "./quiet-comment.js";

export const RUN_COMMENT_FOOTER = "Run with [SWEny](https://github.com/swenyai/sweny): `npx @sweny-ai/core new`";

export interface RunCommentOptions {
  trace?: ExecutionTrace;
  /** Per-node wall-clock duration in ms, keyed by node id. Missing entries render as "-". */
  durationsMs?: Record<string, number>;
  /** Run id; the ticket shows its short hash. */
  runId?: string;
}

/** The receipt ticket as a fenced block, the same card a TTY run ends on. */
function ticketBlock(workflow: Workflow, summary: RunSummary, runId?: string, crashed?: boolean): string {
  return ["```text", formatTicketText({ summary, workflow: workflow.id, runId, crashed }), "```"].join("\n");
}

/** Hidden marker the poster searches for to update the comment in place. */
export function runCommentMarker(workflowId: string): string {
  return prCommentMarker(workflowId);
}

/** Table-cell-safe text: no pipes, newlines, or backticks. */
function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").replace(/`/g, "'").trim();
}

const STATUS_LABEL = { success: "✅ success", failed: "❌ failed", skipped: "⏭️ skipped" } as const;

export function formatRunComment(
  workflow: Workflow,
  results: Map<string, NodeResult>,
  summary: RunSummary,
  opts: RunCommentOptions = {},
): string {
  const state = nodeStates(results);
  const rows = [...results].map(([id, r]) => {
    const name = cell(workflow.nodes[id]?.name ?? id);
    const ms = opts.durationsMs?.[id];
    const dur = typeof ms === "number" && Number.isFinite(ms) ? formatReceiptDuration(ms) : "-";
    return `| ${name} | ${STATUS_LABEL[r.status]} | ${dur} |`;
  });

  return [
    runCommentMarker(workflow.id),
    `## ${summary.ok ? "✅" : "❌"} ${cell(workflow.name)}`,
    "",
    ticketBlock(workflow, summary, opts.runId),
    "",
    toMermaidBlock(workflow, { state, trace: opts.trace }),
    "",
    "<details>",
    "<summary>Nodes</summary>",
    "",
    "| Node | Status | Duration |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "</details>",
    "",
    `<sub>${RUN_COMMENT_FOOTER}</sub>`,
    "",
  ].join("\n");
}

/**
 * Minimal comment for a run that crashed before producing node results: no DAG
 * and no error text (thrown messages can embed model prose). Replaces any stale
 * success comment for the same workflow.
 */
export function formatCrashComment(workflow: Workflow, summary: RunSummary, runId?: string): string {
  return [
    runCommentMarker(workflow.id),
    `## ❌ ${cell(workflow.name)}`,
    "",
    ticketBlock(workflow, summary, runId, true),
    "",
    "The run stopped before finishing. See the job log for details.",
    "",
    `<sub>${RUN_COMMENT_FOOTER}</sub>`,
    "",
  ].join("\n");
}

/** Suppress the metadata billboard; review outputs own the findings comment. Never throws. */
export function writeRunComment(
  file: string,
  workflow: Workflow,
  results: Map<string, NodeResult>,
  _summary: RunSummary,
  _opts: RunCommentOptions & { crashed?: boolean } = {},
): boolean {
  try {
    return writeQuietBillboard(file, workflow.id, results);
  } catch (err) {
    process.stderr.write(
      `  ${glyphs().warning} could not write comment file: ${err instanceof Error ? err.message : err}\n`,
    );
    return false;
  }
}
