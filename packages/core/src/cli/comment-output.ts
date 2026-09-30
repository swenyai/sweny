/**
 * PR billboard: the markdown a CI runner posts as one sticky comment on a
 * pull request. Pure and runner-agnostic; the CLI writes it with
 * `--comment-file`, and any runner (the GitHub Action, GitLab, a script) posts it.
 *
 * METADATA ONLY. Node names, statuses, counts, and durations. Never prompts,
 * tool inputs, node outputs, errors, or model prose.
 */

import fs from "node:fs";
import path from "node:path";
import type { ExecutionTrace, NodeResult, Workflow } from "../types.js";
import { toMermaidBlock } from "../mermaid.js";
import {
  STEP_SUMMARY_CLASS_DEFS,
  formatReceipt,
  formatReceiptDuration,
  nodeStates,
  type RunSummary,
} from "./run-output.js";

export const RUN_COMMENT_FOOTER = "Run with [SWEny](https://sweny.ai): `npx @sweny-ai/core new`";

export interface RunCommentOptions {
  trace?: ExecutionTrace;
  /** Per-node wall-clock duration in ms, keyed by node id. Missing entries render as "-". */
  durationsMs?: Record<string, number>;
}

/** Hidden marker the poster searches for to update the comment in place. */
export function runCommentMarker(workflowId: string): string {
  const safe = workflowId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/-{2,}/g, "-") || "workflow";
  return `<!-- sweny-run-comment:${safe} -->`;
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
    `\`${formatReceipt(summary)}\``,
    "",
    toMermaidBlock(workflow, { state, trace: opts.trace, classDefs: STEP_SUMMARY_CLASS_DEFS }),
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
export function formatCrashComment(workflow: Workflow, summary: RunSummary): string {
  return [
    runCommentMarker(workflow.id),
    `## ❌ ${cell(workflow.name)}`,
    "",
    `\`${formatReceipt(summary)} · crashed\``,
    "",
    "The run stopped before finishing. See the job log for details.",
    "",
    `<sub>${RUN_COMMENT_FOOTER}</sub>`,
    "",
  ].join("\n");
}

/** Write the comment markdown to `file`. Never throws; returns true only when written. */
export function writeRunComment(
  file: string,
  workflow: Workflow,
  results: Map<string, NodeResult>,
  summary: RunSummary,
  opts: RunCommentOptions & { crashed?: boolean } = {},
): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      opts.crashed ? formatCrashComment(workflow, summary) : formatRunComment(workflow, results, summary, opts),
    );
    return true;
  } catch (err) {
    process.stderr.write(`  ⚠ could not write comment file: ${err instanceof Error ? err.message : err}\n`);
    return false;
  }
}
