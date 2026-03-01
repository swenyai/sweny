import type { ObservabilityProvider } from "@swenyai/providers/observability";
import type { IssueTrackingProvider } from "@swenyai/providers/issue-tracking";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";

/** Verify that observability and issue tracker providers are reachable. */
export async function verifyAccess(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const observability = ctx.providers.get<ObservabilityProvider>("observability");
  await observability.verifyAccess();
  ctx.logger.info("Observability provider access verified");

  const issueTracker = ctx.providers.get<IssueTrackingProvider>("issueTracker");
  await issueTracker.verifyAccess();
  ctx.logger.info("Issue tracker access verified");

  return { status: "success" };
}
