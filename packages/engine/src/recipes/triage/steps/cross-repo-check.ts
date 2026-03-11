import type { IssueTrackingProvider } from "@sweny-ai/providers/issue-tracking";
import type { RepoProvider } from "@sweny-ai/providers/source-control";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";
import { getStepData } from "../results.js";

/** If the bug belongs to a different repo, dispatch the workflow there and skip remaining act steps. */
export async function crossRepoCheck(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const config = ctx.config;
  const sourceControl = ctx.providers.get<RepoProvider>("sourceControl");
  const issueTracker = ctx.providers.get<IssueTrackingProvider>("issueTracker");
  const investigation = getStepData(ctx, "investigate");
  const issueData = getStepData(ctx, "create-issue");

  const targetRepo = investigation?.targetRepo;
  const currentRepo = config.repository;

  if (!targetRepo || targetRepo === currentRepo) {
    ctx.logger.info(`Bug belongs to this repo (${currentRepo}) — implementing locally`);
    return { status: "success", data: { outcome: "local", dispatched: false } };
  }

  // Cross-repo dispatch
  ctx.logger.info(`Bug belongs to ${targetRepo} (current: ${currentRepo}) — dispatching cross-repo`);

  try {
    await sourceControl.dispatchWorkflow({
      targetRepo,
      workflow: "SWEny Triage",
      inputs: {
        linear_issue: issueData?.issueIdentifier ?? "",
        dispatched_from: currentRepo,
        novelty_mode: "false",
      },
    });

    // Add comment noting the cross-repo handoff
    if (issueData?.issueId) {
      await issueTracker.updateIssue(issueData.issueId, {
        comment: `Cross-repo dispatch: Discovered in \`${currentRepo}\`, dispatched to \`${targetRepo}\` for implementation.`,
      });
    }
  } catch (err) {
    ctx.logger.warn(`Cross-repo dispatch failed: ${err}`);
  }

  return {
    status: "success",
    data: { outcome: "dispatched", dispatched: true, targetRepo },
  };
}
