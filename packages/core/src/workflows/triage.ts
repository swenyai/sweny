/**
 * Triage Workflow
 *
 * Investigate a production alert → gather context from available
 * providers → determine root cause → create issue → notify team.
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
  description: "Investigate a production alert, determine root cause, create an issue, and notify the team",
  entry: "gather",

  nodes: {
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
      instruction: `Based on the gathered context, perform a root cause analysis:

1. Correlate the error with recent code changes, deploys, or config changes.
2. Identify the most likely root cause.
3. Assess severity: critical (service down), high (major feature broken), medium (degraded), low (cosmetic/minor).
4. Determine affected services and users.
5. Recommend a fix approach.

If this is a known issue that already has a ticket, mark it as duplicate.`,
      skills: ["github"],
      output: {
        type: "object",
        properties: {
          root_cause: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          affected_services: { type: "array", items: { type: "string" } },
          is_duplicate: { type: "boolean" },
          duplicate_of: { type: "string", description: "Issue ID if duplicate" },
          recommendation: { type: "string" },
          fix_approach: { type: "string" },
        },
        required: ["root_cause", "severity", "recommendation"],
      },
    },

    create_issue: {
      name: "Create Issue",
      instruction: `Create an issue documenting the investigation findings:

1. Use a clear, actionable title.
2. Include: root cause, severity, affected services, reproduction steps, and recommended fix.
3. Add appropriate labels (bug, severity level, affected service).
4. Link to relevant commits, PRs, or existing issues.

Create the issue in whichever tracker is available to you.`,
      skills: ["linear", "github"],
    },

    notify: {
      name: "Notify Team",
      instruction: `Send a notification summarizing the triage result:

1. Include: alert summary, severity, root cause (1-2 sentences), and a link to the created issue.
2. For critical/high severity, make the notification urgent.
3. For medium/low, a standard notification is fine.

Use whichever notification channel is available to you.`,
      skills: ["slack", "notification"],
    },

    skip: {
      name: "Skip — Duplicate or Low Priority",
      instruction: `This alert was determined to be a duplicate or low-priority.
Log a brief note about why it was skipped. No further action needed.`,
      skills: [],
    },
  },

  edges: [
    // gather → investigate (always)
    { from: "gather", to: "investigate" },

    // investigate → create_issue (if novel and actionable)
    {
      from: "investigate",
      to: "create_issue",
      when: "The issue is novel (not a duplicate) and severity is medium or higher",
    },

    // investigate → skip (if duplicate or low priority)
    {
      from: "investigate",
      to: "skip",
      when: "The issue is a duplicate of an existing ticket, or severity is low",
    },

    // create_issue → notify (always)
    { from: "create_issue", to: "notify" },
  ],
};
