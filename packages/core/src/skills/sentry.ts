/**
 * Sentry Skill
 *
 * Replaces: observability/sentry.ts
 */

import type { Skill, ToolContext, SkillCategory } from "../types.js";

async function sentryApi(path: string, ctx: ToolContext): Promise<unknown> {
  const base = ctx.config.SENTRY_BASE_URL || "https://sentry.io";
  const res = await fetch(`${base}/api/0${path}`, {
    headers: { Authorization: `Bearer ${ctx.config.SENTRY_AUTH_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`[Sentry] API request failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

export const sentry: Skill = {
  id: "sentry",
  name: "Sentry",
  description: "Query errors, issues, and performance data from Sentry",
  category: "observability",
  config: {
    SENTRY_AUTH_TOKEN: {
      description: "Sentry authentication token",
      required: true,
      env: "SENTRY_AUTH_TOKEN",
    },
    SENTRY_ORG: {
      description: "Sentry organization slug",
      required: true,
      env: "SENTRY_ORG",
    },
    SENTRY_BASE_URL: {
      description: "Sentry base URL (default: https://sentry.io)",
      required: false,
      env: "SENTRY_BASE_URL",
    },
  },
  tools: [
    {
      name: "sentry_list_issues",
      description: "List recent issues for a Sentry project",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Sentry project slug" },
          query: { type: "string", description: "Search query (e.g., 'is:unresolved level:error')" },
        },
        required: ["project"],
      },
      handler: async (input: { project: string; query?: string }, ctx) => {
        const q = encodeURIComponent(input.query ?? "is:unresolved");
        return sentryApi(`/projects/${ctx.config.SENTRY_ORG}/${input.project}/issues/?query=${q}`, ctx);
      },
    },
    {
      name: "sentry_get_issue",
      description: "Get detailed information about a Sentry issue",
      input_schema: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Sentry issue ID" },
        },
        required: ["issueId"],
      },
      handler: async (input: { issueId: string }, ctx) => sentryApi(`/issues/${input.issueId}/`, ctx),
    },
    {
      name: "sentry_get_issue_events",
      description: "Get recent events (occurrences) for a Sentry issue",
      input_schema: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Sentry issue ID" },
        },
        required: ["issueId"],
      },
      handler: async (input: { issueId: string }, ctx) => sentryApi(`/issues/${input.issueId}/events/?full=true`, ctx),
    },
    {
      name: "sentry_search_events",
      description: "Search events across a project using Discover query syntax",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Sentry project slug" },
          query: { type: "string", description: "Discover query" },
          fields: {
            type: "array",
            items: { type: "string" },
            description: "Fields to return (e.g., ['title', 'count()', 'last_seen()'])",
          },
        },
        required: ["project", "fields"],
      },
      handler: async (input: { project: string; query?: string; fields: string[] }, ctx) => {
        const params = new URLSearchParams();
        if (input.query) params.set("query", input.query);
        for (const f of input.fields) params.append("field", f);
        return sentryApi(`/organizations/${ctx.config.SENTRY_ORG}/events/?project=${input.project}&${params}`, ctx);
      },
    },
  ],
};
