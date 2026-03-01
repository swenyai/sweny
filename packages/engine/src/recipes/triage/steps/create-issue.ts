import * as fs from "fs";
import type { Issue, IssueTrackingProvider } from "@swenyai/providers/issue-tracking";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";

/** Extract issue title from best-candidate.md, then get-or-create an issue in the tracker. */
export async function createIssue(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const config = ctx.config;
  const issueTracker = ctx.providers.get<IssueTrackingProvider>("issueTracker");

  // -------------------------------------------------------------------------
  // 1. Extract issue title from best-candidate.md
  // -------------------------------------------------------------------------
  let issueTitle = "SWEny Triage: Automated bug fix";

  if (!config.issueOverride) {
    const bestCandidatePath = ".github/triage-analysis/best-candidate.md";
    if (fs.existsSync(bestCandidatePath)) {
      const content = fs.readFileSync(bestCandidatePath, "utf-8");
      const headingMatch = content.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        issueTitle = headingMatch[1]
          .replace(/`/g, "")
          .replace(/^(Best\s+)?(Fix\s+)?(Candidate)(\s+Fix)?[:\s]*/i, "")
          .trim()
          .slice(0, 100);
      }
      if (!issueTitle) {
        issueTitle = "SWEny Triage: Automated bug fix";
      }
    }
    ctx.logger.info(`Extracted title: ${issueTitle}`);
  }

  // -------------------------------------------------------------------------
  // 2. Get or create issue
  // -------------------------------------------------------------------------
  let issue: Issue;

  if (config.issueOverride) {
    // User provided a specific issue
    ctx.logger.info(`User provided issue: ${config.issueOverride}`);
    issue = await issueTracker.getIssue(config.issueOverride);
    ctx.logger.info(`Working on issue: ${issue.identifier} - ${issue.url}`);
  } else {
    // Search for existing issue or create new one
    ctx.logger.info(`Searching for existing issues matching: ${issueTitle}`);
    const searchResults = await issueTracker.searchIssues({
      projectId: config.projectId,
      query: issueTitle,
      labels: [config.bugLabelId],
    });

    if (searchResults.length > 0) {
      issue = searchResults[0];
      const date = new Date().toISOString().split("T")[0];
      await issueTracker.addComment(issue.id, `+1 detected on ${date}`);
      ctx.logger.info(`Found existing issue: ${issue.identifier} - ${issue.url}`);
    } else {
      ctx.logger.info("No existing issue found, creating new one...");
      let description = "";
      const bestCandidatePath = ".github/triage-analysis/best-candidate.md";
      if (fs.existsSync(bestCandidatePath)) {
        description = fs.readFileSync(bestCandidatePath, "utf-8").slice(0, 10000);
      }

      const labelIds = [config.bugLabelId];
      if (config.triageLabelId) {
        labelIds.push(config.triageLabelId);
      }

      issue = await issueTracker.createIssue({
        title: issueTitle,
        projectId: config.projectId,
        labels: labelIds,
        priority: 2,
        stateId: config.stateBacklog,
        description,
      });
      ctx.logger.info(`Created new issue: ${issue.identifier} - ${issue.url}`);
    }
  }

  return {
    status: "success",
    data: {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title || issueTitle,
      issueUrl: issue.url,
      issueBranchName: issue.branchName,
    },
  };
}
