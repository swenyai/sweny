/**
 * Supabase Skill
 *
 * Query, insert, update, and manage data in a Supabase project.
 * Uses the Supabase REST API (PostgREST) for data operations
 * and the Management API for project-level operations.
 */

import type { Skill, ToolContext } from "../types.js";

// ─── Input hardening (issue #226) ──────────────────────────────
//
// Threat model: this skill runs with SUPABASE_SERVICE_ROLE_KEY, which
// bypasses RLS entirely, and `table`, `filters[]`, and function names are
// LLM-controlled at runtime (steerable by prompt-injected content).
// Identifiers are validated before they reach the request path, filter
// values are URL-encoded so one filter string cannot smuggle extra query
// parameters, and the optional SUPABASE_ALLOWED_TABLES /
// SUPABASE_ALLOWED_FUNCTIONS allowlists bound what the agent can touch.

/** Validate an LLM-chosen table/column name as a bare PostgREST identifier. */
export function assertSupabaseIdentifier(name: string, label = "table"): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`[Supabase] Invalid ${label} identifier "${name}" — only letters, digits, and _ are allowed`);
  }
  return name;
}

/** Validate an LLM-chosen RPC / edge function name (hyphens allowed for edge functions). */
export function assertSupabaseFunctionName(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`[Supabase] Invalid function name "${name}" — only letters, digits, _ and - are allowed`);
  }
  return name;
}

/**
 * Append PostgREST filter strings ("column=op.value") to query params.
 * Each filter is split at its first `=`; the value side is appended as a
 * single parameter value so `&`/`=` inside it are percent-encoded rather
 * than interpreted as additional parameters.
 */
export function appendPostgrestFilters(params: URLSearchParams, filters: string[]): URLSearchParams {
  for (const filter of filters) {
    const eq = filter.indexOf("=");
    if (eq <= 0) {
      throw new Error(`[Supabase] Invalid filter "${filter}" — expected "column=operator.value" (e.g. "id=eq.1")`);
    }
    params.append(filter.slice(0, eq), filter.slice(eq + 1));
  }
  return params;
}

/** Parse an optional comma-separated allowlist config value. Returns null when unset (no restriction). */
function resolveAllowlist(config: Record<string, string>, key: string): Set<string> | null {
  const raw = config[key];
  if (!raw || !raw.trim()) return null;
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

/** Validate a table name and check it against SUPABASE_ALLOWED_TABLES (when configured). */
function checkTable(table: string, ctx: ToolContext): string {
  assertSupabaseIdentifier(table);
  const allowlist = resolveAllowlist(ctx.config, "SUPABASE_ALLOWED_TABLES");
  if (allowlist && !allowlist.has(table)) {
    throw new Error(
      `[Supabase] Table "${table}" is not on the SUPABASE_ALLOWED_TABLES allowlist (${[...allowlist].join(", ")})`,
    );
  }
  return table;
}

/** Validate a function name and check it against SUPABASE_ALLOWED_FUNCTIONS (when configured). */
function checkFunction(name: string, ctx: ToolContext): string {
  assertSupabaseFunctionName(name);
  const allowlist = resolveAllowlist(ctx.config, "SUPABASE_ALLOWED_FUNCTIONS");
  if (allowlist && !allowlist.has(name)) {
    throw new Error(
      `[Supabase] Function "${name}" is not on the SUPABASE_ALLOWED_FUNCTIONS allowlist (${[...allowlist].join(", ")})`,
    );
  }
  return name;
}

async function supabaseRest(path: string, ctx: ToolContext, init?: RequestInit): Promise<unknown> {
  const url = ctx.config.SUPABASE_URL;
  const key = ctx.config.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: init?.method === "POST" ? "return=representation" : "return=representation",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`[Supabase] REST API failed (HTTP ${res.status}): ${await res.text()}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function supabaseEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const url = ctx.config.SUPABASE_URL;
  const key = ctx.config.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`[Supabase] Edge function "${functionName}" failed (HTTP ${res.status}): ${await res.text()}`);
  }

  return res.json();
}

export const supabase: Skill = {
  id: "supabase",
  name: "Supabase",
  description: "Query, insert, update data and invoke edge functions on a Supabase project",
  category: "general",
  config: {
    SUPABASE_URL: {
      description: "Supabase project URL (e.g., https://xxxx.supabase.co)",
      required: true,
      env: "SUPABASE_URL",
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      description:
        "Supabase service role key (full access, bypasses RLS — high blast radius). " +
        "Prefer a scoped key where possible, and bound exposure with SUPABASE_ALLOWED_TABLES / " +
        "SUPABASE_ALLOWED_FUNCTIONS",
      required: true,
      env: "SUPABASE_SERVICE_ROLE_KEY",
    },
    SUPABASE_ALLOWED_TABLES: {
      description:
        "Optional comma-separated table allowlist. When set, data tools (query/count/insert/update/delete) " +
        "are restricted to these tables",
      required: false,
      env: "SUPABASE_ALLOWED_TABLES",
    },
    SUPABASE_ALLOWED_FUNCTIONS: {
      description:
        "Optional comma-separated function allowlist. When set, supabase_rpc and supabase_invoke_function " +
        "are restricted to these RPC / edge function names",
      required: false,
      env: "SUPABASE_ALLOWED_FUNCTIONS",
    },
  },
  tools: [
    // ─── Read ────────────────────────────────────────────────
    {
      name: "supabase_query",
      description:
        "Query rows from a Supabase table. Uses PostgREST query syntax. " + "Returns an array of matching rows.",
      input_schema: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name (e.g., 'games', 'profiles')" },
          select: {
            type: "string",
            description:
              "Columns to select (PostgREST syntax). Default: '*'. Examples: 'id,title,subject', 'id,title,course_modules(id,title)'",
          },
          filters: {
            type: "array",
            description:
              "PostgREST filter strings. Examples: ['subject=eq.math', 'difficulty=eq.easy', 'created_at=gte.2026-01-01']",
            items: { type: "string" },
          },
          order: {
            type: "string",
            description: "Order by clause. Examples: 'created_at.desc', 'title.asc'",
          },
          limit: {
            type: "number",
            description: "Maximum rows to return. Default: 100",
          },
        },
        required: ["table"],
      },
      handler: async (
        input: { table: string; select?: string; filters?: string[]; order?: string; limit?: number },
        ctx,
      ) => {
        const table = checkTable(input.table, ctx);
        const params = new URLSearchParams();
        params.set("select", input.select || "*");
        if (input.order) params.set("order", input.order);
        params.set("limit", String(input.limit || 100));
        appendPostgrestFilters(params, input.filters ?? []);

        return supabaseRest(`/${table}?${params}`, ctx);
      },
    },

    {
      name: "supabase_count",
      description: "Count rows in a table, optionally with filters.",
      input_schema: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name" },
          filters: {
            type: "array",
            description: "PostgREST filter strings",
            items: { type: "string" },
          },
        },
        required: ["table"],
      },
      handler: async (input: { table: string; filters?: string[] }, ctx) => {
        const url = ctx.config.SUPABASE_URL;
        const key = ctx.config.SUPABASE_SERVICE_ROLE_KEY;
        const table = checkTable(input.table, ctx);

        const params = new URLSearchParams({ select: "count" });
        appendPostgrestFilters(params, input.filters ?? []);
        const path = `${url}/rest/v1/${table}?${params}`;

        const res = await fetch(path, {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: "count=exact",
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          throw new Error(`[Supabase] Count failed: ${await res.text()}`);
        }

        const range = res.headers.get("content-range");
        const count = range ? parseInt(range.split("/")[1], 10) : 0;
        return { table: input.table, count };
      },
    },

    // ─── Write ───────────────────────────────────────────────
    {
      name: "supabase_insert",
      description:
        "Insert one or more rows into a table. Returns the inserted rows. " +
        "Use upsert=true to update existing rows on conflict.",
      input_schema: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name" },
          rows: {
            type: "array",
            description: "Array of row objects to insert",
            items: { type: "object" },
          },
          upsert: {
            type: "boolean",
            description: "If true, update on conflict instead of failing. Default: false",
          },
        },
        required: ["table", "rows"],
      },
      handler: async (input: { table: string; rows: Record<string, unknown>[]; upsert?: boolean }, ctx) => {
        const table = checkTable(input.table, ctx);
        const headers: Record<string, string> = {};
        if (input.upsert) {
          headers["Prefer"] = "resolution=merge-duplicates,return=representation";
        }

        return supabaseRest(`/${table}`, ctx, {
          method: "POST",
          headers,
          body: JSON.stringify(input.rows),
        });
      },
    },

    {
      name: "supabase_update",
      description: "Update rows matching filters. Returns the updated rows.",
      input_schema: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name" },
          filters: {
            type: "array",
            description: "PostgREST filter strings to match rows (REQUIRED — prevents accidental full-table updates)",
            items: { type: "string" },
          },
          data: {
            type: "object",
            description: "Fields to update",
          },
        },
        required: ["table", "filters", "data"],
      },
      handler: async (input: { table: string; filters: string[]; data: Record<string, unknown> }, ctx) => {
        if (!input.filters || input.filters.length === 0) {
          throw new Error("Filters are required for update operations to prevent accidental full-table updates");
        }

        const table = checkTable(input.table, ctx);
        const params = appendPostgrestFilters(new URLSearchParams(), input.filters);

        return supabaseRest(`/${table}?${params}`, ctx, {
          method: "PATCH",
          body: JSON.stringify(input.data),
        });
      },
    },

    {
      name: "supabase_delete",
      description: "Delete rows matching filters. Returns the deleted rows.",
      input_schema: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name" },
          filters: {
            type: "array",
            description: "PostgREST filter strings (REQUIRED — prevents accidental full-table deletes)",
            items: { type: "string" },
          },
        },
        required: ["table", "filters"],
      },
      handler: async (input: { table: string; filters: string[] }, ctx) => {
        if (!input.filters || input.filters.length === 0) {
          throw new Error("Filters are required for delete operations");
        }

        const table = checkTable(input.table, ctx);
        const params = appendPostgrestFilters(new URLSearchParams(), input.filters);
        return supabaseRest(`/${table}?${params}`, ctx, { method: "DELETE" });
      },
    },

    // ─── RPC ─────────────────────────────────────────────────
    {
      name: "supabase_rpc",
      description: "Call a Supabase RPC (stored procedure / database function).",
      input_schema: {
        type: "object",
        properties: {
          function_name: { type: "string", description: "Name of the database function" },
          params: {
            type: "object",
            description: "Parameters to pass to the function",
          },
        },
        required: ["function_name"],
      },
      handler: async (input: { function_name: string; params?: Record<string, unknown> }, ctx) => {
        return supabaseRest(`/rpc/${checkFunction(input.function_name, ctx)}`, ctx, {
          method: "POST",
          body: JSON.stringify(input.params || {}),
        });
      },
    },

    // ─── Edge Functions ──────────────────────────────────────
    {
      name: "supabase_invoke_function",
      description: "Invoke a Supabase Edge Function by name with a JSON body.",
      input_schema: {
        type: "object",
        properties: {
          function_name: {
            type: "string",
            description: "Edge function name (e.g., 'agent-gateway', 'seed-content')",
          },
          body: {
            type: "object",
            description: "JSON body to send to the function",
          },
        },
        required: ["function_name", "body"],
      },
      handler: async (input: { function_name: string; body: Record<string, unknown> }, ctx) => {
        return supabaseEdgeFunction(checkFunction(input.function_name, ctx), input.body, ctx);
      },
    },

    // ─── Auth Admin ──────────────────────────────────────────
    {
      name: "supabase_list_users",
      description: "List auth users. Returns user IDs, emails, and metadata.",
      input_schema: {
        type: "object",
        properties: {
          page: { type: "number", description: "Page number (1-based). Default: 1" },
          per_page: { type: "number", description: "Users per page. Default: 50" },
        },
      },
      handler: async (input: { page?: number; per_page?: number }, ctx) => {
        const url = ctx.config.SUPABASE_URL;
        const key = ctx.config.SUPABASE_SERVICE_ROLE_KEY;
        const page = input.page || 1;
        const perPage = input.per_page || 50;

        const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
          headers: {
            Authorization: `Bearer ${key}`,
            apikey: key,
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          throw new Error(`[Supabase] List users failed: ${await res.text()}`);
        }

        return res.json();
      },
    },

    // ─── Schema Introspection ────────────────────────────────
    {
      name: "supabase_list_tables",
      description: "List all public tables with row counts. Useful for content auditing.",
      input_schema: {
        type: "object",
        properties: {},
      },
      handler: async (_input: Record<string, never>, ctx) => {
        return supabaseRest("/rpc/get_table_counts", ctx, { method: "POST", body: JSON.stringify({}) }).catch(
          async () => {
            // Fallback: query information_schema
            const url = ctx.config.SUPABASE_URL;
            const key = ctx.config.SUPABASE_SERVICE_ROLE_KEY;
            const res = await fetch(`${url}/rest/v1/rpc/`, {
              method: "POST",
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({}),
            });
            return { note: "get_table_counts RPC not available. Use supabase_query to check specific tables." };
          },
        );
      },
    },
  ],
};
