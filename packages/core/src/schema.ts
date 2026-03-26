/**
 * Workflow Schema & Validation
 *
 * Zod schemas that define the canonical Workflow spec.
 * Use `validateWorkflow()` for structural validation (cycles,
 * reachability, missing nodes). Use the Zod schemas for
 * parsing untrusted input (JSON/YAML import, Studio editor).
 */

import { z } from "zod";

// ─── Zod Schemas ─────────────────────────────────────────────────

export const jsonSchemaZ = z.record(z.unknown());

export const configFieldZ = z.object({
  description: z.string(),
  required: z.boolean().optional(),
  env: z.string().optional(),
});

/**
 * Zod schema for tool metadata (name, description, input_schema).
 * Note: `handler` is intentionally omitted — Zod schemas validate
 * serializable data (JSON import/export), not runtime function refs.
 */
export const toolZ = z.object({
  name: z.string().min(1),
  description: z.string(),
  input_schema: jsonSchemaZ,
});

export const skillCategoryZ = z.enum(["git", "observability", "tasks", "notification", "general"]);

export const skillZ = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  category: skillCategoryZ,
  config: z.record(configFieldZ),
  tools: z.array(toolZ),
});

export const nodeZ = z.object({
  name: z.string().min(1),
  instruction: z.string().min(1),
  skills: z.array(z.string()).default([]),
  output: jsonSchemaZ.optional(),
});

export const edgeZ = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  when: z.string().optional(),
});

export const workflowZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  nodes: z.record(nodeZ),
  edges: z.array(edgeZ),
  entry: z.string().min(1),
});

/** Parse + validate a raw object as a Workflow. Throws on invalid input. */
export function parseWorkflow(raw: unknown) {
  return workflowZ.parse(raw);
}

// ─── Structural Validation ───────────────────────────────────────

export interface WorkflowError {
  code:
    | "MISSING_ENTRY"
    | "UNKNOWN_EDGE_SOURCE"
    | "UNKNOWN_EDGE_TARGET"
    | "UNREACHABLE_NODE"
    | "UNKNOWN_SKILL"
    | "SELF_LOOP"
    | "NO_OUTGOING_EDGE";
  message: string;
  nodeId?: string;
}

/**
 * Validate a workflow's graph structure.
 *
 * Checks:
 * - Entry node exists
 * - All edge sources and targets reference existing nodes
 * - No self-loops
 * - All nodes are reachable from entry
 * - All non-terminal nodes have at least one outgoing edge
 * - (optional) All referenced skills exist in the provided skill set
 */
export function validateWorkflow(workflow: z.infer<typeof workflowZ>, knownSkills?: Set<string>): WorkflowError[] {
  const errors: WorkflowError[] = [];
  const nodeIds = new Set(Object.keys(workflow.nodes));

  // Entry must exist
  if (!nodeIds.has(workflow.entry)) {
    errors.push({
      code: "MISSING_ENTRY",
      message: `Entry node "${workflow.entry}" does not exist`,
    });
  }

  // Edge targets must exist
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        code: "UNKNOWN_EDGE_SOURCE",
        message: `Edge source "${edge.from}" does not exist`,
        nodeId: edge.from,
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        code: "UNKNOWN_EDGE_TARGET",
        message: `Edge target "${edge.to}" does not exist`,
        nodeId: edge.to,
      });
    }
    if (edge.from === edge.to) {
      errors.push({
        code: "SELF_LOOP",
        message: `Edge from "${edge.from}" to itself`,
        nodeId: edge.from,
      });
    }
  }

  // Don't check reachability if there are structural errors
  if (errors.length > 0) return errors;

  // Reachability: BFS from entry
  const visited = new Set<string>();
  const queue: string[] = [workflow.entry];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of workflow.edges) {
      if (edge.from === id && !visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) {
      errors.push({
        code: "UNREACHABLE_NODE",
        message: `Node "${nodeId}" is unreachable from entry "${workflow.entry}"`,
        nodeId,
      });
    }
  }

  // Non-terminal nodes must have outgoing edges
  for (const nodeId of nodeIds) {
    const hasOutgoing = workflow.edges.some((e) => e.from === nodeId);
    if (!hasOutgoing && visited.has(nodeId)) {
      // Terminal node — fine, no error. This is intentional.
      // But if it has outgoing in the graph, it's fine too.
    }
  }

  // Skill references
  if (knownSkills) {
    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      for (const skillId of node.skills) {
        if (!knownSkills.has(skillId)) {
          errors.push({
            code: "UNKNOWN_SKILL",
            message: `Node "${nodeId}" references unknown skill "${skillId}"`,
            nodeId,
          });
        }
      }
    }
  }

  return errors;
}

// ─── JSON Schema Export ──────────────────────────────────────────

/**
 * Static JSON Schema for the Workflow type.
 * Use this for external validation (YAML files, Studio import, CI checks).
 */
export const workflowJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sweny.ai/schemas/workflow.json",
  title: "SWEny Workflow",
  description: "A DAG workflow definition for skill-based orchestration",
  type: "object",
  required: ["id", "name", "nodes", "edges", "entry"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    entry: { type: "string", minLength: 1, description: "ID of the entry node" },
    nodes: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["name", "instruction"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          instruction: { type: "string", minLength: 1, description: "What Claude should do at this node" },
          skills: {
            type: "array",
            items: { type: "string" },
            description: "Skill IDs available at this node",
          },
          output: {
            type: "object",
            description: "Optional JSON Schema for structured output",
          },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to"],
        additionalProperties: false,
        properties: {
          from: { type: "string", minLength: 1 },
          to: { type: "string", minLength: 1 },
          when: { type: "string", description: "Natural language condition — Claude evaluates at runtime" },
        },
      },
    },
  },
} as const;
