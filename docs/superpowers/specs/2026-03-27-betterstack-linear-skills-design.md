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

---

## 1. BetterStack Skill (new file)

**File:** `packages/core/src/skills/betterstack.ts`
**Category:** `observability`

### Config

| Field | Required | Env var | Description |
|---|---|---|---|
| `BETTERSTACK_API_TOKEN` | yes | `BETTERSTACK_API_TOKEN` | Telemetry API token (team-scoped) |
| `BETTERSTACK_QUERY_ENDPOINT` | yes | `BETTERSTACK_QUERY_ENDPOINT` | ClickHouse HTTP endpoint (e.g. `https://eu-nbg-2-connect.betterstackdata.com`) |
| `BETTERSTACK_QUERY_USERNAME` | yes | `BETTERSTACK_QUERY_USERNAME` | ClickHouse connection username |
| `BETTERSTACK_QUERY_PASSWORD` | yes | `BETTERSTACK_QUERY_PASSWORD` | ClickHouse connection password |

### Helpers

```ts
// REST API — source management
async function bsApi(path: string, ctx: ToolContext): Promise<unknown>
// GET https://telemetry.betterstack.com/api/v1{path}
// Authorization: Bearer $BETTERSTACK_API_TOKEN
// 30s timeout

// ClickHouse — log queries
async function bsQuery(sql: string, ctx: ToolContext): Promise<unknown>
// POST $BETTERSTACK_QUERY_ENDPOINT?output_format_pretty_row_numbers=0
// Basic auth: $BETTERSTACK_QUERY_USERNAME:$BETTERSTACK_QUERY_PASSWORD
// Content-Type: text/plain
// Body: {sql} FORMAT JSONEachRow
// Parse NDJSON response → JSON array
// 30s timeout
```

### Tools

#### `betterstack_list_sources`

List available telemetry sources. Returns id, name, table_name, platform for each source.

- **Input:** `{ name?: string }` — optional filter by name (partial match)
- **Implementation:** `GET /sources` with optional `?name=` query param. Map response `data` array to `{ id, name, table_name, platform }`.

#### `betterstack_get_source`

Get full details for a source including table name, retention settings, and ingestion config.

- **Input:** `{ id: number }` — source ID
- **Implementation:** `GET /sources/{id}`. Return `data.attributes`.

#### `betterstack_get_source_fields`

Get queryable fields for a source by running `DESCRIBE TABLE` against the ClickHouse proxy.

- **Input:** `{ table: string }` — table name (e.g. `t273774.offload_ecs_production`)
- **Implementation:** Execute `DESCRIBE TABLE remote({table}_logs)` via `bsQuery`. Parse column names and types.

#### `betterstack_query`

Execute a read-only ClickHouse SQL query against a telemetry source. Returns JSON rows.

- **Input:**
  - `query: string` — ClickHouse SQL (must be SELECT)
  - `source_id: number` — source ID (for logging/tracing)
  - `table: string` — table name (e.g. `t273774.offload_ecs_production`)
- **Safety:** Reject queries that don't start with `SELECT` (case-insensitive, after trimming). This prevents accidental mutations.
- **Implementation:** Execute via `bsQuery`. Append `LIMIT 500` if no LIMIT clause is present to prevent unbounded result sets.

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
| `BETTERSTACK_QUERY_ENDPOINT` | BetterStack → Integrations → ClickHouse HTTP → endpoint URL |
| `BETTERSTACK_QUERY_USERNAME` | Same form → username |
| `BETTERSTACK_QUERY_PASSWORD` | Same form → password (save immediately, shown once) |
