import { workspaceRoot, writeFileNoFollow } from "./safe-file.js";
import { trustedEnvValue } from "./startup-env.js";
import type { PrCommentStatus } from "./pr-comment.js";

/** Runner-owned summary only. No findings or model prose are copied here. */
export function writePrCommentSummary(
  workflowId: string,
  status: PrCommentStatus | "billboard",
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const file = trustedEnvValue(env, "GITHUB_STEP_SUMMARY");
  if (!file) return false;
  const message = {
    empty: "PR comment skipped: no findings. Receipt metadata is in this job summary.",
    unchanged: "PR comment skipped: findings unchanged since the last post.",
    created: "PR comment created with findings.",
    updated: "PR comment updated in place with new findings.",
    billboard:
      "PR billboard skipped: review findings use the updating workflow comment. Receipt metadata is in this job summary.",
  }[status];
  const label = workflowId.replace(/[\r\n`<>]/g, "_");
  try {
    writeFileNoFollow(file, `\n**${label}**: ${message}\n\n`, {
      ...workspaceRoot(file),
      append: true,
      mkdirs: false,
      mode: 0o644,
    });
    return true;
  } catch {
    return false;
  }
}
