/**
 * Workflow Schema & Validation
 *
 * Zod schemas that define the canonical Workflow spec.
 * Use `validateWorkflow()` for structural validation (cycles,
 * reachability, missing nodes). Use the Zod schemas for
 * parsing untrusted input (JSON/YAML import, Studio editor).
 */

import { z } from "zod";
import type { Workflow } from "./types.js";
import {
  EVALUATOR_KINDS,
  EVAL_POLICIES,
  MCP_TRANSPORTS,
  REQUIRES_ON_FAIL,
  SKILL_CATEGORIES,
  SKILL_ID_MAX_LENGTH,
  SKILL_ID_PATTERN,
} from "./types.js";
import { sourceZ } from "./sources.js";
export { sourceZ };

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

export const skillCategoryZ = z.enum(SKILL_CATEGORIES);

export const mcpServerConfigZ = z
  .object({
    type: z.enum(MCP_TRANSPORTS).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })
  .strict()
  .refine((c) => c.command || c.url, {
    message: "MCP server must have either command (stdio) or url (HTTP)",
  });

export const skillDefinitionZ = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    instruction: z.string().optional(),
    mcp: mcpServerConfigZ.optional(),
  })
  .strict()
  .refine((s) => s.instruction || s.mcp, {
    message: "Inline skill must provide instruction, mcp, or both",
  });

export const skillZ = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string(),
    category: skillCategoryZ,
    config: z.record(configFieldZ).default({}),
    tools: z.array(toolZ).default([]),
    instruction: z.string().optional(),
    mcp: mcpServerConfigZ.optional(),
    mcpAliases: z.record(z.array(z.string().min(1)).min(1)).optional(),
  })
  .refine((s) => s.tools.length > 0 || s.instruction || s.mcp, {
    message: "Skill must provide at least one of: tools, instruction, or mcp",
  });

/**
 * NodeSources: either an array of Sources (additive — inherits cascade)
 * or an object `{ only?: boolean, sources: Source[] }` where `only: true`
 * blocks the cascade for that field.
 */
export const nodeSourcesZ = z.union([
  z.array(sourceZ),
  z.object({
    only: z.boolean().optional(),
    sources: z.array(sourceZ),
  }),
]);

export const outputMatchZ = z
  .object({
    path: z.string().min(1),
    equals: z.unknown().optional(),
    in: z.array(z.unknown()).optional(),
    matches: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (m) => {
      const operators = [m.equals !== undefined, m.in !== undefined, m.matches !== undefined];
      return operators.filter(Boolean).length === 1;
    },
    { message: "output_matches entry must declare exactly one of: equals, in, matches" },
  );

export const evaluatorKindZ = z.enum(EVALUATOR_KINDS);

export const evalPolicyZ = z.enum(EVAL_POLICIES);

export const evaluatorRuleZ = z
  .object({
    any_tool_called: z.array(z.string().min(1)).min(1).optional(),
    all_tools_called: z.array(z.string().min(1)).min(1).optional(),
    no_tool_called: z.array(z.string().min(1)).min(1).optional(),
    output_required: z.array(z.string().min(1)).min(1).optional(),
    output_matches: z.array(outputMatchZ).min(1).optional(),
  })
  .strict()
  .refine(
    (r) =>
      r.any_tool_called !== undefined ||
      r.all_tools_called !== undefined ||
      r.no_tool_called !== undefined ||
      r.output_required !== undefined ||
      r.output_matches !== undefined,
    {
      message:
        "evaluator rule must declare at least one of: any_tool_called, all_tools_called, no_tool_called, output_required, output_matches",
    },
  );

/**
 * A single evaluator. The `kind` field discriminates required-fields:
 * `value` and `function` need `rule`; `judge` needs `rubric`.
 *
 * Strict object: unknown keys are rejected to match the public JSON Schema.
 */
export const evaluatorZ = z
  .object({
    name: z.string().min(1),
    kind: evaluatorKindZ,
    rule: evaluatorRuleZ.optional(),
    rubric: z.string().min(1).optional(),
    // `pass_when` is parsed against a single VERDICT token from the model's
    // response (default `yes`). Whitespace breaks the prompt format and the
    // verdict comparison, so reject it at parse time rather than producing
    // a confusing runtime mismatch.
    pass_when: z
      .string()
      .min(1)
      .refine((v) => !/\s/.test(v), { message: "pass_when must be a single whitespace-free token" })
      .optional(),
    model: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.kind === "value" || e.kind === "function") {
      if (!e.rule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `evaluator '${e.name}' (kind: ${e.kind}) must declare a rule`,
          path: ["rule"],
        });
      }
      if (e.rubric !== undefined || e.pass_when !== undefined || e.model !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `evaluator '${e.name}' (kind: ${e.kind}) must not declare rubric / pass_when / model (those are 'judge' only)`,
          path: [],
        });
      }
    } else if (e.kind === "judge") {
      if (!e.rubric) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `evaluator '${e.name}' (kind: judge) must declare a rubric`,
          path: ["rubric"],
        });
      }
      if (e.rule !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `evaluator '${e.name}' (kind: judge) must not declare a rule`,
          path: ["rule"],
        });
      }
    }
  });

export const nodeRequiresZ = z
  .object({
    output_required: z.array(z.string().min(1)).min(1).optional(),
    output_matches: z.array(outputMatchZ).min(1).optional(),
    on_fail: z.enum(REQUIRES_ON_FAIL).optional(),
  })
  .strict()
  .refine((r) => r.output_required !== undefined || r.output_matches !== undefined, {
    message: "requires must declare at least one check (output_required or output_matches)",
  });

const retryInstructionAutoZ = z.object({ auto: z.literal(true) }).strict();
const retryInstructionReflectZ = z.object({ reflect: z.string().min(1) }).strict();

export const nodeRetryZ = z
  .object({
    max: z.number().int().min(1),
    instruction: z.union([z.string().min(1), retryInstructionAutoZ, retryInstructionReflectZ]).optional(),
  })
  .strict();

export const nodeZ = z
  .object({
    name: z.string().min(1),
    instruction: sourceZ,
    skills: z.array(z.string()).default([]),
    output: jsonSchemaZ.optional(),
    max_turns: z.number().int().min(1).optional(),
    rules: nodeSourcesZ.optional(),
    context: nodeSourcesZ.optional(),
    eval: z.array(evaluatorZ).min(1).optional(),
    eval_policy: evalPolicyZ.optional(),
    judge_model: z.string().min(1).optional(),
    requires: nodeRequiresZ.optional(),
    retry: nodeRetryZ.optional(),
  })
  .strict();

export const edgeZ = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    when: z.string().optional(),
    max_iterations: z.number().int().min(1).optional(),
  })
  .strict();

// Fix #4 gap — workflowZ is intentionally NOT .strict(). The published
// JSON Schema's `additionalProperties: false` only scopes the properties
// block, but marketplace workflows routinely carry top-level metadata
// (author, category, tags) handled by publish.ts. Striping rather than
// rejecting them preserves compatibility with the existing marketplace
// contract while the inner objects (nodes, edges, skills) stay strict.
export const workflowZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  nodes: z.record(nodeZ),
  edges: z.array(edgeZ),
  entry: z.string().min(1),
  skills: z.record(skillDefinitionZ).default({}),
  rules: z.array(sourceZ).optional(),
  context: z.array(sourceZ).optional(),
  judge_model: z.string().min(1).optional(),
  judge_budget: z.number().int().min(0).optional(),
});

const LEGACY_VERIFY_MESSAGE =
  "uses the legacy 'verify:' field. It was renamed to 'eval:' in @sweny-ai/core v0.2.0 with a different shape (named evaluators with kind: value | function | judge). " +
  "Migration guide: https://spec.sweny.ai/nodes/#eval";

/**
 * Detect legacy `verify:` blocks before parse and throw a clear migration
 * error. Without this preflight, the user gets Zod's generic "Unrecognized
 * key(s)" message at the node level (and silent passthrough at the
 * workflow level, since workflowZ allows extra top-level fields for
 * marketplace metadata).
 *
 * Catches:
 *   - Top-level `workflow.verify` (typo / wrong scope).
 *   - Per-node `nodes[*].verify` (the most common shape pre-rename).
 */
function preflightLegacyVerify(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const wf = raw as Record<string, unknown>;

  if ("verify" in wf) {
    throw new Error(`Workflow ${LEGACY_VERIFY_MESSAGE}`);
  }

  const nodes = wf.nodes;
  if (!nodes || typeof nodes !== "object") return;
  for (const [id, node] of Object.entries(nodes as Record<string, unknown>)) {
    if (node && typeof node === "object" && "verify" in node) {
      throw new Error(`Node "${id}" ${LEGACY_VERIFY_MESSAGE}`);
    }
  }
}

/** Parse + validate a raw object as a Workflow. Throws on invalid input. */
export function parseWorkflow(raw: unknown) {
  preflightLegacyVerify(raw);
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
    | "UNBOUNDED_CYCLE"
    | "INVALID_INLINE_SKILL";
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
export function validateWorkflow(
  workflow: Workflow | z.infer<typeof workflowZ>,
  knownSkills?: Set<string>,
): WorkflowError[] {
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

  // Inline skill definitions must have instruction or mcp
  for (const [skillId, def] of Object.entries(workflow.skills ?? {})) {
    if (!def.instruction && !def.mcp) {
      errors.push({
        code: "INVALID_INLINE_SKILL",
        message: `Inline skill "${skillId}" must provide at least instruction or mcp`,
      });
    }
  }

  // Skill references
  if (knownSkills) {
    // Merge workflow inline skills into known set
    const allKnown = new Set(knownSkills);
    for (const id of Object.keys(workflow.skills ?? {})) {
      allKnown.add(id);
    }
    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      for (const skillId of node.skills) {
        if (!allKnown.has(skillId)) {
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
const sourceJsonSchema = {
  oneOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: { inline: { type: "string", minLength: 1 } },
      required: ["inline"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { file: { type: "string", minLength: 1 } },
      required: ["file"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        type: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  ],
} as const;

export const workflowJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://spec.sweny.ai/schemas/workflow.json",
  title: "SWEny Workflow",
  description:
    "A declarative YAML format for AI agent orchestration as a directed graph with natural language routing.",
  type: "object",
  required: ["id", "name", "nodes", "edges", "entry"],
  // Top-level is intentionally open: marketplace workflows carry extra
  // metadata (author, category, tags) that publish.ts reads. Inner
  // objects (nodes, edges, skills, eval, requires, etc.) are strict.
  additionalProperties: true,
  $defs: {
    Source: sourceJsonSchema,
    NodeSources: {
      oneOf: [
        { type: "array", items: { $ref: "#/$defs/Source" } },
        {
          type: "object",
          required: ["sources"],
          additionalProperties: false,
          properties: {
            only: { type: "boolean" },
            sources: { type: "array", items: { $ref: "#/$defs/Source" } },
          },
        },
      ],
    },
    OutputMatch: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1 },
        equals: {},
        in: { type: "array" },
        matches: { type: "string", minLength: 1 },
      },
      oneOf: [{ required: ["equals"] }, { required: ["in"] }, { required: ["matches"] }],
    },
    Evaluator: {
      type: "object",
      required: ["name", "kind"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          minLength: 1,
          description: "Stable identifier for this evaluator. Used in EvalResult and retry preambles.",
        },
        kind: { type: "string", enum: [...EVALUATOR_KINDS] },
        rule: {
          type: "object",
          description: "Required for value and function kinds. Shape depends on kind.",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            any_tool_called: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
            all_tools_called: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
            no_tool_called: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
            output_required: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
            output_matches: { type: "array", items: { $ref: "#/$defs/OutputMatch" }, minItems: 1 },
          },
        },
        rubric: {
          type: "string",
          minLength: 1,
          description: "Required for judge kind. Natural-language criterion the judge model evaluates.",
        },
        pass_when: {
          type: "string",
          minLength: 1,
          default: "yes",
          description: "judge only. Verdict token that indicates pass. Default 'yes'.",
        },
        model: {
          type: "string",
          minLength: 1,
          description: "judge only. Override the judge model for this evaluator.",
        },
      },
      allOf: [
        {
          if: { properties: { kind: { enum: ["value", "function"] } } },
          then: { required: ["rule"] },
        },
        {
          if: { properties: { kind: { const: "judge" } } },
          then: { required: ["rubric"] },
        },
      ],
    },
  },
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    entry: { type: "string", minLength: 1, description: "ID of the entry node" },
    rules: {
      type: "array",
      items: { $ref: "#/$defs/Source" },
      description: "Directives prepended to every node's instruction.",
    },
    context: {
      type: "array",
      items: { $ref: "#/$defs/Source" },
      description: "Background knowledge prepended to every node's instruction.",
    },
    judge_model: {
      type: "string",
      minLength: 1,
      default: "claude-haiku-4-5",
      description: "Default model for judge evaluators across the workflow. Overridable per-node and per-evaluator.",
    },
    judge_budget: {
      type: "integer",
      minimum: 0,
      default: 50,
      description:
        "Soft cap on expected judge calls per workflow run. Executor warns at load time if exceeded; not a hard runtime cap in v1.",
    },
    nodes: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["name", "instruction"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          instruction: { $ref: "#/$defs/Source", description: "Natural language instruction for the AI model." },
          skills: {
            type: "array",
            items: { type: "string" },
            description: "Skill IDs available at this node",
          },
          output: {
            type: "object",
            description: "Optional JSON Schema for structured output",
          },
          max_turns: {
            type: "integer",
            minimum: 1,
            description: "Max AI model turns for this node. When absent, the executor's default applies.",
          },
          rules: {
            $ref: "#/$defs/NodeSources",
            description: "Per-node rules. Additive by default; set { only: true } to block cascade.",
          },
          context: {
            $ref: "#/$defs/NodeSources",
            description: "Per-node context. Additive by default; set { only: true } to block cascade.",
          },
          eval: {
            type: "array",
            description: "Named evaluators (value, function, judge) run after the LLM finishes the node.",
            items: { $ref: "#/$defs/Evaluator" },
            minItems: 1,
          },
          eval_policy: {
            type: "string",
            enum: [...EVAL_POLICIES],
            default: "all_pass",
            description: "How evaluator results aggregate. v1 implements all_pass; the others are reserved.",
          },
          judge_model: {
            type: "string",
            minLength: 1,
            description: "Default model for judge evaluators on this node. Overrides workflow-level judge_model.",
          },
          requires: {
            type: "object",
            description: "Pre-condition checks evaluated before the LLM runs.",
            additionalProperties: false,
            // Fix #4: at least one of output_required / output_matches must be declared.
            // on_fail alone is not sufficient. It only tags how a failing check behaves.
            anyOf: [{ required: ["output_required"] }, { required: ["output_matches"] }],
            properties: {
              output_required: {
                type: "array",
                items: { type: "string", minLength: 1 },
                minItems: 1,
              },
              output_matches: {
                type: "array",
                items: { $ref: "#/$defs/OutputMatch" },
                minItems: 1,
              },
              on_fail: { type: "string", enum: [...REQUIRES_ON_FAIL] },
            },
          },
          retry: {
            type: "object",
            description: "Node-local retry on eval failure.",
            required: ["max"],
            additionalProperties: false,
            properties: {
              max: { type: "integer", minimum: 1 },
              instruction: {
                oneOf: [
                  { type: "string", minLength: 1 },
                  {
                    type: "object",
                    required: ["auto"],
                    additionalProperties: false,
                    properties: { auto: { const: true } },
                  },
                  {
                    type: "object",
                    required: ["reflect"],
                    additionalProperties: false,
                    properties: { reflect: { type: "string", minLength: 1 } },
                  },
                ],
              },
            },
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
          when: { type: "string", description: "Natural language condition. Claude evaluates at runtime." },
          max_iterations: {
            type: "integer",
            minimum: 1,
            description: "Max times this edge can be followed. Enables controlled retry loops.",
          },
        },
      },
    },
    skills: {
      type: "object",
      description: "Inline skill definitions scoped to this workflow",
      additionalProperties: {
        type: "object",
        // Fix #4: an inline skill must provide instruction, mcp, or both.
        anyOf: [{ required: ["instruction"] }, { required: ["mcp"] }],
        // Round 2: reject unknown keys to match Zod skillDefinitionZ.strict().
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          instruction: { type: "string", description: "Natural language expertise injected into the node prompt" },
          mcp: {
            type: "object",
            description: "External MCP server definition",
            // Fix #4: an MCP server must declare command (stdio) or url (http).
            anyOf: [{ required: ["command"] }, { required: ["url"] }],
            // Round 2: reject unknown keys to match Zod mcpServerConfigZ.strict().
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: [...MCP_TRANSPORTS] },
              command: { type: "string" },
              args: { type: "array", items: { type: "string" } },
              url: { type: "string" },
              headers: { type: "object", additionalProperties: { type: "string" } },
              env: { type: "object", additionalProperties: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Skill JSON Schema, generated from runtime constants.
 *
 * Companion to {@link workflowJsonSchema}: published at
 * https://spec.sweny.ai/schemas/skill.json by the
 * `write-public-schema.mjs` build step. Validates the structural shape
 * of a Skill (id, name, description, category, config, plus optional
 * tools/instruction/mcp).
 *
 * Every enum and the `id` pattern + maxLength are imported from
 * `types.ts` so adding a category, harness, transport, or changing the
 * id rule updates the published schema with no manual sync.
 */
export const skillJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://spec.sweny.ai/schemas/skill.json",
  title: "SWEny Skill",
  description: "A composable tool bundle that provides capabilities to workflow nodes.",
  type: "object",
  required: ["id", "name", "description", "category", "config"],
  anyOf: [{ required: ["tools"] }, { required: ["instruction"] }, { required: ["mcp"] }],
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      minLength: 1,
      maxLength: SKILL_ID_MAX_LENGTH,
      pattern: SKILL_ID_PATTERN.source,
      description: "Unique skill identifier. Referenced by nodes' skills arrays. Lowercase kebab-case recommended.",
    },
    name: {
      type: "string",
      minLength: 1,
      description: "Human-readable skill name.",
    },
    description: {
      type: "string",
      description: "What this skill provides.",
    },
    category: {
      type: "string",
      enum: [...SKILL_CATEGORIES],
      description: "Functional category.",
    },
    config: {
      type: "object",
      description: "Configuration fields required by this skill.",
      additionalProperties: { $ref: "#/$defs/ConfigField" },
    },
    tools: {
      type: "array",
      description: "Tools this skill provides to nodes.",
      items: { $ref: "#/$defs/Tool" },
    },
    instruction: {
      type: "string",
      description: "Natural language expertise injected into the node prompt when this skill is referenced.",
    },
    mcp: {
      $ref: "#/$defs/McpServerConfig",
      description: "External MCP server definition wired for nodes referencing this skill.",
    },
  },
  $defs: {
    ConfigField: {
      type: "object",
      required: ["description"],
      additionalProperties: false,
      properties: {
        description: {
          type: "string",
          description: "Human-readable description of this config field.",
        },
        required: {
          type: "boolean",
          default: false,
          description: "Whether this field must be provided for the skill to function.",
        },
        env: {
          type: "string",
          description: "Default environment variable to read this value from.",
        },
      },
    },
    Tool: {
      type: "object",
      required: ["name", "description", "input_schema"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Tool name. Must be unique within the skill.",
        },
        description: {
          type: "string",
          description: "What this tool does. Provided to the AI model for tool selection.",
        },
        input_schema: {
          type: "object",
          description: "JSON Schema defining the tool's input parameters.",
        },
      },
    },
    McpServerConfig: {
      type: "object",
      description: "External MCP server definition.",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: [...MCP_TRANSPORTS],
          description: "Transport type. Inferred from presence of command (stdio) or url (http) when omitted.",
        },
        command: {
          type: "string",
          description: "Spawn command (stdio transport).",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments for the command.",
        },
        url: {
          type: "string",
          format: "uri",
          description: "HTTP endpoint (HTTP transport).",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "HTTP headers (HTTP transport only).",
        },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Environment variable names the server needs. Values are descriptions, not secrets.",
        },
      },
    },
  },
} as const;
