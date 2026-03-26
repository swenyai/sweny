/**
 * BetterStack Skill
 *
 * Uptime monitoring (incidents, monitors) and log search via BetterStack APIs.
 */

import type { Skill, ToolContext, SkillCategory } from "../types.js";

const UPTIME_BASE = "https://uptime.betterstack.com/api/v2";

async function uptimeApi(path: string, ctx: ToolContext, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${UPTIME_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.config.BETTERSTACK_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`[BetterStack] API request failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

export const betterstack: Skill = {
  id: "betterstack",
  name: "BetterStack",
  description: "Query incidents, monitors, and logs from BetterStack (Better Uptime + Logtail)",
  category: "observability",
  config: {
    BETTERSTACK_API_TOKEN: {
      description: "BetterStack API token (from Uptime > Settings > API)",
      required: true,
      env: "BETTERSTACK_API_TOKEN",
    },
  },
  tools: [
    {
      name: "betterstack_list_incidents",
      description: "List recent incidents from BetterStack Uptime. Returns ongoing and resolved incidents.",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "ISO 8601 start date (e.g. 2024-01-01T00:00:00Z)" },
          to: { type: "string", description: "ISO 8601 end date" },
          per_page: { type: "number", description: "Results per page (default 20, max 100)" },
        },
      },
      handler: async (input: any, ctx: ToolContext) => {
        const params = new URLSearchParams();
        if (input.from) params.set("from", input.from);
        if (input.to) params.set("to", input.to);
        if (input.per_page) params.set("per_page", String(input.per_page));
        const qs = params.toString();
        return uptimeApi(`/incidents${qs ? `?${qs}` : ""}`, ctx);
      },
    },
    {
      name: "betterstack_get_incident",
      description: "Get detailed information about a specific incident including timeline.",
      input_schema: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "Incident ID" },
        },
        required: ["incident_id"],
      },
      handler: async (input: any, ctx: ToolContext) => {
        return uptimeApi(`/incidents/${input.incident_id}`, ctx);
      },
    },
    {
      name: "betterstack_list_monitors",
      description: "List all monitors (uptime checks) and their current status.",
      input_schema: {
        type: "object",
        properties: {
          per_page: { type: "number", description: "Results per page (default 20, max 100)" },
        },
      },
      handler: async (input: any, ctx: ToolContext) => {
        const params = new URLSearchParams();
        if (input.per_page) params.set("per_page", String(input.per_page));
        const qs = params.toString();
        return uptimeApi(`/monitors${qs ? `?${qs}` : ""}`, ctx);
      },
    },
    {
      name: "betterstack_get_monitor",
      description: "Get details and recent status of a specific monitor.",
      input_schema: {
        type: "object",
        properties: {
          monitor_id: { type: "string", description: "Monitor ID" },
        },
        required: ["monitor_id"],
      },
      handler: async (input: any, ctx: ToolContext) => {
        return uptimeApi(`/monitors/${input.monitor_id}`, ctx);
      },
    },
    {
      name: "betterstack_list_on_call",
      description: "List current on-call calendars and who is on-call.",
      input_schema: {
        type: "object",
        properties: {},
      },
      handler: async (_input: any, ctx: ToolContext) => {
        return uptimeApi("/on-calls", ctx);
      },
    },
  ],
};
