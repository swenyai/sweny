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
  entry: "prepare",

  nodes: {
    prepare: {
      name: "Load Rules & Context",
      instruction: `You are preparing for a triage workflow. Your job is to fetch and review any knowledge documents listed in the input.

1. Check input for \`rules_urls\` and \`context_urls\` arrays.
2. For each URL, fetch its content:
   - Linear document URLs → use the Linear MCP tools (get_document or search_documentation)
   - Other HTTP URLs → fetch directly
3. Summarize the key rules and context that downstream workflow nodes should follow.
4. Output the consolidated information so it's available to all subsequent steps.

If there are no URLs to fetch, just pass through — this step is a no-op.`,
      skills: ["linear"],
    },

    gather: {
      name: "Gather Context",
      instruction: `You are investigating a production alert. Gather all relevant context using the available tools:

1. **Observability**: Pull error details, stack traces, recent logs, metrics, and active incidents around the time of the alert. Use whichever observability tools are available to you.
2. **Source control**: Check recent commits, pull requests, and deploys that might be related.
3. **Issue tracker**: Search for similar past issues or known problems.

Be thorough — the investigation step depends on complete context. Use every tool available to you.`,
      skills: ["github", "sentry", "datadog", "betterstack", "linear"],
    },

    investigate: {
      name: "Root Cause Analysis",
      instruction: `Based on the gathered context, classify every distinct issue you found into one of two buckets: **novel** or **duplicate**.

For EACH issue found:
1. Identify the root cause and affected code/service.
2. Assess severity: critical (service down), high (major feature broken), medium (degraded), low (cosmetic/minor).
3. Assess fix complexity: "simple" (a few lines, clear change), "moderate" (multiple files but well-understood), or "complex" (architectural, risky, or unclear).
4. **Novelty check (REQUIRED):** Search the issue tracker for existing issues (BOTH open AND closed) that cover the same root cause, error pattern, or affected service. Use github_search_issues and/or linear_search_issues with multiple keyword variations.
   - A match = same root cause, same error message/pattern, or a human would call it "the same bug."
   - If matched → it's a **duplicate**. Record the existing issue ID.
   - If no match → it's **novel**.

**Output rules:**
- \`findings\`: array of ALL issues found (both novel and duplicate).
- \`novel_count\`: how many findings are novel (not duplicates).
- \`highest_severity\`: the highest severity across ALL findings.
- \`recommendation\`: what should happen next.

Downstream nodes will act ONLY on novel findings. Duplicates will be +1'd automatically.`,
      skills: ["github", "linear"],
      output: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Short description of the issue" },
                root_cause: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                affected_services: { type: "array", items: { type: "string" } },
                is_duplicate: { type: "boolean" },
                duplicate_of: { type: "string", description: "Existing issue ID/URL if duplicate" },
                fix_approach: { type: "string" },
                fix_complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
              },
              required: ["title", "root_cause", "severity", "is_duplicate"],
            },
          },
          novel_count: { type: "number", description: "Count of novel (non-duplicate) findings" },
          highest_severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          recommendation: { type: "string" },
        },
        required: ["findings", "novel_count", "highest_severity", "recommendation"],
      },
    },

    create_issue: {
      name: "Create Issues & Triage Duplicates",
      instruction: `Process ALL findings from the investigation. The findings array contains both novel and duplicate issues.

**For each NOVEL finding** (is_duplicate = false):
1. Create a new issue with a clear, actionable title.
2. Include: root cause, severity, affected services, reproduction steps, and recommended fix.
3. Add appropriate labels (bug, severity level, affected service).
4. Link to relevant commits, PRs, or existing issues.

**For each DUPLICATE finding** (is_duplicate = true):
1. Find the existing issue using the issue tracker (check duplicate_of field).
2. Add a comment: "+1 — SWEny triage confirmed this issue is still active (seen again at {current UTC timestamp}). Latest context: {1-2 sentence summary}."
3. If the existing issue is closed/done, reopen it or note in the comment that the bug has recurred.

If context.issueTemplate is provided, use it as the format for new issue bodies. Otherwise use a clear structure with: Summary, Root Cause, Impact, Steps to Reproduce, and Recommended Fix.

Use whichever issue tracker is available to you. Output the created/updated issue identifiers.`,
      skills: ["linear", "github"],
    },

    skip: {
      name: "Skip — All Duplicates or Low Priority",
      instruction: `Every finding from the investigation was either a duplicate or low-priority. No new issues need to be created.

For each **duplicate** finding (check the findings array for items where is_duplicate = true):
1. Find the existing issue using the issue tracker (check duplicate_of field).
2. Add a comment: "+1 — SWEny triage confirmed this issue is still active (seen again at {current UTC timestamp}). Latest context: {1-2 sentence summary of what was found this run}."
3. If the issue is closed/done, reopen it or note in the comment that the bug has recurred.

For **low priority** findings, log a brief note about why they were skipped.`,
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
    // prepare → gather (always)
    { from: "prepare", to: "gather" },

    // gather → investigate (always)
    { from: "gather", to: "investigate" },

    // investigate → notify (dry run — report findings, no side effects)
    {
      from: "investigate",
      to: "notify",
      when: "dryRun is true",
    },

    // investigate → create_issue (novel findings worth acting on, not dry run)
    {
      from: "investigate",
      to: "create_issue",
      when: "dryRun is not true AND novel_count is greater than 0 AND highest_severity is medium or higher",
    },

    // investigate → skip (everything is a duplicate or low priority)
    {
      from: "investigate",
      to: "skip",
      when: "dryRun is not true AND (novel_count is 0, OR highest_severity is low)",
    },

    // create_issue → implement (novel findings have a clear, feasible fix)
    {
      from: "create_issue",
      to: "implement",
      when: "at least one novel finding has fix_complexity simple or moderate AND fix_approach is provided",
    },

    // create_issue → notify (fixes too complex)
    {
      from: "create_issue",
      to: "notify",
      when: "all novel findings have fix_complexity complex, OR no clear fix_approach",
    },

    // skip → notify (nothing to implement — all duplicates +1'd or low priority)
    { from: "skip", to: "notify" },

    // implement → create_pr (always after successful implementation)
    { from: "implement", to: "create_pr" },

    // create_pr → notify (always)
    { from: "create_pr", to: "notify" },
  ],
};
