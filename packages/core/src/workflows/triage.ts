/**
 * Triage Workflow
 *
 * Investigate a production alert → gather context → determine root cause →
 * create/update issue → implement fix → open PR → notify team.
 *
 * Provider-agnostic: nodes list all compatible skills per category.
 * The executor uses whichever skills are configured. Pre-execution
 * validation ensures required categories have at least one provider.
 *
 * Categories used:
 *   git:            github (+ bitbucket, gitlab in future)
 *   observability:  sentry, datadog, betterstack (+ aws, pagerduty in future)
 *   tasks:          linear, github (issues) (+ jira in future)
 *   notification:   slack, notification (discord/teams/webhook)
 */

import type { Workflow } from "../types.js";

export const triageWorkflow: Workflow = {
  id: "triage",
  name: "Alert Triage",
  description:
    "Investigate a production alert, determine root cause, create an issue, implement a fix, and notify the team",
  entry: "gather",

  nodes: {
    gather: {
      name: "Gather Context",
      instruction: `You are investigating a production alert. Gather all relevant context using the available tools:

1. **Observability**: Pull error details, stack traces, recent logs, metrics, and active incidents around the time of the alert. Use whichever observability tools are available to you.
2. **Source control**: Check recent commits, pull requests, and deploys that might be related.
3. **Issue tracker**: Search for similar past issues or known problems.

Be thorough — the investigation step depends on complete context. Use every tool available to you.`,
      skills: ["github", "sentry", "datadog", "linear"],
    },

    investigate: {
      name: "Root Cause Analysis",
      instruction: `Based on the gathered context, perform a root cause analysis:

1. Correlate the error with recent code changes, deploys, or config changes.
2. Identify the most likely root cause.
3. Assess severity: critical (service down), high (major feature broken), medium (degraded), low (cosmetic/minor).
4. Determine affected services and users.
5. Recommend a fix approach.
6. Assess fix complexity: "simple" (a few lines, clear change), "moderate" (multiple files but well-understood), or "complex" (architectural, risky, or unclear).

**Novelty check (REQUIRED — you MUST do this before finishing):**
Search the issue tracker for existing issues (BOTH open AND closed) that cover the same root cause, error pattern, or affected service. Use github_search_issues and/or linear_search_issues with multiple keyword variations.

A match means ANY of:
- An issue about the same root cause (even if closed/fixed)
- An issue about the same error message or pattern in the same service
- An issue that a human would consider "the same bug"

Set is_duplicate=true if ANY match is found. Set is_duplicate=false ONLY if you searched and found zero matches. You MUST always set this field.`,
      skills: ["github", "linear"],
      output: {
        type: "object",
        properties: {
          root_cause: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          affected_services: { type: "array", items: { type: "string" } },
          is_duplicate: { type: "boolean" },
          duplicate_of: { type: "string", description: "Issue ID/URL if duplicate" },
          recommendation: { type: "string" },
          fix_approach: { type: "string" },
          fix_complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
        },
        required: ["root_cause", "severity", "is_duplicate", "recommendation"],
      },
    },

    create_issue: {
      name: "Create Issue",
      instruction: `Create an issue documenting the investigation findings:

1. Use a clear, actionable title.
2. Include: root cause, severity, affected services, reproduction steps, and recommended fix.
3. Add appropriate labels (bug, severity level, affected service).
4. Link to relevant commits, PRs, or existing issues.

**Safety check**: If during creation you notice a very similar issue already exists, add a comment to it using github_add_comment or linear_add_comment instead of creating a duplicate.

If context.issueTemplate is provided, use it as the format for the issue body. Otherwise use a clear structure with: Summary, Root Cause, Impact, Steps to Reproduce, and Recommended Fix.

Create the issue in whichever tracker is available to you.`,
      skills: ["linear", "github"],
    },

    skip: {
      name: "Skip — Duplicate or Low Priority",
      instruction: `This alert was determined to be a duplicate or low-priority.

If this is a **duplicate** of an existing issue (check context for duplicate_of):
1. Find the existing issue using the issue tracker tools.
2. Add a comment: "+1 — SWEny triage confirmed this issue is still active (seen again at {current UTC timestamp}). Latest context: {1-2 sentence summary of what was found this run}."
3. If the issue is closed/done, reopen it or note in the comment that the bug has recurred.

If this is just **low priority**, log a brief note about why it was skipped.`,
      skills: ["linear", "github"],
    },

    implement: {
      name: "Implement Fix",
      instruction: `Implement the fix identified during investigation:

1. Create a feature branch from the base branch (check context for baseBranch, default "main").
2. Read the relevant source files to understand the current code.
3. Make the necessary code changes — fix the bug, nothing more.
4. Run any existing tests if available to verify the fix doesn't break anything.
5. Stage and commit with a clear commit message referencing the issue.

Keep changes minimal and focused. Do not refactor surrounding code or add unrelated improvements.

If the fix turns out to be more complex than expected, stop and explain why — do not force a bad fix.`,
      skills: ["github"],
    },

    create_pr: {
      name: "Open Pull Request",
      instruction: `Open a pull request for the fix:

1. Push the branch to the remote.
2. Create a PR with a clear title referencing the issue (e.g. "[OFF-1020] fix: guard empty pdf_texts before access").
3. In the PR body, include: summary of the bug, what the fix does, and a link to the issue.
4. Add appropriate labels if available.

If context.prTemplate is provided, use it as the format for the PR body. Otherwise use a clear structure with: Summary, Changes, Testing, and Related Issues.

Return the PR URL and number.`,
      skills: ["github"],
    },

    notify: {
      name: "Notify Team",
      instruction: `Send a notification summarizing the triage result:

1. Include: alert summary, severity, root cause (1-2 sentences), and links to any created issues or PRs.
2. For critical/high severity, make the notification urgent.
3. For medium/low, a standard notification is fine.

Use whichever notification channel is available to you.`,
      skills: ["slack", "notification"],
    },
  },

  edges: [
    // gather → investigate (always)
    { from: "gather", to: "investigate" },

    // investigate → create_issue (if novel and actionable)
    {
      from: "investigate",
      to: "create_issue",
      when: "is_duplicate is false AND severity is medium or higher",
    },

    // investigate → skip (if duplicate or low priority)
    {
      from: "investigate",
      to: "skip",
      when: "is_duplicate is true, OR severity is low",
    },

    // create_issue → implement (if fix is clear and not too complex)
    {
      from: "create_issue",
      to: "implement",
      when: "fix_complexity is simple or moderate AND fix_approach is provided AND dryRun is not true",
    },

    // create_issue → notify (if fix is too complex or risky, or dry run)
    {
      from: "create_issue",
      to: "notify",
      when: "fix_complexity is complex, OR no clear fix_approach, OR dryRun is true",
    },

    // skip → implement (duplicate exists but has a clear unfixed bug with a simple fix)
    {
      from: "skip",
      to: "implement",
      when: "is_duplicate is true AND the duplicate issue is still open/unfixed AND fix_complexity is simple or moderate AND fix_approach is provided AND dryRun is not true",
    },

    // skip → notify (duplicate was +1'd, no implementation needed or too complex)
    {
      from: "skip",
      to: "notify",
      when: "is_duplicate is true AND (fix_complexity is complex OR no fix_approach OR the issue already has a PR in progress OR dryRun is true), OR severity is low",
    },

    // implement → create_pr (always after successful implementation)
    { from: "implement", to: "create_pr" },

    // create_pr → notify (always)
    { from: "create_pr", to: "notify" },
  ],
};
