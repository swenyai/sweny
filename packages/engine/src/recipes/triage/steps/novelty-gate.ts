import type { IssueTrackingProvider } from "@sweny/providers/issue-tracking";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig, InvestigationResult } from "../types.js";

/** Check investigation recommendation and decide whether to proceed with implementation. */
export async function noveltyGate(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const issueTracker = ctx.providers.get<IssueTrackingProvider>("issueTracker");
  const investigation = ctx.results.get("investigate")?.data as unknown as InvestigationResult | undefined;

  if (!investigation) {
    ctx.skipPhase("act", "No investigation result");
    return { status: "failed", reason: "No investigation result available" };
  }

  const recommendation = investigation.recommendation;

  // SKIP — no novel issues
  if (/skip/i.test(recommendation)) {
    ctx.logger.info("Recommendation is SKIP — no novel issues found");
    ctx.skipPhase("act", "Recommendation: skip");
    return {
      status: "success",
      data: { action: "skip", recommendation },
    };
  }

  // +1 EXISTING — add occurrence to existing issue
  if (/\+1 existing/i.test(recommendation)) {
    ctx.logger.info(`Recommendation is +1 EXISTING — adding occurrence to ${investigation.existingIssue}`);

    if (investigation.existingIssue) {
      try {
        const existing = await issueTracker.getIssue(investigation.existingIssue);
        const date = new Date().toISOString().split("T")[0];
        await issueTracker.addComment(existing.id, `+1 detected on ${date}`);
        ctx.logger.info(`Added +1 occurrence to ${investigation.existingIssue}`);
      } catch (err) {
        ctx.logger.warn(`Failed to add occurrence: ${err}`);
      }
    }

    ctx.skipPhase("act", `+1 existing ${investigation.existingIssue}`);
    return {
      status: "success",
      data: {
        action: "+1",
        recommendation,
        issueIdentifier: investigation.existingIssue,
      },
    };
  }

  // IMPLEMENT — proceed with fix
  ctx.logger.info("Recommendation is IMPLEMENT — proceeding with fix");
  return {
    status: "success",
    data: { action: "implement", recommendation },
  };
}
