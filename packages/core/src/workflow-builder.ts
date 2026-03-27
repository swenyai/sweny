import type { Workflow, Skill } from "./types.js";
import { workflowZ, validateWorkflow, workflowJsonSchema } from "./schema.js";

export interface BuildWorkflowOptions {
  apiKey: string;
  skills: { id: string; name: string; description: string }[];
}

const INSTRUCTION_GUIDANCE = `Each node's \`instruction\` field is a detailed prompt that Claude will execute autonomously.
Write instructions as if briefing a skilled engineer who has access to the node's tools
but no other context. Be specific about:

- WHAT to query/search/create (not just "check for errors" — specify filters, time ranges, grouping)
- HOW to interpret results (what counts as actionable? what thresholds matter?)
- WHAT output to produce (structured findings, not just "summarize")
- HOW to handle edge cases (no results found, too many results, ambiguous data)

Bad:  "Query Sentry for errors"
Good: "Query Sentry for unresolved errors from the last 24 hours. Group by issue
       fingerprint. For each group, note: error count, affected services, first/last
       seen timestamps, and stack trace summary. Prioritize by frequency × recency.
       If no errors found, report that explicitly so downstream nodes can skip."`;

function buildSystemPrompt(skills: BuildWorkflowOptions["skills"], existingWorkflow?: Workflow): string {
  const skillList = skills.map((s) => `- ${s.id}: ${s.description}`).join("\n");

  const parts = [
    "You generate SWEny workflow definitions as JSON.",
    "",
    "## Workflow JSON Schema",
    "```json",
    JSON.stringify(workflowJsonSchema, null, 2),
    "```",
    "",
    "## Available Skills",
    skillList,
    "",
    "## Instruction Quality",
    INSTRUCTION_GUIDANCE,
    "",
    "## Rules",
    "- Use snake_case for node IDs (e.g. gather_errors, create_ticket)",
    "- Set `entry` to the first node in the flow",
    "- Only reference skill IDs from the list above in node `skills` arrays",
    "- Use natural language for edge `when` conditions",
    "- Every node must be reachable from the entry node",
    "- Return ONLY valid JSON — no markdown fences, no explanation",
  ];

  if (existingWorkflow) {
    parts.push("", "## Current Workflow (modify this)", "```json", JSON.stringify(existingWorkflow, null, 2), "```");
  }

  return parts.join("\n");
}

async function callApi(apiKey: string, system: string, userMessage: string): Promise<Workflow> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) throw new Error("Invalid API key");
    if (response.status === 429) throw new Error("Rate limited — try again in a moment");
    throw new Error(`API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { content: { type: string; text: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text in API response");

  // Extract JSON from response (may be wrapped in markdown fences)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  const jsonStr = (jsonMatch[1] ?? text).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse workflow JSON from API response");
  }

  const workflow = workflowZ.parse(parsed);
  const errors = validateWorkflow(workflow);
  if (errors.length > 0) {
    throw new Error(`Generated workflow has validation errors: ${errors.map((e) => e.message).join("; ")}`);
  }

  return workflow;
}

/**
 * Generate a complete workflow from a natural language description.
 */
export async function buildWorkflow(description: string, options: BuildWorkflowOptions): Promise<Workflow> {
  const system = buildSystemPrompt(options.skills);
  return callApi(options.apiKey, system, description);
}

/**
 * Refine an existing workflow based on a natural language instruction.
 */
export async function refineWorkflow(
  workflow: Workflow,
  instruction: string,
  options: BuildWorkflowOptions,
): Promise<Workflow> {
  const system = buildSystemPrompt(options.skills, workflow);
  return callApi(options.apiKey, system, `Modify the workflow: ${instruction}`);
}
