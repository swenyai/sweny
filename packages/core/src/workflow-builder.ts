/**
 * Workflow Builder
 *
 * Generates and refines SWEny workflow definitions using the Claude
 * interface (headless Claude Code). Accepts a natural language
 * description and available skills, and returns a validated Workflow.
 */

import type { Workflow, Skill, Claude, Logger } from "./types.js";
import { workflowZ, validateWorkflow, workflowJsonSchema } from "./schema.js";

// ─── Public interface ─────────────────────────────────────────────

export interface BuildWorkflowOptions {
  /** Claude client (headless Claude Code) */
  claude: Claude;
  /** Skills available for use in the workflow */
  skills: Skill[];
  /** Optional logger */
  logger?: Logger;
}

// ─── Instruction quality guidance ────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Build the system prompt sent to Claude as the instruction.
 * Includes the JSON schema, available skills, instruction quality
 * guidance, rules, and optionally an existing workflow to refine.
 */
export function buildSystemPrompt(skills: Skill[], existingWorkflow?: Workflow): string {
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
    skillList || "(none)",
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
    "- Return ONLY the workflow JSON object — no markdown fences, no explanation",
  ];

  if (existingWorkflow) {
    parts.push("", "## Current Workflow (modify this)", "```json", JSON.stringify(existingWorkflow, null, 2), "```");
  }

  return parts.join("\n");
}

/**
 * Extract and validate a Workflow from the raw data returned by
 * claude.run(). The ClaudeClient spreads parsed JSON into data and
 * adds a `summary` key from the text response. We strip `summary`
 * and any other non-workflow keys before parsing.
 */
export function extractWorkflow(data: Record<string, unknown>): Workflow {
  // Remove keys added by ClaudeClient that aren't part of the workflow schema
  const { summary: _summary, ...rest } = data as { summary?: unknown } & Record<string, unknown>;

  // workflowZ.parse throws a ZodError on invalid input
  const parsed = workflowZ.parse(rest);

  const errors = validateWorkflow(parsed);
  if (errors.length > 0) {
    throw new Error(`Generated workflow has validation errors: ${errors.map((e) => e.message).join("; ")}`);
  }

  return parsed;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Generate a complete workflow from a natural language description.
 *
 * Builds a system prompt with the workflow JSON schema, available
 * skills, instruction quality guidance, and rules. Calls claude.run()
 * with no tools (pure generation task). Parses and validates the
 * returned JSON as a Workflow.
 */
export async function buildWorkflow(description: string, options: BuildWorkflowOptions): Promise<Workflow> {
  const { claude, skills, logger } = options;

  const instruction = buildSystemPrompt(skills);

  logger?.debug("buildWorkflow: calling claude.run", { description });

  const result = await claude.run({
    instruction,
    context: { description },
    tools: [],
  });

  if (result.status === "failed") {
    throw new Error(`Claude failed to generate workflow: ${result.data.error ?? "unknown error"}`);
  }

  return extractWorkflow(result.data);
}

/**
 * Refine an existing workflow based on a natural language instruction.
 *
 * Same as buildWorkflow but includes the current workflow in the
 * prompt as context so Claude can modify it.
 */
export async function refineWorkflow(
  workflow: Workflow,
  instruction: string,
  options: BuildWorkflowOptions,
): Promise<Workflow> {
  const { claude, skills, logger } = options;

  const systemPrompt = buildSystemPrompt(skills, workflow);

  logger?.debug("refineWorkflow: calling claude.run", { instruction });

  const result = await claude.run({
    instruction: systemPrompt,
    context: { instruction },
    tools: [],
  });

  if (result.status === "failed") {
    throw new Error(`Claude failed to refine workflow: ${result.data.error ?? "unknown error"}`);
  }

  return extractWorkflow(result.data);
}
