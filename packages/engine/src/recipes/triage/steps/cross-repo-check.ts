import type { IssueTrackingProvider } from "@sweny/providers/issue-tracking";
import type { SourceControlProvider } from "@sweny/providers/source-control";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig, InvestigationResult } from "../types.js";

/** If the bug belongs to a different repo, dispatch the workflow there and skip remaining act steps. */
export async function crossRepoCheck(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const config = ctx.config;
  const sourceControl = ctx.providers.get<SourceControlProvider>("sourceControl");
  const issueTracker = ctx.providers.get<IssueTrackingProvider>("issueTracker");
  const investigation = ctx.results.get("investigate")?.data as unknown as InvestigationResult | undefined;
  const issueData = ctx.results.get("create-issue")?.data;

  const targetRepo = investigation?.targetRepo;
  const currentRepo = config.repository;

  if (!targetRepo || targetRepo === currentRepo) {
    ctx.logger.info(`Bug belongs to this repo (${currentRepo}) — implementing locally`);
    return { status: "success", data: { dispatched: false } };
  }

  // Cross-repo dispatch
  ctx.logger.info(`Bug belongs to ${targetRepo} (current: ${currentRepo}) — dispatching cross-repo`);

  try {
    await sourceControl.dispatchWorkflow({
      targetRepo,
      workflow: "SWEny Triage",
      inputs: {
        linear_issue: (issueData?.issueIdentifier as string) ?? "",
        dispatched_from: currentRepo,
        novelty_mode: "false",
      },
    });

    // Add comment noting the cross-repo handoff
    if (issueData?.issueId) {
      await issueTracker.updateIssue(issueData.issueId as string, {
        comment: `Cross-repo dispatch: Discovered in \`${currentRepo}\`, dispatched to \`${targetRepo}\` for implementation.`,
      });
    }
  } catch (err) {
    ctx.logger.warn(`Cross-repo dispatch failed: ${err}`);
  }

  // Skip remaining act steps — implementation happens in the target repo
  ctx.skipPhase("act", `Cross-repo dispatch to ${targetRepo}`);

  return {
    status: "success",
    data: { dispatched: true, targetRepo },
  };
}
