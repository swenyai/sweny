---
title: Datadog
description: Query logs, metrics, and monitors from Datadog.
---

The Datadog skill connects Claude to your Datadog environment for log search, metric queries, and monitor status. It covers the observability data you need for alert investigation and performance analysis.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `datadog` |
| **Category** | `observability` |
| **Required env vars** | `DD_API_KEY`, `DD_APP_KEY` |
| **Optional env vars** | `DD_SITE` (default: `datadoghq.com`) |

## Tools

| Tool | Description |
|------|-------------|
| `datadog_search_logs` | Search logs using Datadog query syntax with time range filters |
| `datadog_query_metrics` | Query time-series metrics (e.g., `avg:system.cpu.user{*}`) |
| `datadog_list_monitors` | List monitors, optionally filtered by name or tags |

## Setup

1. Go to **Datadog > Organization Settings > API Keys** and create (or copy) an API key.
2. Go to **Organization Settings > Application Keys** and create an application key.
3. Set the environment variables:

```bash
export DD_API_KEY="your-api-key"
export DD_APP_KEY="your-app-key"
```

### Non-US regions

If your Datadog account is on a non-US site, set `DD_SITE`:

```bash
export DD_SITE="datadoghq.eu"        # EU
export DD_SITE="us3.datadoghq.com"   # US3
export DD_SITE="us5.datadoghq.com"   # US5
export DD_SITE="ap1.datadoghq.com"   # AP1
```

When `DD_SITE` is not set, the skill defaults to `datadoghq.com` (US1).

:::note[Key permissions]
The application key inherits the permissions of the user who creates it. For SWEny, the user needs read access to logs, metrics, and monitors. No write access is required.
:::

## Workflow usage

**Triage workflow:**
- **gather** — Search logs for error patterns, query metrics for anomalies, and check monitor status to understand the scope of an alert.

Datadog is interchangeable with Sentry and BetterStack at the `gather` node. The executor uses whichever observability skills are configured. If you use multiple observability providers, Claude will query all of them for a more complete picture.
