---
title: Sentry
description: Query errors, issues, and performance data from Sentry.
---

The Sentry skill gives Claude access to your error tracking data. Claude can list unresolved issues, drill into specific errors with full stack traces, and run Discover queries for cross-project event analysis.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `sentry` |
| **Category** | `observability` |
| **Required env vars** | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` |
| **Optional env vars** | `SENTRY_BASE_URL` (default: `https://sentry.io`) |

## Tools

| Tool | Description |
|------|-------------|
| `sentry_list_issues` | List recent issues for a Sentry project, with optional search query |
| `sentry_get_issue` | Get detailed information about a specific Sentry issue |
| `sentry_get_issue_events` | Get recent events (occurrences) for an issue, including full stack traces |
| `sentry_search_events` | Search events across a project using Sentry Discover query syntax |

## Setup

1. Go to **Sentry > Settings > Auth Tokens** (or `sentry.io/settings/auth-tokens/`).
2. Create a new auth token with the following scopes:
   - `project:read` — list and query project issues
   - `event:read` — read event details and stack traces
   - `org:read` — required for Discover queries
3. Set the environment variables:

```bash
export SENTRY_AUTH_TOKEN="sntrys_..."
export SENTRY_ORG="my-org"
```

### Self-hosted Sentry

If you run a self-hosted Sentry instance, set the base URL:

```bash
export SENTRY_BASE_URL="https://sentry.internal.example.com"
```

When `SENTRY_BASE_URL` is not set, the skill defaults to `https://sentry.io`.

## Workflow usage

**Triage workflow:**
- **gather** — Pull error details, stack traces, and recent events around the time of the alert. The `sentry_list_issues` and `sentry_get_issue_events` tools give Claude the raw data it needs for root cause analysis.

:::note[Discover queries]
The `sentry_search_events` tool uses Sentry's Discover query syntax. Claude can query aggregate data like error counts, P95 latencies, and trending issues. This is useful for the gather node when the alert is about a spike rather than a single error.
:::
