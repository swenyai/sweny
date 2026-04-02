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
  max_iterations: z.number().int().min(1).optional(),
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
    | "UNBOUNDED_CYCLE";
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
 * - Unbounded cycles (cycles with no max_iterations guard)
 * - (optional) All referenced skills exist in the provided skill set
 *
 * Note: nodes with no outgoing edges are valid terminal nodes — the executor
 * returns null when it reaches one, ending the workflow cleanly.
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
    if (edge.from === edge.to && !edge.max_iterations) {
      errors.push({
        code: "SELF_LOOP",
        message: `Edge from "${edge.from}" to itself (add max_iterations to allow)`,
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

  // Detect unbounded cycles: the graph with max_iterations edges removed must be acyclic.
  // If removing bounded edges still leaves a cycle, it can loop forever.
  const unboundedEdges = workflow.edges.filter((e) => !e.max_iterations && e.from !== e.to);
  // DFS-based cycle detection on the unbounded subgraph
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);

  function dfs(node: string): string | null {
    color.set(node, GRAY);
    for (const e of unboundedEdges) {
      if (e.from !== node) continue;
      const c = color.get(e.to);
      if (c === GRAY) return e.to; // back-edge found → cycle
      if (c === WHITE) {
        const cycle = dfs(e.to);
        if (cycle) return cycle;
      }
    }
    color.set(node, BLACK);
    return null;
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      const cycleNode = dfs(id);
      if (cycleNode) {
        errors.push({
          code: "UNBOUNDED_CYCLE",
          message: `Unbounded cycle detected involving node "${cycleNode}" — add max_iterations to at least one edge in the cycle`,
          nodeId: cycleNode,
        });
      }
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
  description: "A workflow definition for skill-based orchestration (supports controlled cycles via max_iterations)",
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
          max_iterations: {
            type: "integer",
            minimum: 1,
            description: "Max times this edge can be followed — enables controlled retry loops",
          },
        },
      },
    },
  },
} as const;
