---
title: BetterStack
description: Query incidents, monitors, and on-call status from BetterStack.
---

The BetterStack skill gives Claude access to your uptime monitoring data. Claude can list active incidents, check monitor health, and see who is currently on-call — useful for triage workflows where you need to understand the operational state of your services.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `betterstack` |
| **Category** | `observability` |
| **Required env vars** | `BETTERSTACK_API_TOKEN` |

## Tools

| Tool | Description |
|------|-------------|
| `betterstack_list_incidents` | List recent incidents with optional date range filter |
| `betterstack_get_incident` | Get detailed information about a specific incident including timeline |
| `betterstack_list_monitors` | List all uptime monitors and their current status |
| `betterstack_get_monitor` | Get details and recent status of a specific monitor |
| `betterstack_list_on_call` | List current on-call calendars and who is on-call |

## Setup

1. Go to **BetterStack Uptime > Settings > API** (or `betterstack.com/uptime/api`).
2. Copy your API token.
3. Set the environment variable:

```bash
export BETTERSTACK_API_TOKEN="your-api-token"
```

The token provides read access to incidents, monitors, and on-call schedules through the BetterStack Uptime API.

## Workflow usage

**Triage workflow:**
- **gather** — Pull active incidents, check which monitors are down, and identify who is on-call. This gives Claude operational context that complements error-level data from Sentry or log data from Datadog.

BetterStack is interchangeable with Sentry and Datadog at the `gather` node. You can configure one, two, or all three observability skills — Claude will use whatever is available to build a complete picture of the alert.

:::note[Uptime API only]
This skill uses the BetterStack Uptime API. Logtail (BetterStack Logs) is listed in the skill description but log search tools are not yet implemented. For log queries, use the Datadog skill or a custom MCP server.
:::
