import type { IssueTrackingProvider } from "@sweny-ai/providers/issue-tracking";
import type { SourceControlProvider } from "@sweny-ai/providers/source-control";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { ImplementConfig } from "../types.js";

/** Verify that issue tracker and source control providers are reachable. */
export async function verifyAccess(ctx: WorkflowContext<ImplementConfig>): Promise<StepResult> {
  const issueTracker = ctx.providers.get<IssueTrackingProvider>("issueTracker");
  await issueTracker.verifyAccess();
  ctx.logger.info("Issue tracker access verified");

  const sourceControl = ctx.providers.get<SourceControlProvider>("sourceControl");
  await sourceControl.verifyAccess();
  ctx.logger.info("Source control access verified");

  return { status: "success" };
}
