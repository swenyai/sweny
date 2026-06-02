/**
 * BetterStack Skill
 *
 * Telemetry REST API for source management + ClickHouse HTTP for log queries.
 * CI-native alternative to the BetterStack MCP server.
 */

import type { Skill, ToolContext } from "../types.js";

// ─── REST API (source management) ──────────────────────────────

async function bsApi(path: string, ctx: ToolContext): Promise<unknown> {
  const res = await fetch(`https://telemetry.betterstack.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${ctx.config.BETTERSTACK_API_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`[BetterStack] API request failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

// ─── ClickHouse HTTP (log queries) ─────────────────────────────

async function bsQuery(sql: string, ctx: ToolContext): Promise<unknown[]> {
  const endpoint = ctx.config.BETTERSTACK_QUERY_ENDPOINT.replace(/\/+$/, "");
  const res = await fetch(`${endpoint}?output_format_pretty_row_numbers=0`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Basic ${btoa(`${ctx.config.BETTERSTACK_QUERY_USERNAME}:${ctx.config.BETTERSTACK_QUERY_PASSWORD}`)}`,
    },
    body: `${sql} FORMAT JSONEachRow`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`[BetterStack] ClickHouse query failed (HTTP ${res.status}): ${await res.text()}`);

  // JSONEachRow returns one JSON object per line (NDJSON)
  const text = await res.text();
  if (!text.trim()) return [];
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

// ─── Input hardening (issue #226) ──────────────────────────────
//
// Threat model: tool arguments are LLM-controlled at runtime and can be
// steered by prompt-injected content (issue bodies, fetched logs). The
// `table` argument reaches a ClickHouse query string, so it is strictly
// validated as an identifier. The read-only query guard below is
// best-effort UX — the real security boundary must be a read-only
// ClickHouse role on the BETTERSTACK_QUERY_USERNAME connection.

/**
 * Validate an LLM-chosen table name as a bare ClickHouse identifier.
 * Anything outside [A-Za-z0-9_] is rejected — table names from
 * BetterStack are always of the form t<id>_<name>.
 */
export function assertClickHouseIdentifier(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`[BetterStack] Invalid table identifier "${name}" — only letters, digits, and _ are allowed`);
  }
  return name;
}

/** Blank out string literal contents so keyword checks don't match inside them. */
function stripStringLiterals(sql: string): string {
  // Handles both '' (SQL) and \' (ClickHouse) quote escaping.
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

/**
 * Best-effort read-only guard for `betterstack_query`.
 *
 * Accepts SELECT / WITH / DESCRIBE statements, rejects everything else,
 * rejects multi-statement input, and appends a LIMIT cap when the query
 * has none. Keyword checks ignore string literal contents so a log
 * message containing "LIMIT" doesn't skip the cap.
 *
 * This is UX, not a security boundary: a determined query can still do
 * anything the ClickHouse connection's role allows. Use a read-only
 * role for the configured credentials.
 */
export function prepareReadOnlyQuery(query: string): string {
  let sql = query.trim().replace(/;\s*$/, "").trim();
  const stripped = stripStringLiterals(sql);

  if (stripped.includes(";")) {
    throw new Error("[BetterStack] Multi-statement queries are not allowed — send a single statement");
  }

  if (!/^(SELECT|WITH|DESCRIBE)\b/i.test(stripped)) {
    throw new Error("[BetterStack] Only read-only queries are allowed (SELECT, WITH, or DESCRIBE)");
  }

  // Append LIMIT if none present to prevent unbounded result sets.
  // DESCRIBE output is already bounded by the column count.
  if (!/^DESCRIBE\b/i.test(stripped) && !/\bLIMIT\b/i.test(stripped)) {
    sql = `${sql} LIMIT 500`;
  }

  return sql;
}

// ─── Skill definition ──────────────────────────────────────────

export const betterstack: Skill = {
  id: "betterstack",
  name: "BetterStack",
  description: "Query logs and manage telemetry sources in BetterStack",
  category: "observability",
  config: {
    BETTERSTACK_API_TOKEN: {
      description: "BetterStack Telemetry API token (team-scoped)",
      required: true,
      env: "BETTERSTACK_API_TOKEN",
    },
    BETTERSTACK_QUERY_ENDPOINT: {
      description: "ClickHouse HTTP endpoint (e.g. https://eu-fsn-3-connect.betterstackdata.com)",
      required: true,
      env: "BETTERSTACK_QUERY_ENDPOINT",
    },
    BETTERSTACK_QUERY_USERNAME: {
      description:
        "ClickHouse connection username. Use a read-only role — the in-skill query guard is best-effort, " +
        "not a security boundary",
      required: true,
      env: "BETTERSTACK_QUERY_USERNAME",
    },
    BETTERSTACK_QUERY_PASSWORD: {
      description: "ClickHouse connection password",
      required: true,
      env: "BETTERSTACK_QUERY_PASSWORD",
    },
  },
  tools: [
    {
      name: "betterstack_list_sources",
      description: "List available telemetry sources (id, name, table_name, platform)",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Filter by name (partial match)" },
        },
      },
      handler: async (input: { name?: string }, ctx) => {
        const params = new URLSearchParams({ per_page: "50" });
        if (input.name) params.set("name", input.name);
        const data: any = await bsApi(`/sources?${params}`, ctx);
        return data.data.map((s: any) => ({
          id: s.id,
          name: s.attributes.name,
          table_name: s.attributes.table_name,
          platform: s.attributes.platform,
        }));
      },
    },
    {
      name: "betterstack_get_source",
      description: "Get full details for a telemetry source (table name, retention, config)",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Source ID" },
        },
        required: ["id"],
      },
      handler: async (input: { id: number }, ctx) => {
        const data: any = await bsApi(`/sources/${input.id}`, ctx);
        return { id: data.data.id, ...data.data.attributes };
      },
    },
    {
      name: "betterstack_get_source_fields",
      description: "Get queryable fields for a source table (column names and types)",
      input_schema: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name (e.g. t273774_offload_ecs_production)" },
        },
        required: ["table"],
      },
      handler: async (input: { table: string }, ctx) => {
        return bsQuery(`DESCRIBE TABLE remote(${assertClickHouseIdentifier(input.table)}_logs)`, ctx);
      },
    },
    {
      name: "betterstack_query",
      description: `Execute a read-only ClickHouse SQL query against a telemetry source.
Tables: remote(TABLE_logs) for recent logs, s3Cluster(primary, TABLE_s3) for historical (add WHERE _row_type = 1).
Key fields: dt (timestamp), raw (JSON blob with all log fields).
Extract nested fields: JSONExtract(raw, 'field_name', 'Nullable(String)').
Use betterstack_get_source_fields to discover available columns.
Only single SELECT / WITH / DESCRIBE statements are accepted.`,
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "ClickHouse SQL query (single SELECT, WITH, or DESCRIBE statement)" },
          source_id: { type: "number", description: "Source ID (for context)" },
          table: { type: "string", description: "Table name (e.g. t273774_offload_ecs_production)" },
        },
        required: ["query", "source_id", "table"],
      },
      handler: async (input: { query: string; source_id: number; table: string }, ctx) => {
        return bsQuery(prepareReadOnlyQuery(input.query), ctx);
      },
    },
  ],
};
