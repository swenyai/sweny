/**
 * PR billboard. Quiet by default (#536): `--comment-file` now writes an empty
 * file, so the Action's poster (scripts/post-run-comment.sh skips an empty
 * file) adds nothing to the PR. The receipt and DAG go to the job summary, and
 * findings go in the workflow's one updating comment (pr-comment.ts). The
 * formatters below remain for the offline demo (`sweny try`).
 *
 * METADATA ONLY. Node names, statuses, counts, and durations. Never prompts,
 * tool inputs, node outputs, errors, or model prose. The optional "since last
 * run" line carries counts of added and resolved answers, never their text.
 */

import type { ExecutionTrace, NodeResult, Workflow } from "../types.js";
import { toMermaidBlock } from "../mermaid.js";
import { formatReceiptDuration, nodeStates, type RunSummary } from "./run-output.js";
import { formatTicketText } from "./ticket.js";
import { glyphs } from "./terminal.js";
import { workspaceRoot, writeFileNoFollow } from "../safe-file.js";
import { prCommentMarker } from "../pr-comment.js";

export const RUN_COMMENT_FOOTER = "Run with [SWEny](https://github.com/swenyai/sweny): `npx @sweny-ai/core new`";

export interface RunCommentOptions {
  trace?: ExecutionTrace;
  /** Per-node wall-clock duration in ms, keyed by node id. Missing entries render as "-". */
  durationsMs?: Record<string, number>;
  /** Run id; the ticket shows its short hash. */
  runId?: string;
  /** Pre-rendered "since last run" markdown line (run-answers.ts formatSinceLastMarkdown): counts only. */
  sinceLast?: string | null;
}

/** The receipt ticket as a fenced block, the same card a TTY run ends on. */
function ticketBlock(workflow: Workflow, summary: RunSummary, runId?: string, crashed?: boolean): string {
  return ["```text", formatTicketText({ summary, workflow: workflow.id, runId, crashed }), "```"].join("\n");
}

/** Hidden marker the poster searches for to update the comment in place (the findings comment's marker too). */
export const runCommentMarker = prCommentMarker;

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
    ...(opts.sinceLast ? [opts.sinceLast, ""] : []),
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

/**
 * Write an empty comment file: no metadata-only comment on the PR. Truncates a
 * file an earlier step left there. Never throws; returns true only when written.
 */
export function writeRunComment(file: string): boolean {
  try {
    // The file may sit in the agent-writable workspace: no link on the path is followed.
    writeFileNoFollow(file, "", { ...workspaceRoot(file), mode: 0o644, dirMode: 0o755 });
    return true;
  } catch (err) {
    process.stderr.write(
      `  ${glyphs().warning} could not write comment file: ${err instanceof Error ? err.message : err}\n`,
    );
    return false;
  }
}
