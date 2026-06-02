---
title: BetterStack
description: Query logs and manage telemetry sources in BetterStack.
---

The BetterStack skill gives Claude access to your telemetry data. Claude can list log sources, discover their queryable fields, and run read-only ClickHouse SQL queries against them — useful for triage workflows where log evidence is needed to understand an alert or reproduce a bug.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `betterstack` |
| **Category** | `observability` |
| **Required env vars** | `BETTERSTACK_API_TOKEN`, `BETTERSTACK_QUERY_ENDPOINT`, `BETTERSTACK_QUERY_USERNAME`, `BETTERSTACK_QUERY_PASSWORD` |

## Tools

| Tool | Description |
|------|-------------|
| `betterstack_list_sources` | List available telemetry sources (id, name, table_name, platform) |
| `betterstack_get_source` | Get full details for a telemetry source (table name, retention, config) |
| `betterstack_get_source_fields` | Get queryable fields for a source table (column names and types) |
| `betterstack_query` | Execute a read-only ClickHouse SQL query against a telemetry source |

## Setup

1. Go to **BetterStack Telemetry > Settings > API tokens** and copy your team API token.
2. Go to **Connect remotely** under your source group to get the ClickHouse connection details.
3. Set the environment variables:

```bash
export BETTERSTACK_API_TOKEN="your-api-token"
export BETTERSTACK_QUERY_ENDPOINT="https://eu-fsn-3-connect.betterstackdata.com"
export BETTERSTACK_QUERY_USERNAME="your-connection-username"
export BETTERSTACK_QUERY_PASSWORD="your-connection-password"
```

:::caution[Use a read-only connection]
The query credentials should belong to a **read-only ClickHouse role**. The skill rejects statements that are not `SELECT` / `WITH` / `DESCRIBE` and refuses multi-statement input, but this guard is best-effort UX — it is not a security boundary. The agent's tool arguments are model-controlled at runtime and can be influenced by the content it reads (issue bodies, fetched pages, the logs themselves), so least privilege at the connection level is what actually bounds what a query can do.
:::

## Query model

Logs live in ClickHouse tables named after the source (e.g. `t273774_my_service_production`):

- `remote(TABLE_logs)` — recent logs
- `s3Cluster(primary, TABLE_s3)` — historical logs (add `WHERE _row_type = 1`)

Key fields: `dt` (timestamp) and `raw` (JSON blob with all log fields). Extract nested fields with `JSONExtract(raw, 'field_name', 'Nullable(String)')`.

Queries with no `LIMIT` clause get `LIMIT 500` appended automatically to keep result sets bounded.

## Workflow usage

**Triage workflow:**
- **gather** — Pull recent error logs and correlate them with the alert. This complements error-level data from Sentry or metrics from Datadog.

BetterStack is interchangeable with Sentry and Datadog at the `gather` node. You can configure one, two, or all three observability skills — Claude will use whatever is available to build a complete picture of the alert.
