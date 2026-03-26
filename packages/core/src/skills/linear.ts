/**
 * Linear Skill
 *
 * Replaces: issue-tracking/linear.ts (~400 lines → ~80 lines)
 */

import type { Skill, ToolContext, SkillCategory } from "../types.js";

async function linearGql(query: string, variables: Record<string, unknown>, ctx: ToolContext) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: ctx.config.LINEAR_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`[Linear] API request failed (HTTP ${res.status}): ${await res.text()}`);
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(`[Linear] GraphQL error: ${json.errors[0].message}`);
  return json.data;
}

export const linear: Skill = {
  id: "linear",
  name: "Linear",
  description: "Create, search, and update issues in Linear",
  category: "tasks",
  config: {
    LINEAR_API_KEY: {
      description: "Linear API key",
      required: true,
      env: "LINEAR_API_KEY",
    },
  },
  tools: [
    {
      name: "linear_create_issue",
      description: "Create a new Linear issue",
      input_schema: {
        type: "object",
        properties: {
          teamId: { type: "string", description: "Linear team ID" },
          title: { type: "string" },
          description: { type: "string", description: "Markdown description" },
          priority: { type: "number", description: "0=none, 1=urgent, 2=high, 3=medium, 4=low" },
          labelIds: { type: "array", items: { type: "string" } },
        },
        required: ["teamId", "title"],
      },
      handler: async (input: any, ctx) =>
        linearGql(
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url title } } }`,
          { input },
          ctx,
        ),
    },
    {
      name: "linear_search_issues",
      description: "Search Linear issues by text query",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text" },
          limit: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["query"],
      },
      handler: async (input: { query: string; limit?: number }, ctx) =>
        linearGql(
          `query($query: String!, $first: Int) {
            searchIssues(term: $query, first: $first) {
              nodes { id identifier title state { name } priority url }
            }
          }`,
          { query: input.query, first: input.limit ?? 10 },
          ctx,
        ),
    },
    {
      name: "linear_update_issue",
      description: "Update an existing Linear issue",
      input_schema: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Linear issue ID" },
          title: { type: "string" },
          description: { type: "string" },
          stateId: { type: "string", description: "State/status ID" },
          priority: { type: "number" },
        },
        required: ["issueId"],
      },
      handler: async (input: { issueId: string; [key: string]: any }, ctx) => {
        const { issueId, ...updates } = input;
        return linearGql(
          `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier url title state { name } } } }`,
          { id: issueId, input: updates },
          ctx,
        );
      },
    },
  ],
};
