import { workspaceRoot, writeFileNoFollow } from "../safe-file.js";
import type { NodeResult } from "../types.js";
import { writePrCommentSummary } from "../pr-comment-summary.js";

/**
 * Routine metadata belongs in the job summary. Truncate even a previous file:
 * the existing Action poster treats an empty file as a no-op. Review safe
 * outputs own the findings surface; never add a second billboard beside it.
 */
export function writeQuietBillboard(
  file: string,
  workflowId: string,
  results: Map<string, NodeResult>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  writeFileNoFollow(file, "", { ...workspaceRoot(file), mode: 0o644, dirMode: 0o755 });
  const reviewComment = [...results.values()].some(
    (r) => r.toolCalls?.some((call) => call.tool === "github_add_comment") ||
      r.outputs?.some((o) => o.type === "comment" && o.via === "github" && ["applied", "skipped"].includes(o.status)),
  );
  writePrCommentSummary(workflowId, reviewComment ? "billboard" : "empty", env);
  return true;
}
