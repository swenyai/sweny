---
title: Triage Workflow
description: The built-in workflow for investigating production alerts.
---

The triage workflow is SWEny's built-in pipeline for investigating production alerts. It follows a **gather context, analyze root cause, create issue, notify team** pattern with conditional routing to skip duplicates and low-priority alerts.

## Overview

```
gather --> investigate --[novel + medium+]--> create_issue --> notify
                       \
                        --[duplicate or low]--> skip
```

Five nodes, one conditional branch:

1. **gather** -- pull error details, recent commits, and past issues from all available tools
2. **investigate** -- correlate findings and determine root cause, severity, and whether the issue is a duplicate
3. **create_issue** -- file a ticket with the full analysis (only if the issue is novel and medium+ severity)
4. **notify** -- send a summary to the team's notification channel
5. **skip** -- log a note and stop (for duplicates or low-priority alerts)

## Workflow definition

This is the actual definition from `@sweny-ai/core`:

```typescript
import type { Workflow } from "../types.js";

export const triageWorkflow: Workflow = {
  id: "triage",
  name: "Alert Triage",
  description:
    "Investigate a production alert, determine root cause, create an issue, and notify the team",
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
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          affected_services: {
            type: "array",
            items: { type: "string" },
          },
          is_duplicate: { type: "boolean" },
          duplicate_of: {
            type: "string",
            description: "Issue ID if duplicate",
          },
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
    { from: "gather", to: "investigate" },
    {
      from: "investigate",
      to: "create_issue",
      when: "The issue is novel (not a duplicate) and severity is medium or higher",
    },
    {
      from: "investigate",
      to: "skip",
      when: "The issue is a duplicate of an existing ticket, or severity is low",
    },
    { from: "create_issue", to: "notify" },
  ],
};
```

## Node details

| Node | Name | Skills | Structured output? |
|------|------|--------|--------------------|
| `gather` | Gather Context | `github`, `sentry`, `datadog`, `betterstack`, `linear` | No |
| `investigate` | Root Cause Analysis | `github` | Yes |
| `create_issue` | Create Issue | `linear`, `github` | No |
| `notify` | Notify Team | `slack`, `notification` | No |
| `skip` | Skip -- Duplicate or Low Priority | (none) | No |

## The `investigate` output schema

The `investigate` node is the only node with a structured output schema. This is what makes conditional routing work -- Claude's analysis is forced into a predictable shape:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `root_cause` | string | Yes | What caused the alert |
| `severity` | enum: `critical`, `high`, `medium`, `low` | Yes | Impact level |
| `affected_services` | string[] | No | Which services are impacted |
| `is_duplicate` | boolean | No | Whether this matches an existing ticket |
| `duplicate_of` | string | No | Issue ID if duplicate |
| `recommendation` | string | Yes | What to do about it |
| `fix_approach` | string | No | How to fix the root cause |

## Conditional routing

After `investigate` completes, the executor asks Claude to evaluate two conditions against the structured output:

- **To `create_issue`**: "The issue is novel (not a duplicate) and severity is medium or higher"
- **To `skip`**: "The issue is a duplicate of an existing ticket, or severity is low"

Because `investigate` produces structured data with `severity`, `is_duplicate`, and `recommendation` fields, Claude has concrete values to evaluate the conditions against. A `severity: "low"` result routes to `skip`. A `severity: "high"` with `is_duplicate: false` routes to `create_issue`.

## Provider-agnostic design

The triage workflow lists **all compatible skills per category** in each node. At runtime, only the skills that are actually configured (with valid credentials) are available. This means the same workflow works whether you use Datadog or Sentry for observability, Linear or GitHub Issues for tracking, and Slack or Discord for notifications.

Skill categories used by the triage workflow:

| Category | Skills | Purpose |
|----------|--------|---------|
| git | `github` | Recent commits, PRs, deploys |
| observability | `sentry`, `datadog`, `betterstack` | Error details, logs, metrics |
| tasks | `linear`, `github` | Past issues, ticket creation |
| notification | `slack`, `notification` | Team alerts |

## Running the triage workflow

**From the CLI:**

```bash
sweny triage --dry-run            # investigate without creating issues
sweny triage                      # full run: investigate + create issues + notify
```

**From GitHub Actions:**

```yaml
- uses: swenyai/sweny@v3
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
```

**Export and customize:**

```bash
sweny workflow export triage > my-triage.yml
# Edit the YAML, then run:
sweny workflow run my-triage.yml
```

## What's next?

- [Implement Workflow](/workflows/implement/) -- the built-in issue-to-PR workflow
- [Custom Workflows](/workflows/custom/) -- modify the triage workflow or build your own
- [YAML Reference](/workflows/yaml-reference/) -- full schema for workflow files
