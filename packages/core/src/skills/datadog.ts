/**
 * Datadog Skill
 *
 * Replaces: observability/datadog.ts
 */

import type { Skill, ToolContext } from "../types.js";

async function ddApi(path: string, ctx: ToolContext, init?: RequestInit & { v2?: boolean }): Promise<unknown> {
  const base = ctx.config.DD_SITE ? `https://api.${ctx.config.DD_SITE}` : "https://api.datadoghq.com";
  const version = init?.v2 ? "v2" : "v1";
  const res = await fetch(`${base}/api/${version}${path}`, {
    ...init,
    headers: {
      "DD-API-KEY": ctx.config.DD_API_KEY,
      "DD-APPLICATION-KEY": ctx.config.DD_APP_KEY,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`[Datadog] API request failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

export const datadog: Skill = {
  id: "datadog",
  name: "Datadog",
  description: "Query logs, metrics, and monitors from Datadog",
  config: {
    DD_API_KEY: {
      description: "Datadog API key",
      required: true,
      env: "DD_API_KEY",
    },
    DD_APP_KEY: {
      description: "Datadog application key",
      required: true,
      env: "DD_APP_KEY",
    },
    DD_SITE: {
      description: "Datadog site (e.g., datadoghq.eu). Default: datadoghq.com",
      required: false,
      env: "DD_SITE",
    },
  },
  tools: [
    {
      name: "datadog_search_logs",
      description: "Search logs in Datadog",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Log search query (Datadog syntax)" },
          from: { type: "string", description: "Start time (ISO 8601 or relative like 'now-1h')" },
          to: { type: "string", description: "End time (default: now)" },
          limit: { type: "number", description: "Max results (default: 50)" },
        },
        required: ["query"],
      },
      handler: async (input: { query: string; from?: string; to?: string; limit?: number }, ctx) =>
        ddApi("/logs/events/search", ctx, {
          method: "POST",
          v2: true,
          body: JSON.stringify({
            filter: {
              query: input.query,
              from: input.from ?? "now-1h",
              to: input.to ?? "now",
            },
            page: { limit: input.limit ?? 50 },
            sort: "-timestamp",
          }),
        }),
    },
    {
      name: "datadog_query_metrics",
      description: "Query time-series metrics from Datadog",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Metrics query (e.g., 'avg:system.cpu.user{*}')" },
          from: { type: "number", description: "Start time (UNIX epoch seconds)" },
          to: { type: "number", description: "End time (UNIX epoch seconds)" },
        },
        required: ["query", "from", "to"],
      },
      handler: async (input: { query: string; from: number; to: number }, ctx) =>
        ddApi(`/query?query=${encodeURIComponent(input.query)}&from=${input.from}&to=${input.to}`, ctx),
    },
    {
      name: "datadog_list_monitors",
      description: "List Datadog monitors, optionally filtered by tag or name",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Filter by monitor name (substring match)" },
          tags: { type: "string", description: "Comma-separated tags to filter by" },
        },
      },
      handler: async (input: { name?: string; tags?: string }, ctx) => {
        const params = new URLSearchParams();
        if (input.name) params.set("name", input.name);
        if (input.tags) params.set("monitor_tags", input.tags);
        return ddApi(`/monitor?${params}`, ctx);
      },
    },
  ],
};
