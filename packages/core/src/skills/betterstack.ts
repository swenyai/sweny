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
      description: "ClickHouse connection username",
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
        return bsQuery(`DESCRIBE TABLE remote(${input.table}_logs)`, ctx);
      },
    },
    {
      name: "betterstack_query",
      description: `Execute a read-only ClickHouse SQL query against a telemetry source.
Tables: remote(TABLE_logs) for recent logs, s3Cluster(primary, TABLE_s3) for historical (add WHERE _row_type = 1).
Key fields: dt (timestamp), raw (JSON blob with all log fields).
Extract nested fields: JSONExtract(raw, 'field_name', 'Nullable(String)').
Use betterstack_get_source_fields to discover available columns.`,
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "ClickHouse SQL query (SELECT only)" },
          source_id: { type: "number", description: "Source ID (for context)" },
          table: { type: "string", description: "Table name (e.g. t273774_offload_ecs_production)" },
        },
        required: ["query", "source_id", "table"],
      },
      handler: async (input: { query: string; source_id: number; table: string }, ctx) => {
        const trimmed = input.query.trim();
        const upper = trimmed.toUpperCase();
        if (!upper.startsWith("SELECT") && !upper.startsWith("DESCRIBE")) {
          throw new Error("[BetterStack] Only SELECT and DESCRIBE queries are allowed");
        }

        // Append LIMIT if none present to prevent unbounded result sets
        let sql = trimmed;
        if (!upper.includes("LIMIT")) {
          sql = `${sql} LIMIT 500`;
        }

        return bsQuery(sql, ctx);
      },
    },
  ],
};
