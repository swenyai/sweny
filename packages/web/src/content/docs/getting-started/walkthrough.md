---
title: End-to-End Walkthrough
description: Follow a real triage run from error spike to merged PR.
---

This walkthrough shows exactly what happens when SWEny runs. We'll follow a real scenario: a payment service starts throwing `NullPointerException` errors overnight, and SWEny catches it, files a ticket, and opens a fix PR before your team wakes up.

## The trigger

Your workflow runs on a cron schedule — say, Monday and Thursday at 6 AM UTC:

```yaml
on:
  schedule:
    - cron: '0 6 * * 1,4'
```

GitHub fires the workflow. SWEny starts.

## Phase 1: Investigate

SWEny queries your observability platform for recent errors. With the default 24-hour time range, it pulls logs from the last day:

```
Querying Datadog for errors in the last 24h...
Found 847 error logs across 12 services.
Aggregating by service and error pattern...

Top error groups:
  1. payment-api — NullPointerException in WebhookHandler.process() — 312 occurrences
  2. auth-service — ConnectionTimeout to Redis — 89 occurrences
  3. billing-worker — Stale invoice reference — 14 occurrences
```

SWEny passes the aggregated errors to the agent, which reads through the stack traces, identifies the highest-impact issue, and checks the codebase for context.

### Duplicate detection

Before filing anything, SWEny searches your issue tracker and open PRs:

- Searches Linear for issues matching "NullPointerException WebhookHandler" in the last 30 days
- Searches GitHub for open PRs touching the same files
- Checks for recent triage labels to avoid re-investigating known issues

If a matching issue exists, SWEny adds a "+1 occurrence" comment with the latest error count and skips to the next issue. If it's genuinely new, it proceeds to Phase 2.

## Phase 2: Implement

The agent creates a branch, reads the relevant source files, and writes a fix:

```
Creating branch: sweny/fix-webhook-null-pointer-1234
Analyzing: src/webhooks/WebhookHandler.ts
Root cause: event.payload.metadata is undefined when webhook type is "refund"

Writing fix...
  Modified: src/webhooks/WebhookHandler.ts (null check + early return)
  Modified: tests/webhooks/WebhookHandler.test.ts (added refund webhook test case)

Creating Linear issue ENG-456:
  Title: NullPointerException in WebhookHandler.process() on refund webhooks
  Labels: Bug, Agent Triage
  Description: [root cause analysis, affected files, fix approach]

Opening PR #89: Fix null pointer in WebhookHandler for refund webhooks
  Linked to: ENG-456
```

The PR includes:
- A description explaining the root cause
- The minimal code change to fix the bug
- A test case covering the failure scenario
- A link back to the Linear ticket

## Phase 3: Notify

SWEny posts a summary to your GitHub Actions run:

```markdown
## SWEny Triage Summary

**Investigated:** 3 error groups across 12 services
**Action taken:** Created ENG-456 and opened PR #89

### Top issue: NullPointerException in WebhookHandler

- **Service:** payment-api
- **Occurrences:** 312 in last 24h
- **Root cause:** Missing null check on event.payload.metadata for refund webhooks
- **Fix:** PR #89 — adds guard clause and test coverage
- **Skipped:** auth-service Redis timeout (existing issue ENG-401), billing-worker stale ref (3 occurrences, below threshold)
```

If you've configured Slack, Teams, or Discord webhooks, the summary goes there too.

## What your team sees Monday morning

- A Linear ticket with full root cause analysis
- A PR ready for code review
- A GitHub Actions summary with the full investigation log
- No 3 AM pages

## Cost and performance

A typical triage run with `investigation-depth: standard`:

| Metric | Typical range |
|--------|--------------|
| Wall time | 2–8 minutes |
| Agent turns | 5–20 per issue |
| Token usage | 10k–50k tokens per issue |

Costs depend on your Claude plan. With an OAuth token (Max/Pro subscription), triage runs are included. With an API key, expect ~$0.10–$0.50 per run at current Sonnet pricing.

To control costs:
- Set `max-turns` to cap the agent's iteration count (default: 50)
- Use `service-filter` to focus on specific services
- Use `dry-run: true` to test without creating PRs
- Use `investigation-depth: quick` for faster, cheaper runs

## Configuring the behavior

| Input | What it controls | Example |
|-------|-----------------|---------|
| `time-range` | How far back to scan | `4h`, `24h`, `7d` |
| `severity-focus` | Error level filter | `errors`, `warnings` |
| `service-filter` | Limit to specific services | `payment-*`, `api-gateway` |
| `investigation-depth` | How thorough the analysis is | `quick`, `standard`, `thorough` |
| `max-turns` | Agent iteration limit | `20`, `50` |
| `dry-run` | Investigate without creating PRs | `true` |

See [Action Inputs](/action/inputs/) for the complete list.
