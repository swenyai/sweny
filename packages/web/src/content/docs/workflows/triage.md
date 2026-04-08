---
title: Triage Workflow
description: The built-in workflow for investigating production alerts.
---

The triage workflow is SWEny's built-in pipeline for investigating production alerts. It follows a **prepare, gather context, analyze root cause, create issues, implement fix, open PR, notify team** pattern with conditional routing based on novelty and severity.

## Overview

```
prepare --> gather --> investigate --[novel + medium+]--> create_issue --[feasible fix]--> implement --> create_pr --> notify
                                  \                      \
                                   \                      --[complex fix]--> notify
                                    \
                                     --[all duplicates or low]--> skip --> notify
```

Eight nodes, three conditional branches:

1. **prepare** -- fetch rules and context documents from configured URLs
2. **gather** -- pull error details, recent commits, and past issues from all available tools
3. **investigate** -- classify each issue as novel or duplicate; assess severity and fix complexity
4. **create_issue** -- file new tickets for novel findings, +1 existing tickets for duplicates (only if novel issues exist at medium+ severity)
5. **skip** -- +1 duplicate tickets and log low-priority findings (when no novel issues worth acting on)
6. **implement** -- write the fix (only if at least one finding has a feasible fix approach)
7. **create_pr** -- push branch and open a pull request
8. **notify** -- send a summary to the team's notification channel

## Workflow definition

This is a simplified version of the definition from `@sweny-ai/core` (full instructions are longer in the source):

```typescript
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
      instruction: `Fetch and review any knowledge documents listed in the input.
Check input for rules_urls and context_urls arrays. Fetch each URL
(Linear docs via MCP, HTTP URLs directly). Summarize the key rules
and context for downstream nodes. No-op if no URLs are provided.`,
      skills: ["linear"],
    },

    gather: {
      name: "Gather Context",
      instruction: `Gather all relevant context:
1. Observability: error details, stack traces, logs, metrics, incidents.
2. Source control: recent commits, PRs, deploys.
3. Issue tracker: similar past issues or known problems.
Be thorough — the investigation step depends on complete context.`,
      skills: ["github", "sentry", "datadog", "betterstack", "linear"],
    },

    investigate: {
      name: "Root Cause Analysis",
      instruction: `Classify every distinct issue as novel or duplicate.
For each: identify root cause, assess severity and fix complexity,
search BOTH open AND closed issues for duplicates.
Output a findings array with novel_count and highest_severity.`,
      skills: ["github", "linear"],
      output: {
        // see "The investigate output schema" below
      },
    },

    create_issue: {
      name: "Create Issues & Triage Duplicates",
      instruction: `For each NOVEL finding: create a new issue with root cause,
severity, and fix approach. For each DUPLICATE: +1 the existing issue
with a confirmation comment.`,
      skills: ["linear", "github"],
    },

    skip: {
      name: "Skip — All Duplicates or Low Priority",
      instruction: `All findings are duplicates or low priority.
+1 each duplicate's existing ticket. Log why low-priority items were skipped.`,
      skills: ["linear", "github"],
    },

    implement: {
      name: "Implement Fix",
      instruction: `Create a feature branch, make minimal code changes to fix
the identified bug, run tests if available, and commit.`,
      skills: ["github"],
    },

    create_pr: {
      name: "Open Pull Request",
      instruction: `Push the branch and open a PR with a clear title,
summary, and link to the issue.`,
      skills: ["github"],
    },

    notify: {
      name: "Notify Team",
      instruction: `Send a notification summarizing the triage result.
Include: severity, root cause, and links to created issues or PRs.`,
      skills: ["slack", "notification"],
    },
  },

  edges: [
    { from: "prepare", to: "gather" },
    { from: "gather", to: "investigate" },
    {
      from: "investigate",
      to: "create_issue",
      when: "novel_count is greater than 0 AND highest_severity is medium or higher",
    },
    {
      from: "investigate",
      to: "skip",
      when: "novel_count is 0, OR highest_severity is low",
    },
    {
      from: "create_issue",
      to: "implement",
      when: "at least one novel finding has fix_complexity simple or moderate AND fix_approach is provided",
    },
    {
      from: "create_issue",
      to: "notify",
      when: "all novel findings have fix_complexity complex, OR no clear fix_approach",
    },
    { from: "skip", to: "notify" },
    { from: "implement", to: "create_pr" },
    { from: "create_pr", to: "notify" },
  ],
};
```

## Node details

| Node | Name | Skills | Structured output? |
|------|------|--------|--------------------|
| `prepare` | Load Rules & Context | `linear` | No |
| `gather` | Gather Context | `github`, `sentry`, `datadog`, `betterstack`, `linear` | No |
| `investigate` | Root Cause Analysis | `github`, `linear` | Yes |
| `create_issue` | Create Issues & Triage Duplicates | `linear`, `github` | No |
| `skip` | Skip — All Duplicates or Low Priority | `linear`, `github` | No |
| `implement` | Implement Fix | `github` | No |
| `create_pr` | Open Pull Request | `github` | No |
| `notify` | Notify Team | `slack`, `notification` | No |

## The `investigate` output schema

The `investigate` node produces a **findings array** — one entry per distinct issue found. Each finding is independently classified as novel or duplicate. The `novel_count` and `highest_severity` fields drive routing.

```json
{
  "findings": [
    {
      "title": "NullPointerException in PaymentService.processRefund",
      "root_cause": "Missing null check on refund.metadata after API v2 migration",
      "severity": "high",
      "affected_services": ["payment-api"],
      "is_duplicate": false,
      "duplicate_of": null,
      "fix_approach": "Add null guard in processRefund() before accessing metadata.refundId",
      "fix_complexity": "simple"
    },
    {
      "title": "Slow query timeout on /api/orders endpoint",
      "root_cause": "Missing index on orders.created_at after schema migration",
      "severity": "medium",
      "is_duplicate": true,
      "duplicate_of": "ENG-456",
      "fix_approach": "Add composite index on (user_id, created_at)",
      "fix_complexity": "simple"
    }
  ],
  "novel_count": 1,
  "highest_severity": "high",
  "recommendation": "Create issue for the payment bug, +1 the orders query issue"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `findings` | array | Yes | All issues found (novel and duplicate) |
| `findings[].title` | string | Yes | Short description |
| `findings[].root_cause` | string | Yes | What caused it |
| `findings[].severity` | `critical` \| `high` \| `medium` \| `low` | Yes | Impact level |
| `findings[].affected_services` | string[] | No | Impacted services |
| `findings[].is_duplicate` | boolean | Yes | Whether this matches an existing ticket |
| `findings[].duplicate_of` | string | No | Existing issue ID/URL if duplicate |
| `findings[].fix_approach` | string | No | How to fix it |
| `findings[].fix_complexity` | `simple` \| `moderate` \| `complex` | No | Estimated fix effort |
| `novel_count` | number | Yes | Count of non-duplicate findings |
| `highest_severity` | `critical` \| `high` \| `medium` \| `low` | Yes | Highest severity across all findings |
| `recommendation` | string | Yes | What should happen next |

## Conditional routing

The workflow has three conditional branch points:

### After `investigate`

| Target | Condition |
|--------|-----------|
| `create_issue` | `novel_count > 0` AND `highest_severity` is medium or higher |
| `skip` | `novel_count == 0` OR `highest_severity` is low |

### After `create_issue`

| Target | Condition |
|--------|-----------|
| `implement` | At least one novel finding has `fix_complexity` simple or moderate AND a `fix_approach` |
| `notify` | All novel findings are complex, or no clear fix approach |

The `skip` node always routes to `notify` (unconditional).

### Duplicate detection

The novelty check is a critical part of the `investigate` node. Claude must search **both open and closed issues** in the issue tracker using multiple keyword variations. A finding is a duplicate if an existing issue covers the same root cause, error pattern, or affected service. This prevents SWEny from filing the same ticket repeatedly.

## Provider-agnostic design

The triage workflow lists **all compatible skills per category** in each node. At runtime, only the skills that are actually configured (with valid credentials) are available. This means the same workflow works whether you use Datadog or Sentry for observability, Linear or GitHub Issues for tracking, and Slack or Discord for notifications.

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
- uses: swenyai/triage@v1
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
