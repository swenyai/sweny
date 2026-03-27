# BetterStack Built-in Skill + Linear Enhancements

**Date:** 2026-03-27
**Scope:** `packages/core/src/skills/`
**Motivation:** Built-in skills provide a CI-native tool layer that works in GitHub Actions and cloud environments where MCP servers cannot run. BetterStack is the only Offload observability provider without a built-in skill. Linear's existing skill is missing tools the triage workflow needs.

---

## Background

SWEny's environment-adaptive tool resolution:

| Environment | Tool resolution |
|---|---|
| Local / CLI | MCP servers (vendor-maintained, richer) |
| GitHub Actions | Built-in skills (direct REST/GraphQL, zero setup beyond secrets) |
| Cloud / serverless | Built-in skills (same reason) |

BetterStack's official MCP server (`mcp.betterstack.com`) uses a hosted proxy with internal ClickHouse access — it only needs a Bearer token. For direct access outside that proxy (our built-in skill), BetterStack requires two separate auth layers:

1. **Telemetry API token** — REST at `https://telemetry.betterstack.com/api/v1/` — manages sources, metadata
2. **ClickHouse credentials** (username + password + regional endpoint) — queries actual log data

Reference: [BetterStack SQL API docs](https://betterstack.com/docs/logs/query-api/connect-remotely/)

### Multi-cluster reality

BetterStack ClickHouse connections are **locked to a single cluster**. Sources can live on different clusters (e.g. Offload: ECS sources on `eu-fsn-3`, Permit service on `eu-nbg-2`). The skill must support querying across clusters transparently.

---

## 1. BetterStack Skill (new file)

**File:** `packages/core/src/skills/betterstack.ts`
**Category:** `observability`

### Config

| Field | Required | Env var | Description |
|---|---|---|---|
| `BETTERSTACK_API_TOKEN` | yes | `BETTERSTACK_API_TOKEN` | Telemetry API token (team-scoped) |
| `BETTERSTACK_QUERY_CONNECTIONS` | yes | `BETTERSTACK_QUERY_CONNECTIONS` | JSON mapping cluster → credentials (see below) |

`BETTERSTACK_QUERY_CONNECTIONS` format:
```json
{
  "eu-fsn-3": { "username": "...", "password": "..." },
  "eu-nbg-2": { "username": "...", "password": "..." }
}
```

The endpoint URL is derived from the cluster name: `https://{cluster}-connect.betterstackdata.com`. This avoids redundant config — the cluster name is the only variable.

Users create one ClickHouse connection per cluster in BetterStack → Integrations → Connect ClickHouse HTTP client. If all sources are on one cluster, only that cluster's credentials are needed.

### Helpers

```ts
// REST API — source management
async function bsApi(path: string, ctx: ToolContext): Promise<unknown>
// GET https://telemetry.betterstack.com/api/v1{path}
// Authorization: Bearer $BETTERSTACK_API_TOKEN
// 30s timeout

// Parse BETTERSTACK_QUERY_CONNECTIONS into a Map<cluster, {username, password}>
function getConnections(ctx: ToolContext): Map<string, { username: string; password: string }>

// ClickHouse — log queries, auto-resolves cluster
async function bsQuery(sql: string, cluster: string, ctx: ToolContext): Promise<unknown>
// Looks up credentials for the cluster from getConnections()
// POST https://{cluster}-connect.betterstackdata.com?output_format_pretty_row_numbers=0
// Basic auth: username:password
// Content-Type: text/plain
// Body: {sql} FORMAT JSONEachRow
// Parse NDJSON response → JSON array
// 30s timeout
```

### Tools

#### `betterstack_list_sources`

List available telemetry sources. Returns id, name, table_name, platform, and cluster/data_region for each source.

- **Input:** `{ name?: string }` — optional filter by name (partial match)
- **Implementation:** `GET /sources` with optional `?name=` query param. Map response `data` array to `{ id, name, table_name, platform, data_region }`. The `data_region` field tells the agent which cluster the source lives on.

#### `betterstack_get_source`

Get full details for a source including table name, cluster, retention settings, and ingestion config.

- **Input:** `{ id: number }` — source ID
- **Implementation:** `GET /sources/{id}`. Return `data.attributes`.

#### `betterstack_get_source_fields`

Get queryable fields for a source by running `DESCRIBE TABLE` against the ClickHouse proxy.

- **Input:** `{ table: string, cluster: string }` — table name (e.g. `t273774.offload_ecs_production`) and cluster (e.g. `eu-fsn-3`)
- **Implementation:** Execute `DESCRIBE TABLE remote({table}_logs)` via `bsQuery(sql, cluster, ctx)`. Parse column names and types.

#### `betterstack_query`

Execute a read-only ClickHouse SQL query against a telemetry source. Returns JSON rows.

- **Input:**
  - `query: string` — ClickHouse SQL (must be SELECT or DESCRIBE)
  - `source_id: number` — source ID (for logging/tracing)
  - `table: string` — table name (e.g. `t273774.offload_ecs_production`)
  - `cluster: string` — ClickHouse cluster (e.g. `eu-fsn-3`). Agent gets this from `betterstack_list_sources` or `betterstack_get_source`.
- **Safety:** Reject queries that don't start with `SELECT` or `DESCRIBE` (case-insensitive, after trimming).
- **Implementation:** Look up credentials for `cluster` from `getConnections()`. Execute via `bsQuery(sql, cluster, ctx)`. Append `LIMIT 500` if no LIMIT clause is present to prevent unbounded result sets.
- **Error:** If no credentials exist for the requested cluster, return a clear error listing which clusters are configured.

---

## 2. Linear Skill Enhancements

**File:** `packages/core/src/skills/linear.ts` (existing)

### New tool: `linear_get_issue`

Get a Linear issue by ID or identifier (e.g. `OFF-1020`).

- **Input:** `{ id: string }` — UUID or team identifier like `OFF-1020`
- **GraphQL:**
  ```graphql
  query($id: String!) {
    issue(id: $id) {
      id identifier title url description
      state { name type }
      priority priorityLabel
      assignee { name email }
      labels { nodes { name } }
      team { key name }
      createdAt updatedAt
    }
  }
  ```
- **Note:** Linear's `issue(id:)` resolver accepts both UUID and team-prefixed identifiers natively.

### New tool: `linear_list_teams`

List all Linear teams. Needed to discover `teamId` values for creating issues.

- **Input:** `{}` (no parameters)
- **GraphQL:**
  ```graphql
  query {
    teams {
      nodes { id key name description }
    }
  }
  ```

---

## 3. Triage Workflow Update

**File:** `packages/core/src/workflows/triage.ts`

Add `"betterstack"` to the `gather` node's skills array:

```ts
gather: {
  skills: ["github", "sentry", "datadog", "betterstack", "linear"],
}
```

This means the executor will include BetterStack tools when the skill is configured, alongside whatever other observability providers are available.

---

## 4. Skill Registry Update

**File:** `packages/core/src/skills/index.ts`

```ts
import { betterstack } from "./betterstack.js";

export const builtinSkills: Skill[] = [
  github, linear, slack, sentry, datadog, betterstack, notification,
];

export { github, linear, slack, sentry, datadog, betterstack, notification };
```

---

## 5. Changeset

**File:** `.changeset/betterstack-linear-skills.md`

```md
---
"@sweny-ai/core": minor
---

Add BetterStack built-in skill (log queries via ClickHouse + source management via REST) and enhance Linear skill with get_issue and list_teams tools. Built-in skills provide CI-native tool access in environments where MCP servers cannot run.
```

---

## File changes summary

| File | Change | ~Lines |
|---|---|---|
| `packages/core/src/skills/betterstack.ts` | New — 4 tools | ~130 |
| `packages/core/src/skills/linear.ts` | Edit — add 2 tools | +40 |
| `packages/core/src/skills/index.ts` | Edit — add betterstack import/export | +3 |
| `packages/core/src/workflows/triage.ts` | Edit — add betterstack to gather skills | +1 |
| `.changeset/betterstack-linear-skills.md` | New — minor changeset | 6 |

No new dependencies. Both skills use native `fetch()` only.

---

## CI setup required (one-time)

Users add these GitHub Actions secrets:

| Secret | Source |
|---|---|
| `BETTERSTACK_API_TOKEN` | BetterStack → API tokens → Telemetry API tokens |
| `BETTERSTACK_QUERY_CONNECTIONS` | JSON object — see below |

To build `BETTERSTACK_QUERY_CONNECTIONS`:

1. Go to BetterStack → Integrations → Connect ClickHouse HTTP client
2. Create a connection for each cluster your sources use (check source settings for cluster)
3. **Save the password immediately** — BetterStack only shows it once
4. Build the JSON:
   ```json
   {
     "eu-fsn-3": { "username": "u_abc123", "password": "..." },
     "eu-nbg-2": { "username": "u_def456", "password": "..." }
   }
   ```
5. Store as a single GitHub Actions secret (`BETTERSTACK_QUERY_CONNECTIONS`)

If all sources are on one cluster, only that cluster's entry is needed. Leave IP allowlist empty for GitHub Actions (runners have dynamic IPs).
