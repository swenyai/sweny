import * as core from "@actions/core";
import * as fs from "fs";
import { ActionConfig } from "../config";
import { Providers } from "../providers";
import { Issue } from "../providers/issue-tracker/types";
import { InvestigationResult } from "./investigate";
import { installClaude, runClaude } from "../utils/claude";
import {
  configureGit,
  createBranch,
  pushBranch,
  hasCommits,
  hasUncommittedChanges,
  stageAndCommit,
  getChangedFiles,
  resetWorkflowChanges,
} from "../utils/git";
import {
  createPullRequest,
  findExistingPr,
  dispatchWorkflow,
} from "../utils/github";

export interface ImplementResult {
  issueIdentifier: string;
  issueUrl: string;
  prUrl: string;
  prNumber: number;
  skipped: boolean;
  skipReason?: string;
}

const EMPTY_RESULT: ImplementResult = {
  issueIdentifier: "",
  issueUrl: "",
  prUrl: "",
  prNumber: 0,
  skipped: true,
  skipReason: "",
};

export async function implement(
  config: ActionConfig,
  providers: Providers,
  investigation: InvestigationResult,
): Promise<ImplementResult> {
  // -------------------------------------------------------------------------
  // 1. Novelty gate
  // -------------------------------------------------------------------------
  core.startGroup("Check Novelty Recommendation");
  const recommendation = investigation.recommendation;
  core.info(`Recommendation: ${recommendation}`);
  core.info(`Existing issue: ${investigation.existingIssue}`);

  if (/skip/i.test(recommendation)) {
    core.notice("Recommendation is SKIP - no novel issues found");
    core.endGroup();
    return { ...EMPTY_RESULT, skipReason: "Recommendation: skip" };
  }

  if (/\+1 existing/i.test(recommendation)) {
    core.notice(
      `Recommendation is +1 EXISTING - adding occurrence to ${investigation.existingIssue}`,
    );
    if (investigation.existingIssue) {
      try {
        const existing = await providers.issueTracker.getIssue(
          investigation.existingIssue,
        );
        await providers.issueTracker.addOccurrence(existing.id);
        core.info(`Added +1 occurrence to ${investigation.existingIssue}`);
      } catch (err) {
        core.warning(`Failed to add occurrence: ${err}`);
      }
    }
    core.endGroup();
    return {
      ...EMPTY_RESULT,
      issueIdentifier: investigation.existingIssue,
      skipReason: `+1 existing ${investigation.existingIssue}`,
    };
  }

  core.info("Recommendation is IMPLEMENT - proceeding with fix");
  core.endGroup();

  // -------------------------------------------------------------------------
  // 2. Extract issue title from best-candidate.md
  // -------------------------------------------------------------------------
  core.startGroup("Extract Issue Title");
  let issueTitle = "SWEny Triage: Automated bug fix";

  if (!config.linearIssue) {
    const bestCandidatePath = ".github/datadog-analysis/best-candidate.md";
    if (fs.existsSync(bestCandidatePath)) {
      const content = fs.readFileSync(bestCandidatePath, "utf-8");
      const headingMatch = content.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        issueTitle = headingMatch[1]
          // Strip backticks
          .replace(/`/g, "")
          // Strip "Best Candidate Fix:" / "Best Fix Candidate:" boilerplate
          .replace(/^(Best\s+)?(Fix\s+)?(Candidate)(\s+Fix)?[:\s]*/i, "")
          .trim()
          .slice(0, 100);
      }
      if (!issueTitle) {
        issueTitle = "SWEny Triage: Automated bug fix";
      }
    }
    core.info(`Extracted title: ${issueTitle}`);
  }
  core.endGroup();

  // -------------------------------------------------------------------------
  // 3. Get or create Linear issue
  // -------------------------------------------------------------------------
  core.startGroup("Get Linear Issue Details");
  let issue: Issue;

  if (config.linearIssue) {
    // User provided a specific Linear issue
    core.info(`User provided Linear issue: ${config.linearIssue}`);
    issue = await providers.issueTracker.getIssue(config.linearIssue);
    core.info(
      `Working on Linear issue: ${issue.identifier} - ${issue.url}`,
    );
  } else {
    // Search for existing issue or create new one
    core.info(`Searching for existing Linear issues matching: ${issueTitle}`);
    const searchResults = await providers.issueTracker.searchIssues({
      teamId: config.linearTeamId,
      query: issueTitle,
      labelId: config.linearBugLabelId,
    });

    if (searchResults.length > 0) {
      // Found existing issue
      issue = searchResults[0];
      await providers.issueTracker.addOccurrence(issue.id);
      core.info(
        `Found existing Linear issue: ${issue.identifier} - ${issue.url}`,
      );
    } else {
      // Create new issue
      core.info("No existing Linear issue found, creating new one...");
      let description = "";
      const bestCandidatePath = ".github/datadog-analysis/best-candidate.md";
      if (fs.existsSync(bestCandidatePath)) {
        description = fs
          .readFileSync(bestCandidatePath, "utf-8")
          .slice(0, 10000);
      }

      const labelIds = [config.linearBugLabelId];
      if (config.linearTriageLabelId) {
        labelIds.push(config.linearTriageLabelId);
      }

      issue = await providers.issueTracker.createIssue({
        title: issueTitle,
        teamId: config.linearTeamId,
        labelIds,
        priority: 2,
        stateId: config.linearStateBacklog,
        description,
      });
      core.info(
        `Created new Linear issue: ${issue.identifier} - ${issue.url}`,
      );
    }
  }
  core.endGroup();

  // -------------------------------------------------------------------------
  // 4. Cross-repo dispatch check
  // -------------------------------------------------------------------------
  core.startGroup("Cross-Repo Dispatch Check");
  const targetRepo = investigation.targetRepo;
  const currentRepo = config.repository;

  if (targetRepo && targetRepo !== currentRepo) {
    const dispatchToken = config.botToken || config.githubToken;
    core.notice(
      `Bug belongs to ${targetRepo} (current repo: ${currentRepo}) - dispatching cross-repo`,
    );

    try {
      await dispatchWorkflow({
        token: dispatchToken,
        targetRepo,
        linearIssue: issue.identifier,
        sourceRepo: currentRepo,
      });

      // Add a comment to the Linear issue noting the cross-repo handoff
      await providers.issueTracker.updateIssue(issue.id, {
        comment: `Cross-repo dispatch: Discovered in \`${currentRepo}\`, dispatched to \`${targetRepo}\` for implementation.`,
      });
    } catch (err) {
      core.warning(`Cross-repo dispatch failed: ${err}`);
    }

    core.endGroup();
    return {
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
      prUrl: "",
      prNumber: 0,
      skipped: true,
      skipReason: `Cross-repo dispatch to ${targetRepo}`,
    };
  }
  core.info(
    `Bug belongs to this repo (${currentRepo}) - implementing locally`,
  );
  core.endGroup();

  // -------------------------------------------------------------------------
  // 5. Check for existing GitHub PRs (duplicate check)
  // -------------------------------------------------------------------------
  core.startGroup("Check for Existing GitHub PRs");
  const skipMergedCheck = !!config.linearIssue;
  const existingPr = await findExistingPr(
    config.githubToken,
    issue.identifier,
    skipMergedCheck,
  );

  if (existingPr.found) {
    if (config.linearIssue && existingPr.state !== "open") {
      // User explicitly provided LINEAR_ISSUE - implement anyway if PR is not open
      core.notice(
        `Found ${existingPr.state} PR: ${existingPr.url} — LINEAR_ISSUE explicitly provided, implementing anyway`,
      );
    } else {
      // Skip implementation to avoid duplication
      core.notice(
        `Found existing PR: ${existingPr.url} (state: ${existingPr.state}) — skipping implementation`,
      );

      // Update Linear based on existing PR state
      try {
        const stateForPr =
          existingPr.state === "open"
            ? config.linearStateInProgress
            : existingPr.state === "merged"
              ? config.linearStatePeerReview
              : undefined;

        const comment =
          existingPr.state === "open" || existingPr.state === "OPEN"
            ? `**Existing Open PR Found**: [${existingPr.url}](${existingPr.url})\n_Occurrence tracked by SWEny Triage_`
            : existingPr.state === "merged" || existingPr.state === "MERGED"
              ? `**Merged PR Found**: [${existingPr.url}](${existingPr.url})\n_Occurrence tracked by SWEny Triage_`
              : `**Existing PR Found**: [${existingPr.url}](${existingPr.url}) (state: ${existingPr.state})\n_Occurrence tracked by SWEny Triage_`;

        await providers.issueTracker.updateIssue(issue.id, {
          stateId: stateForPr,
          comment,
        });
      } catch (err) {
        core.warning(`Failed to update Linear issue with PR info: ${err}`);
      }

      core.endGroup();
      return {
        issueIdentifier: issue.identifier,
        issueUrl: issue.url,
        prUrl: existingPr.url,
        prNumber: 0,
        skipped: true,
        skipReason: `Existing PR found: ${existingPr.url}`,
      };
    }
  } else {
    core.info("No existing PR found - proceeding with implementation");
  }
  core.endGroup();

  // -------------------------------------------------------------------------
  // 6. Create branch and configure git
  // -------------------------------------------------------------------------
  core.startGroup("Create Fix Branch");
  await configureGit();

  let branchName: string;
  if (issue.branchName) {
    // Linear branch names may come as "user/branch-name" — strip prefix
    branchName = issue.branchName.replace(/^[^/]*\//, "");
  } else {
    branchName = `${issue.identifier.toLowerCase()}-triage-fix`;
  }

  await createBranch(branchName);

  // Reset any workflow file changes to avoid permission issues on push
  await resetWorkflowChanges();
  core.info(`Created branch: ${branchName}`);
  core.endGroup();

  // -------------------------------------------------------------------------
  // 7. Install Claude and implement fix
  // -------------------------------------------------------------------------
  core.startGroup("Implement Fix with Claude");
  await installClaude();

  const implementPrompt = buildImplementPrompt(issue.identifier);

  const claudeEnv: Record<string, string> = {};
  if (config.anthropicApiKey)
    claudeEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken)
    claudeEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;

  await runClaude({
    prompt: implementPrompt,
    maxTurns: config.maxImplementTurns,
    env: claudeEnv,
  });
  core.endGroup();

  // -------------------------------------------------------------------------
  // 8. Check for code changes
  // -------------------------------------------------------------------------
  core.startGroup("Check for Code Changes");

  // Check if fix was declined
  const fixDeclinedPath = ".github/datadog-analysis/fix-declined.md";
  if (fs.existsSync(fixDeclinedPath)) {
    const reason = fs.readFileSync(fixDeclinedPath, "utf-8").trim();
    core.notice(`Fix was declined by Claude: ${reason.slice(0, 200)}`);
    core.endGroup();
    return {
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
      prUrl: "",
      prNumber: 0,
      skipped: true,
      skipReason: `Fix declined: ${reason.slice(0, 200)}`,
    };
  }

  let hasCodeChanges = await hasCommits();

  if (!hasCodeChanges) {
    core.info("No commits created by Claude");
    const hasUncommitted = await hasUncommittedChanges();
    if (hasUncommitted) {
      core.info(
        "Found uncommitted code changes, creating fallback commit",
      );
      await stageAndCommit(
        `fix: automated fix from log analysis\n\nPartial implementation by Claude (reached max turns before completion)\n\nIdentified by SWEny Triage\nLinear: ${issue.identifier}`,
      );
      hasCodeChanges = true;
    } else {
      core.info("No code changes to commit");
      core.endGroup();
      return {
        issueIdentifier: issue.identifier,
        issueUrl: issue.url,
        prUrl: "",
        prNumber: 0,
        skipped: true,
        skipReason: "No code changes produced",
      };
    }
  } else {
    const changedFiles = await getChangedFiles();
    core.info(
      `Claude created commits with changes to: ${changedFiles.join(", ")}`,
    );
  }
  core.endGroup();

  // -------------------------------------------------------------------------
  // 9. Push branch
  // -------------------------------------------------------------------------
  core.startGroup("Push Branch");
  const pushToken = config.botToken || config.githubToken;
  await pushBranch(branchName, pushToken, config.repository);
  core.endGroup();

  // -------------------------------------------------------------------------
  // 10. Generate PR description with Claude
  // -------------------------------------------------------------------------
  core.startGroup("Generate PR Description");
  const prDescPrompt = buildPrDescriptionPrompt(
    issue.identifier,
    issue.url,
  );
  await runClaude({
    prompt: prDescPrompt,
    maxTurns: 10,
    env: claudeEnv,
  });
  core.endGroup();

  // -------------------------------------------------------------------------
  // 11. Create Pull Request
  // -------------------------------------------------------------------------
  core.startGroup("Create Pull Request");
  let prBody = "";
  const prDescPath = ".github/datadog-analysis/pr-description.md";
  if (fs.existsSync(prDescPath)) {
    prBody = fs.readFileSync(prDescPath, "utf-8");
  } else {
    prBody = `## Automated Fix from SWEny Triage

This PR contains an automated fix for an issue identified in production logs.

**Linear Issue**: [${issue.identifier}](${issue.url})

> Generated by SWEny Triage`;
  }

  // Format title: use Linear issue identifier and lowercase title
  const prTitle = `fix(${issue.identifier}): ${(issue.title || issueTitle).toLowerCase()}`;
  const prToken = config.botToken || config.githubToken;

  const pr = await createPullRequest({
    token: prToken,
    title: prTitle,
    body: prBody,
    head: branchName,
    base: "main",
    labels: ["agent", "triage", "needs-review"],
  });
  core.info(`Created PR #${pr.number}: ${pr.url}`);
  core.endGroup();

  // -------------------------------------------------------------------------
  // 12. Link PR to Linear issue
  // -------------------------------------------------------------------------
  core.startGroup("Link PR to Linear Issue");
  try {
    await providers.issueTracker.linkPr(issue.id, pr.url, pr.number);
    core.info(`PR #${pr.number} linked to ${issue.identifier}`);
  } catch (err) {
    core.warning(`Failed to link PR to Linear issue: ${err}`);
  }
  core.endGroup();

  // -------------------------------------------------------------------------
  // 13. Update Linear issue state to Peer Review
  // -------------------------------------------------------------------------
  core.startGroup("Update Linear Issue to Peer Review");
  try {
    await providers.issueTracker.updateIssue(issue.id, {
      stateId: config.linearStatePeerReview,
    });
    core.info(`Updated ${issue.identifier} to Peer Review`);
  } catch (err) {
    core.warning(`Failed to update Linear issue state: ${err}`);
  }
  core.endGroup();

  return {
    issueIdentifier: issue.identifier,
    issueUrl: issue.url,
    prUrl: pr.url,
    prNumber: pr.number,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Implementation Prompt
// ---------------------------------------------------------------------------

function buildImplementPrompt(linearIdentifier: string): string {
  return `You are implementing a fix for an issue identified from production logs.

## Context

Read the best candidate analysis at \`.github/datadog-analysis/best-candidate.md\`.
Also read \`.github/datadog-analysis/investigation-log.md\` for context.

## Your Task

1. **Understand the issue**: Read the analysis thoroughly
2. **Verify the fix approach**: Check the codebase to ensure the suggested fix is valid
3. **Implement the fix**:
   - Make minimal, focused changes
   - Follow existing code patterns
   - Add appropriate error handling
   - Include TypeScript types
   - Do NOT add unnecessary comments
   - Do NOT refactor unrelated code

4. **Verify your changes**:
   - Run \`npm run lint\` to check for issues
   - Run \`npm run build\` to verify compilation

5. **Create a commit** with format:
   \`\`\`
   fix(<scope>): <brief description>

   - <change 1>
   - <change 2>

   Identified by SWEny Triage
   Linear: ${linearIdentifier}
   \`\`\`

## Safety Guidelines

- If the fix is too complex or risky, create \`.github/datadog-analysis/fix-declined.md\` explaining why
- Do not make breaking changes
- Prefer defensive coding patterns

Start by reading the best-candidate.md file.`;
}

// ---------------------------------------------------------------------------
// PR Description Prompt
// ---------------------------------------------------------------------------

function buildPrDescriptionPrompt(
  linearIdentifier: string,
  linearUrl: string,
): string {
  return `Generate a pull request description.

## Context

1. Read \`.github/datadog-analysis/best-candidate.md\` for issue details
2. Read \`.github/datadog-analysis/investigation-log.md\` for context
3. Run \`git diff main..HEAD\` to see the changes made

## Output

Create \`.github/datadog-analysis/pr-description.md\` with:

## Summary
<What this PR fixes and why>

## Issue Analysis
- Severity, Frequency, Services affected, Impact

## Root Cause
<Technical explanation>

## Solution
<Description and changes made>

## Testing
- [ ] Lint passes
- [ ] Build passes
- [ ] Tests pass

## Rollback Plan
<How to rollback>

---
**Linear Issue**: [${linearIdentifier}](${linearUrl})
> Generated by SWEny Triage`;
}
