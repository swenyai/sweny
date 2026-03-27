---
title: End-to-End Walkthrough
description: Follow a real triage run step by step — from Sentry error spike to fix PR.
---

This walkthrough follows a concrete scenario through every node of the Triage workflow. The goal is to show you exactly what SWEny does at each step, what tools it calls, and what decisions it makes.

## The scenario

Your payment service starts throwing `NullReferenceError` at 2 AM. By 6 AM, Sentry has recorded 312 occurrences. Your SWEny triage workflow runs on schedule:

```yaml
on:
  schedule:
    - cron: '0 6 * * 1-5'  # weekdays at 6 AM UTC
```

GitHub fires the workflow. SWEny starts the Triage DAG from the `gather` entry node.

## Node 1: Gather Context

**Instruction:** Gather all relevant context — errors from observability, recent commits from source control, similar issues from the tracker.

**Skills active:** `github`, `sentry`, `linear`

Claude makes the following tool calls:

| Tool | What it does |
|------|-------------|
| `sentry_list_issues` | Pulls unresolved issues for the project — finds the `NullReferenceError` in `WebhookHandler.process()` with 312 occurrences |
| `sentry_get_issue_events` | Fetches the last 10 events with full stack traces — the crash happens on `event.payload.metadata.refundId` |
| `github_list_recent_commits` | Lists the last 10 commits on `main` — finds a deploy 8 hours ago that touched `src/webhooks/WebhookHandler.ts` |
| `github_search_code` | Searches for `WebhookHandler` to understand the file's role |
| `linear_search_issues` | Searches for "NullReferenceError WebhookHandler" — finds no matching open issues |

The node produces structured context: error details, stack traces, recent deploys, and the result of the duplicate search. This context is passed to the next node.

## Node 2: Root Cause Analysis

**Instruction:** Correlate the error with recent changes, identify the root cause, assess severity, determine if this is a duplicate.

**Skills active:** `github`

Claude reads the context from Node 1 and works through the analysis:

| Tool | What it does |
|------|-------------|
| `github_get_file` | Reads `src/webhooks/WebhookHandler.ts` at the current HEAD — sees `event.payload.metadata.refundId` accessed without a null check |
| `github_get_file` | Reads the same file at the commit before the deploy — confirms the access was added in the recent deploy |

Claude produces structured output:

```json
{
  "root_cause": "WebhookHandler.process() accesses event.payload.metadata.refundId without null-checking metadata. Refund webhooks from Stripe do not include the metadata field.",
  "severity": "high",
  "affected_services": ["payment-api"],
  "is_duplicate": false,
  "recommendation": "Add a null guard on event.payload.metadata before accessing refundId",
  "fix_approach": "Add optional chaining and an early return when metadata is missing"
}
```

## Edge: Routing decision

The executor evaluates outgoing edges from `investigate`:

- **Edge 1:** `when: "The issue is novel (not a duplicate) and severity is medium or higher"` — target: `create_issue`
- **Edge 2:** `when: "The issue is a duplicate of an existing ticket, or severity is low"` — target: `skip`

Claude reads the structured output — `is_duplicate: false`, `severity: "high"` — and picks Edge 1. Execution routes to `create_issue`.

## Node 3: Create Issue

**Instruction:** Create an issue with root cause, severity, affected services, reproduction steps, and recommended fix.

**Skills active:** `linear`, `github`

| Tool | What it does |
|------|-------------|
| `github_create_issue` | Creates a GitHub Issue with the full root cause analysis |

The created issue looks like:

> **NullReferenceError in WebhookHandler.process() on refund webhooks**
>
> **Severity:** High
> **Service:** payment-api
> **Occurrences:** 312 in last 24h
>
> **Root cause:** `WebhookHandler.process()` accesses `event.payload.metadata.refundId`
> without null-checking `metadata`. Refund webhooks from Stripe do not include the
> `metadata` field, causing a crash on every refund event.
>
> **Introduced by:** commit `a1b2c3d` (deployed 8 hours ago)
>
> **Recommended fix:** Add optional chaining on `event.payload.metadata` and an early
> return when metadata is missing. Add a test case for refund webhook payloads.
>
> Labels: `bug`, `severity:high`, `payment-api`

## Node 4: Notify Team

**Instruction:** Send a notification with the alert summary, severity, root cause, and a link to the created issue.

**Skills active:** `slack`, `notification`

If Slack is configured, Claude calls `slack_send_message` with a summary. If not, the GitHub Actions summary serves as the default notification.

| Tool | What it does |
|------|-------------|
| `slack_send_message` | Posts a summary to the configured Slack channel |

The Slack message:

> **SWEny Triage: payment-api**
>
> Severity: high
> Root cause: NullReferenceError in WebhookHandler — missing null check on metadata for refund webhooks.
> Issue: #142
> Occurrences: 312 in last 24h

The workflow ends. No more outgoing edges.

## GitHub Actions summary

Regardless of notification provider, SWEny always writes a structured summary to the GitHub Actions run:

```
SWEny Triage Summary
─────────────────────────────
Workflow:    Alert Triage
Duration:    3m 42s
Nodes run:   gather → investigate → create_issue → notify

Top issue: NullReferenceError in WebhookHandler
  Service:      payment-api
  Severity:     high
  Occurrences:  312 in last 24h
  Root cause:   Missing null check on event.payload.metadata
  Issue:        #142
  Fix approach: Add optional chaining + test case
```

## What if the error was a duplicate?

If `linear_search_issues` had found a matching open issue (say `ENG-401`), the Root Cause Analysis node would have set `is_duplicate: true`. The routing would have picked Edge 2, and execution would have gone to the `skip` node — logging a brief note and ending the workflow.

## What if severity was low?

Same result. The edge condition checks both `is_duplicate` and `severity`. A low-severity, non-duplicate issue routes to `skip` rather than clogging your issue tracker with cosmetic bugs.

## Cost and performance

A typical triage run with `investigation-depth: standard`:

| Metric | Typical range |
|--------|--------------|
| Wall time | 2-8 minutes |
| Agent turns | 5-20 per issue |
| Token usage | 10k-50k tokens per issue |

With a Claude Max subscription (`claude-oauth-token`), triage runs are included in your subscription. With an API key, expect roughly $0.10-$0.50 per run at current Sonnet pricing.

To control costs:

- Set `max-investigate-turns` to cap investigation depth (default: 50)
- Use `service-filter` to focus on specific services (e.g., `payment-*`)
- Use `time-range: 4h` instead of `24h` to reduce log volume
- Use `investigation-depth: quick` for faster, cheaper runs
- Use `dry-run: true` to test without creating issues or PRs

## Tuning behavior

| Input | What it controls | Example values |
|-------|-----------------|----------------|
| `time-range` | How far back to scan | `4h`, `24h`, `7d` |
| `severity-focus` | Error level filter | `errors`, `warnings`, `all` |
| `service-filter` | Limit to specific services | `payment-*`, `api-gateway` |
| `investigation-depth` | How thorough the analysis is | `quick`, `standard`, `thorough` |
| `max-investigate-turns` | Investigation turn limit | `20`, `50` |
| `novelty-mode` | Skip already-tracked issues | `true`, `false` |
| `dry-run` | Investigate without creating issues/PRs | `true`, `false` |

See [Action Inputs](/action/inputs/) for the complete list.

## What's next?

- **[FAQ](/getting-started/faq/)** — common questions about cost, security, and custom workflows
- **[Triage Workflow](/workflows/triage/)** — full reference for the triage DAG
- **[Implement Workflow](/workflows/implement/)** — chain a fix PR after triage
- **[Action Inputs](/action/inputs/)** — all configuration options
