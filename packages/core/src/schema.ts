/**
 * Workflow Schema & Validation
 *
 * Zod schemas that define the canonical Workflow spec.
 * Use `validateWorkflow()` for structural validation (cycles,
 * reachability, missing nodes). Use the Zod schemas for
 * parsing untrusted input (JSON/YAML import, Studio editor).
 */

import { z } from "zod";
import type { Workflow, WorkflowType } from "./types.js";
import {
  AUTHOR_ASSOCIATIONS,
  CONTEXT_MODES,
  EVALUATOR_KINDS,
  EVAL_POLICIES,
  MCP_TRANSPORTS,
  NODE_ACCESS,
  NODE_ON_FAIL,
  REQUIRES_ON_FAIL,
  SAFE_OUTPUT_APPLIERS,
  SAFE_OUTPUT_EXPIRES_PATTERN,
  SAFE_OUTPUT_MAX_CEILING,
  SAFE_OUTPUT_STATES,
  SAFE_OUTPUT_TYPES,
  SKILL_CATEGORIES,
  SKILL_ID_MAX_LENGTH,
  SKILL_ID_PATTERN,
  TOOL_ACCESS,
  TOOL_CLASSES,
  WORKFLOW_TYPES,
} from "./types.js";
import { sourceZ } from "./sources.js";
import { workflowInputsZ, WORKFLOW_INPUT_TYPES } from "./inputs.js";
export { sourceZ };
export { workflowInputsZ };

// ─── Zod Schemas ─────────────────────────────────────────────────

export const jsonSchemaZ = z.record(z.unknown());

// .strict() to match the published skill JSON Schema's ConfigField
// `additionalProperties: false`. Without it Zod silently STRIPPED an unknown
// nested key while ajv REJECTED it (the #214/#225 divergence class, missed for
// configFieldZ/toolZ). custom-loader.ts builds Skill objects from frontmatter
// and never runs these schemas, so tightening is safe downstream.
export const configFieldZ = z
  .object({
    description: z.string(),
    required: z.boolean().optional(),
    env: z.string().optional(),
  })
  .strict();

/**
 * Zod schema for tool metadata (name, description, input_schema).
 * Note: `handler` is intentionally omitted — Zod schemas validate
 * serializable data (JSON import/export), not runtime function refs.
 *
 * .strict() to match the published Tool `$def`'s `additionalProperties: false`.
 */
export const toolZ = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    input_schema: jsonSchemaZ,
    access: z.enum(TOOL_ACCESS).optional(),
  })
  .strict();

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
  .refine((s) => Boolean(s.instruction?.trim()), {
    message: "Inline skill must provide a non-empty instruction",
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
  // Strict to match the published skill JSON Schema's
  // `additionalProperties: false`. Without this an unknown top-level key was
  // silently STRIPPED by Zod but REJECTED by ajv (the one remaining
  // Zod<->ajv skill divergence #214 flagged). custom-loader.ts builds Skill
  // objects from frontmatter directly and never runs skillZ, so nothing
  // downstream relies on extra keys passing through.
  .strict()
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

/**
 * Eval policies actually implemented at runtime. The Zod schema and published
 * JSON schema accept the full {@link EVAL_POLICIES} vocabulary (the others are
 * reserved), but `validateWorkflow` rejects any policy not in this set so a
 * workflow fails at load time rather than throwing mid-run from `aggregateEval`.
 */
const SUPPORTED_EVAL_POLICIES = new Set<string>(["all_pass"]);

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

/**
 * Per-node skill-tool filter. `allow` keeps only the listed skill tools;
 * `deny` removes the listed skill tools (applied after `allow`). At least
 * one of the two must be declared. Complements `disallowed_tools`, which
 * covers built-in agent tools only.
 */
export const nodeToolsZ = z
  .object({
    allow: z.array(z.string().min(1)).min(1).optional(),
    deny: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((t) => t.allow !== undefined || t.deny !== undefined, {
    message: "tools must declare at least one of allow or deny",
  });

const retryInstructionAutoZ = z.object({ auto: z.literal(true) }).strict();
const retryInstructionReflectZ = z.object({ reflect: z.string().min(1) }).strict();

/**
 * Ceiling on `retry.max`. Each retry attempt re-invokes the agent on the
 * node (full model spend), so an unbounded value here is an unbounded spend
 * multiplier per node, independent of the workflow-level `max_steps` budget.
 * 10 comfortably covers every declared workflow today (max observed: 1) while
 * still catching a fat-fingered value (e.g. a missing digit) at author time
 * instead of at runtime. See #325.
 */
export const NODE_RETRY_MAX_CEILING = 10;

/**
 * Ceiling on an edge's `max_iterations`. A bounded back-edge is still a spend
 * multiplier (each lap re-runs model nodes), and the default `max_steps` is
 * 200, so a value above this can never be reached in a default run and only
 * hides a typo. See #325.
 */
export const EDGE_MAX_ITERATIONS_CEILING = 100;

export const nodeRetryZ = z
  .object({
    max: z.number().int().min(1).max(NODE_RETRY_MAX_CEILING),
    instruction: z.union([z.string().min(1), retryInstructionAutoZ, retryInstructionReflectZ]).optional(),
  })
  .strict();

/**
 * Node / workflow permissions (#365): `read` | `write`, or an object with
 * `access`, `deny` (portable tool classes) and `strict`. The object form must
 * declare at least one key.
 */
export const nodePermissionsZ = z.union([
  z.enum(NODE_ACCESS),
  z
    .object({
      access: z.enum(NODE_ACCESS).optional(),
      deny: z.array(z.enum(TOOL_CLASSES)).min(1).optional(),
      strict: z.boolean().optional(),
    })
    .strict()
    .refine((p) => p.access !== undefined || p.deny !== undefined || p.strict !== undefined, {
      message: "permissions must declare at least one of access, deny, strict",
    }),
]);

/**
 * Spend ceiling (#449): input + output tokens and/or reported USD. The object
 * must declare at least one of the two.
 */
export const budgetZ = z
  .object({
    tokens: z.number().int().min(1).optional(),
    cost_usd: z.number().positive().optional(),
  })
  .strict()
  .refine((b) => b.tokens !== undefined || b.cost_usd !== undefined, {
    message: "budget must declare at least one of tokens, cost_usd",
  });

/** One typed write intent a node may emit (#365). */
export const safeOutputDeclarationZ = z
  .object({
    type: z.enum(SAFE_OUTPUT_TYPES),
    via: z.string().min(1).optional(),
    max: z.number().int().min(1).max(SAFE_OUTPUT_MAX_CEILING).optional(),
    target: z.string().min(1).optional(),
    title_prefix: z.string().min(1).max(64).optional(),
    labels: z.array(z.string().min(1)).min(1).optional(),
    expires: z.string().regex(SAFE_OUTPUT_EXPIRES_PATTERN).optional(),
    number: z
      .union([z.string().min(1), z.number().int().min(1), z.object({ input: z.string().min(1) }).strict()])
      .optional(),
    state: z.enum(SAFE_OUTPUT_STATES).optional(),
  })
  .strict();

/** Workflow-level safe-output policy (#365): the ceiling and run-wide limits. */
export const safeOutputsPolicyZ = z
  .object({
    allow: z.array(z.enum(SAFE_OUTPUT_TYPES)).min(1).optional(),
    max: z.number().int().min(1).max(SAFE_OUTPUT_MAX_CEILING).optional(),
    staged: z.boolean().optional(),
    trusted_actors: z.array(z.string().min(1)).min(1).optional(),
    trusted_associations: z.array(z.enum(AUTHOR_ASSOCIATIONS)).min(1).optional(),
    screen: z.boolean().optional(),
  })
  .strict();

export const nodeZ = z
  .object({
    name: z.string().min(1),
    instruction: sourceZ,
    skills: z.array(z.string()).default([]),
    output: jsonSchemaZ.optional(),
    max_turns: z.number().int().min(1).optional(),
    budget: budgetZ.optional(),
    disallowed_tools: z.array(z.string().min(1)).optional(),
    tools: nodeToolsZ.optional(),
    fail_soft: z.boolean().optional(),
    on_fail: z.enum(NODE_ON_FAIL).optional(),
    permissions: nodePermissionsZ.optional(),
    outputs: z.array(safeOutputDeclarationZ).min(1).optional(),
    rules: nodeSourcesZ.optional(),
    context: nodeSourcesZ.optional(),
    eval: z.array(evaluatorZ).min(1).optional(),
    eval_policy: evalPolicyZ.optional(),
    judge_model: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    requires: nodeRequiresZ.optional(),
    retry: nodeRetryZ.optional(),
  })
  .strict();

export const edgeZ = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    when: z.string().optional(),
    max_iterations: z.number().int().min(1).max(EDGE_MAX_ITERATIONS_CEILING).optional(),
  })
  .strict();

/**
 * Workflow type discriminator. Cloud uses this to route runs to a
 * type-specific renderer (Caught/Calibration/Missed for `pr_review`, flake
 * heatmap for `e2e_test`, source coverage delta for `monitor`, etc.).
 *
 * The field is optional on the workflow YAML; absence defaults to `generic`,
 * which gets a baseline renderer. Marketplace templates published in v1+
 * are required to declare it.
 *
 * Adding a new value here is a deliberate spec change: it requires a new
 * cloud renderer + metric schema. Don't extend casually.
 */
export const workflowTypeZ = z.enum(WORKFLOW_TYPES);
// Re-export the single-sourced TS type (defined in types.ts as the
// derived `WorkflowType`) so existing `import { WorkflowType } from
// "./schema.js"` consumers keep working without a second definition.
export type { WorkflowType };

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
  spec_version: z
    .string()
    .regex(/^[1-9]\d*$/, "spec_version must be a positive integer string")
    .optional(),
  workflow_type: workflowTypeZ.optional(),
  nodes: z.record(nodeZ),
  edges: z.array(edgeZ),
  entry: z.string().min(1),
  skills: z.record(skillDefinitionZ).default({}),
  rules: z.array(sourceZ).optional(),
  context: z.array(sourceZ).optional(),
  judge_model: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  judge_budget: z.number().int().min(0).optional(),
  budget: budgetZ.optional(),
  context_mode: z.enum(CONTEXT_MODES).optional(),
  inputs: workflowInputsZ.optional(),
  permissions: nodePermissionsZ.optional(),
  safe_outputs: safeOutputsPolicyZ.optional(),
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
export function preflightLegacyVerify(raw: unknown): void {
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
    | "AMBIGUOUS_EDGES"
    | "UNSUPPORTED_EVAL_POLICY"
    | "INVALID_INLINE_SKILL"
    | "EDGE_ITERATIONS_EXCEEDED"
    | "RETRY_MAX_EXCEEDED"
    | "PERMISSION_CEILING"
    | "BUDGET_CEILING"
    | "OUTPUT_NOT_ALLOWED"
    | "DUPLICATE_OUTPUT"
    | "UNSUPPORTED_OUTPUT";
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
  const entryExists = nodeIds.has(workflow.entry);

  // Entry must exist
  if (!entryExists) {
    errors.push({
      code: "MISSING_ENTRY",
      message: `Entry node "${workflow.entry}" does not exist`,
    });
  }

  // Adjacency over real nodes, built once (O(nodes + edges)) so reachability
  // and cycle detection stay linear on large graphs.
  const outAll = new Map<string, string[]>();
  const outUnbounded = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };

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
    if (edge.max_iterations != null && edge.max_iterations > EDGE_MAX_ITERATIONS_CEILING) {
      errors.push({
        code: "EDGE_ITERATIONS_EXCEEDED",
        message: `Edge from "${edge.from}" to "${edge.to}" declares max_iterations ${edge.max_iterations}, above the ceiling of ${EDGE_MAX_ITERATIONS_CEILING}`,
        nodeId: edge.from,
      });
    }
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      push(outAll, edge.from, edge.to);
      if (!edge.max_iterations && edge.from !== edge.to) push(outUnbounded, edge.from, edge.to);
    }
  }

  // Edge determinism: a node with two or more out-edges that have no `when`
  // clause is ambiguous. The executor's resolveNext picks the first such edge
  // and silently drops the rest, wasting a route eval on a deterministic hop
  // and leaving the other targets unreachable. Reject it at load time so the
  // author sees the problem instead of getting a silent first-edge-wins.
  // Only count edges whose source is a real node (broken sources are already
  // reported above as UNKNOWN_EDGE_SOURCE).
  const unconditionalByNode = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) continue;
    if (edge.when) continue;
    push(unconditionalByNode, edge.from, edge.to);
  }
  for (const [from, targets] of unconditionalByNode) {
    if (targets.length > 1) {
      errors.push({
        code: "AMBIGUOUS_EDGES",
        message: `Node "${from}" has ${targets.length} unconditional out-edges (to ${targets.join(", ")}); add a 'when' clause to all but one so routing is deterministic`,
        nodeId: from,
      });
    }
  }

  // Reachability: BFS from entry. Skipped only when the entry is missing
  // (every node would be reported, which is noise). All other diagnostics
  // accumulate so one pass reports every structural problem.
  if (entryExists) {
    const visited = new Set<string>([workflow.entry]);
    const queue: string[] = [workflow.entry];
    for (let i = 0; i < queue.length; i++) {
      for (const to of outAll.get(queue[i]) ?? []) {
        if (!visited.has(to)) {
          visited.add(to);
          queue.push(to);
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
  }

  // Detect unbounded cycles: the graph with max_iterations edges removed must be acyclic.
  // If removing bounded edges still leaves a cycle, it can loop forever.
  // Iterative DFS with an explicit stack so a deep chain cannot overflow the
  // call stack (#326).
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);

  const findCycle = (start: string): string | null => {
    const stack: Array<{ node: string; i: number }> = [{ node: start, i: 0 }];
    color.set(start, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const outs = outUnbounded.get(top.node) ?? [];
      if (top.i >= outs.length) {
        color.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      const to = outs[top.i++];
      const c = color.get(to);
      if (c === GRAY) return to; // back-edge found → cycle
      if (c === WHITE) {
        color.set(to, GRAY);
        stack.push({ node: to, i: 0 });
      }
    }
    return null;
  };

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      const cycleNode = findCycle(id);
      if (cycleNode) {
        errors.push({
          code: "UNBOUNDED_CYCLE",
          message: `Unbounded cycle detected involving node "${cycleNode}" — add max_iterations to at least one edge in the cycle`,
          nodeId: cycleNode,
        });
      }
    }
  }

  // Retry ceiling for workflows that never went through zod (library callers,
  // the e2e batch runner). Mirrors nodeRetryZ so every path enforces it (#325).
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    const max = node.retry?.max;
    if (max != null && max > NODE_RETRY_MAX_CEILING) {
      errors.push({
        code: "RETRY_MAX_EXCEEDED",
        message: `Node "${nodeId}" declares retry.max ${max}, above the ceiling of ${NODE_RETRY_MAX_CEILING}`,
        nodeId,
      });
    }
  }

  // Reject eval policies that are reserved in the vocabulary but not yet
  // implemented. The Zod schema accepts the whole EVAL_POLICIES enum (the
  // published JSON schema advertises them as reserved), but only `all_pass`
  // is implemented at runtime. Without this check a workflow declaring
  // `eval_policy: "any_pass"` or `"weighted"` parses and validates cleanly,
  // then `aggregateEval` throws uncaught mid-run — a validate-then-crash
  // failure mode. Reject it at load time instead. The runtime throw in
  // aggregateEval stays as a defense-in-depth backstop.
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.eval_policy != null && !SUPPORTED_EVAL_POLICIES.has(node.eval_policy)) {
      errors.push({
        code: "UNSUPPORTED_EVAL_POLICY",
        message: `Node "${nodeId}" declares eval_policy "${node.eval_policy}", which is reserved but not yet implemented; use "all_pass" (the only supported policy in v1.0)`,
        nodeId,
      });
    }
  }

  // Inline skills need usage instructions; the engine server name is reserved.
  for (const [skillId, def] of Object.entries(workflow.skills ?? {})) {
    if (!def.instruction?.trim()) {
      errors.push({
        code: "INVALID_INLINE_SKILL",
        message: `Inline skill "${skillId}" must provide a non-empty instruction`,
      });
    }
    if (skillId === "sweny-core" && def.mcp) {
      errors.push({
        code: "INVALID_INLINE_SKILL",
        message: `Skill "sweny-core" is reserved for the engine MCP server; use a different skill ID`,
      });
    }
  }

  // Permissions and safe outputs (#365). The workflow's `permissions` and
  // `safe_outputs.allow` are a ceiling every node inherits.
  const wfAccess = typeof workflow.permissions === "string" ? workflow.permissions : workflow.permissions?.access;
  const allowedOutputs = workflow.safe_outputs?.allow;
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    const nodeAccess = typeof node.permissions === "string" ? node.permissions : node.permissions?.access;
    if (wfAccess === "read" && nodeAccess === "write") {
      errors.push({
        code: "PERMISSION_CEILING",
        message: `Node "${nodeId}" asks for permissions write, above the workflow's permissions read`,
        nodeId,
      });
    }
    // Budgets (#449): the workflow's `budget` is the ceiling for every node.
    const wfBudget = workflow.budget;
    const nodeBudget = node.budget;
    if (wfBudget && nodeBudget) {
      if (wfBudget.tokens !== undefined && nodeBudget.tokens !== undefined && nodeBudget.tokens > wfBudget.tokens) {
        errors.push({
          code: "BUDGET_CEILING",
          message: `Node "${nodeId}" declares budget.tokens ${nodeBudget.tokens}, above the workflow's budget.tokens ${wfBudget.tokens}`,
          nodeId,
        });
      }
      if (
        wfBudget.cost_usd !== undefined &&
        nodeBudget.cost_usd !== undefined &&
        nodeBudget.cost_usd > wfBudget.cost_usd
      ) {
        errors.push({
          code: "BUDGET_CEILING",
          message: `Node "${nodeId}" declares budget.cost_usd ${nodeBudget.cost_usd}, above the workflow's budget.cost_usd ${wfBudget.cost_usd}`,
          nodeId,
        });
      }
    }
    const seenTypes = new Set<string>();
    for (const out of node.outputs ?? []) {
      if (seenTypes.has(out.type)) {
        errors.push({
          code: "DUPLICATE_OUTPUT",
          message: `Node "${nodeId}" declares output "${out.type}" more than once; merge them into one entry`,
          nodeId,
        });
      }
      seenTypes.add(out.type);
      if (allowedOutputs && !allowedOutputs.includes(out.type)) {
        errors.push({
          code: "OUTPUT_NOT_ALLOWED",
          message: `Node "${nodeId}" declares output "${out.type}", outside the workflow's safe_outputs.allow [${allowedOutputs.join(", ")}]`,
          nodeId,
        });
      }
      if (out.via && !SAFE_OUTPUT_APPLIERS[out.via]?.includes(out.type)) {
        const supported = Object.entries(SAFE_OUTPUT_APPLIERS)
          .filter(([, types]) => types.includes(out.type))
          .map(([id]) => id);
        errors.push({
          code: "UNSUPPORTED_OUTPUT",
          message: `Node "${nodeId}" output "${out.type}" names via "${out.via}", which cannot apply it (supported: ${supported.join(", ")})`,
          nodeId,
        });
      }
      if (out.number !== undefined && out.type !== "comment" && out.type !== "label" && out.type !== "issue_state") {
        errors.push({
          code: "UNSUPPORTED_OUTPUT",
          message: `Node "${nodeId}" output "${out.type}" pins number, which only applies to comment, label and issue_state outputs`,
          nodeId,
        });
      }
      // Closing is destructive: an injected agent must not pick the issue. Only a
      // reopen-only output may rely on the issue named in the request.
      if (out.type === "issue_state" && out.state !== "reopen" && out.number === undefined) {
        errors.push({
          code: "UNSUPPORTED_OUTPUT",
          message: `Node "${nodeId}" output "issue_state" can close issues, so it must pin number (a literal or { input: name }); only state: reopen may omit the pin`,
          nodeId,
        });
      }
      if (out.state !== undefined && out.type !== "issue_state") {
        errors.push({
          code: "UNSUPPORTED_OUTPUT",
          message: `Node "${nodeId}" output "${out.type}" sets state, which only applies to issue_state outputs`,
          nodeId,
        });
      }
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
      // The `then` branches mirror evaluatorZ.superRefine exactly: each kind
      // requires its own field AND forbids the other kind's fields. Without
      // the `not` clauses ajv only checked presence, so a `value` evaluator
      // carrying a `rubric` passed ajv but threw under Zod (cross-kind drift).
      allOf: [
        {
          if: { properties: { kind: { enum: ["value", "function"] } } },
          then: {
            required: ["rule"],
            // judge-only fields are illegal on value / function evaluators.
            not: {
              anyOf: [{ required: ["rubric"] }, { required: ["pass_when"] }, { required: ["model"] }],
            },
          },
        },
        {
          if: { properties: { kind: { const: "judge" } } },
          then: {
            required: ["rubric"],
            // `rule` is value / function only.
            not: { required: ["rule"] },
          },
        },
      ],
    },
    Permissions: {
      description:
        "What a node's agent may do. 'read' runs it read-only: only access: read skill tools, no external skill MCP servers, no file-write, edit, fetch or subagent built-ins, and no shell (on Codex, a shell confined to its OS read-only sandbox). On the workflow it is the default and the ceiling for every node.",
      oneOf: [
        { type: "string", enum: [...NODE_ACCESS] },
        {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            access: { type: "string", enum: [...NODE_ACCESS] },
            deny: {
              type: "array",
              items: { type: "string", enum: [...TOOL_CLASSES] },
              minItems: 1,
              description: "Built-in tool classes the agent must not have, compiled per harness.",
            },
            strict: {
              type: "boolean",
              description:
                "Exclusive MCP (only the servers sweny injects), and refuse the node on a harness that cannot enforce the policy.",
            },
          },
        },
      ],
    },
    Budget: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      description:
        "A spend ceiling. 'tokens' counts input plus output tokens as the harness reports them; 'cost_usd' is the harness-reported cost (never estimated). A crossing stops the agent and fails the node; the run halts.",
      properties: {
        tokens: { type: "integer", minimum: 1, description: "Max input plus output tokens." },
        cost_usd: { type: "number", exclusiveMinimum: 0, description: "Max reported cost in USD." },
      },
    },
    SafeOutput: {
      type: "object",
      required: ["type"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: [...SAFE_OUTPUT_TYPES] },
        via: {
          type: "string",
          minLength: 1,
          description: "Skill that applies the write. Default: the first node skill that supports the type.",
        },
        max: {
          type: "integer",
          minimum: 1,
          maximum: SAFE_OUTPUT_MAX_CEILING,
          description: "Max writes of this type from this node per run. Default 1.",
        },
        target: {
          type: "string",
          minLength: 1,
          description: "Pinned target (GitHub owner/repo, Linear team id). GitHub default: GITHUB_REPOSITORY.",
        },
        title_prefix: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "Prepended to issue and PR titles that do not already start with it.",
        },
        labels: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          description: "issue / pr: labels always added. label: the only labels the agent may add.",
        },
        expires: {
          type: "string",
          pattern: SAFE_OUTPUT_EXPIRES_PATTERN.source,
          description: "Drop an intent older than this when the write stage runs (e.g. 30m, 2h, 7d).",
        },
        number: {
          description:
            "comment / label / issue_state: the only issue or PR this output may write to (GitHub number, Linear identifier), or { input: <name> } to pin it to a run input.",
          oneOf: [
            { type: "string", minLength: 1 },
            { type: "integer", minimum: 1 },
            {
              type: "object",
              required: ["input"],
              additionalProperties: false,
              properties: { input: { type: "string", minLength: 1 } },
            },
          ],
        },
        state: {
          type: "string",
          enum: [...SAFE_OUTPUT_STATES],
          description: "issue_state: the one change this output may make (reopen or close). Default: either.",
        },
      },
    },
  },
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    spec_version: {
      type: "string",
      pattern: "^[1-9][0-9]*$",
      description:
        "Workflow spec version as a positive integer string. Absent means 1. Older versions are migrated in memory on load; newer than the CLI supports is refused. Run `sweny workflow upgrade <file>` to rewrite a file at the current version.",
    },
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
    workflow_type: {
      type: "string",
      enum: [...WORKFLOW_TYPES],
      description:
        "Workflow type discriminator. Cloud uses this to route runs to a type-specific renderer. Optional; absence defaults to 'generic'.",
    },
    judge_model: {
      type: "string",
      minLength: 1,
      // No JSON `default` here: the Zod parser leaves this undefined and the
      // executor applies the effective judge-model default at use-time. A
      // documented JSON default that Zod never writes back is misleading.
      description: "Default model for judge evaluators across the workflow. Overridable per-node and per-evaluator.",
    },
    model: {
      type: "string",
      minLength: 1,
      description:
        "Default execution model for every node. Overridable per-node. Free-text passthrough (no registry); resolved as node.model ?? workflow.model ?? executor default.",
    },
    permissions: {
      $ref: "#/$defs/Permissions",
      description: "Default and ceiling for every node's permissions. Absent: write.",
    },
    safe_outputs: {
      type: "object",
      description: "Workflow-level safe-output policy: the ceiling on output types and run-wide limits.",
      additionalProperties: false,
      properties: {
        allow: {
          type: "array",
          items: { type: "string", enum: [...SAFE_OUTPUT_TYPES] },
          minItems: 1,
          description: "Output types any node may declare. Absent: all types.",
        },
        max: {
          type: "integer",
          minimum: 1,
          maximum: SAFE_OUTPUT_MAX_CEILING,
          description: "Total writes per run across all nodes.",
        },
        staged: { type: "boolean", description: "Preview every write and apply none." },
        trusted_actors: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          description: "GitHub logins whose runs may write.",
        },
        trusted_associations: {
          type: "array",
          items: { type: "string", enum: [...AUTHOR_ASSOCIATIONS] },
          minItems: 1,
          description: "Author associations (from the GitHub event payload) whose runs may write.",
        },
        screen: {
          type: "boolean",
          description:
            "One model call that may veto the writes after every deterministic check. It can never authorize one.",
        },
      },
    },
    judge_budget: {
      type: "integer",
      minimum: 0,
      // No JSON `default` here: Zod leaves this undefined; the executor
      // applies the soft-cap default at use-time. See judge_model above.
      description:
        "Soft cap on expected judge calls per workflow run. Executor warns at load time if exceeded; not a hard runtime cap in v1.",
    },
    budget: {
      $ref: "#/$defs/Budget",
      description:
        "Spend ceiling for the whole run and for every node. A node's own budget may only narrow it. The CLI's --max-tokens and --max-cost tighten it further.",
    },
    context_mode: {
      type: "string",
      enum: [...CONTEXT_MODES],
      description:
        "What prior results a node's prompt receives. bounded (default): only nodes it can depend on, and a schema'd node's declared fields instead of its free-text summary. full: every prior node's complete data.",
    },
    inputs: {
      type: "object",
      description:
        "Declared per-run input contract. Each entry names a parameter the caller may supply via --input. The CLI validates against this declaration, applies defaults for omitted optional fields, and rejects unknown types before the executor runs. Optional; workflows without an inputs block accept any JSON object (back-compat).",
      additionalProperties: {
        type: "object",
        required: ["type"],
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [...WORKFLOW_INPUT_TYPES],
            description: "JSON-native type. Use a flat object if you need richer shapes.",
          },
          description: {
            type: "string",
            description: "Human-readable purpose. Shown in CLI help and cloud renderers.",
          },
          required: {
            type: "boolean",
            default: false,
            description: "When true, the caller must provide a value.",
          },
          default: {
            description: "Value applied when the caller omits the field. Type-checked at parse time against 'type'.",
          },
          enum: {
            type: "array",
            minItems: 1,
            description: "Optional set of allowed values. Validated after the type check.",
          },
        },
        // The combination `required: true` together with a `default` is incoherent:
        // a default would either silently satisfy the required check (making it
        // vestigial) or never fire (making the default dead code). Reject the
        // combination at JSON-Schema validation time so external validators agree
        // with the Zod parser. See workflowInputFieldZ.superRefine in inputs.ts.
        not: {
          type: "object",
          required: ["required", "default"],
          properties: {
            required: { const: true },
          },
        },
        // Per-type checks on `default` and each `enum` element, mirroring
        // workflowInputFieldZ.superRefine -> checkValueType in inputs.ts.
        // Without these, a `type: number` field with `default: "x"` passed
        // ajv but threw under Zod (default/enum type drift). One if/then per
        // primitive in WORKFLOW_INPUT_TYPES.
        allOf: [
          {
            if: { properties: { type: { const: "string" } } },
            then: {
              properties: {
                default: { type: "string" },
                enum: { items: { type: "string" } },
              },
            },
          },
          {
            if: { properties: { type: { const: "number" } } },
            then: {
              properties: {
                default: { type: "number" },
                enum: { items: { type: "number" } },
              },
            },
          },
          {
            if: { properties: { type: { const: "boolean" } } },
            then: {
              properties: {
                default: { type: "boolean" },
                enum: { items: { type: "boolean" } },
              },
            },
          },
          {
            if: { properties: { type: { const: "string[]" } } },
            then: {
              properties: {
                default: { type: "array", items: { type: "string" } },
                enum: { items: { type: "array", items: { type: "string" } } },
              },
            },
          },
        ],
      },
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
          budget: {
            $ref: "#/$defs/Budget",
            description:
              "Spend ceiling for one visit to this node, retry attempts included. Never above the workflow's budget. Crossing it stops the agent and fails the node (fail_soft and on_fail: continue do not apply) and the run halts.",
          },
          disallowed_tools: {
            type: "array",
            items: { type: "string", minLength: 1 },
            description:
              "Built-in tool names the agent cannot use at this node, in the harness's own names (Claude Code: ['Bash']). Passed through to the harness: Claude Code removes them from the model context; Codex maps known names to tool classes and reports what it cannot deny as degraded. For portable workflows prefer tool classes in tools.deny.",
          },
          tools: {
            type: "object",
            description:
              "Per-node filter over skill-provided tools. 'allow' keeps only the listed skill tools; 'deny' removes the listed skill tools (applied after 'allow'). Filtered tools are never registered for the node's run. Absent field = all skill tools exposed. A 'deny' entry that names a portable tool class (shell, write, edit, net, subagent) also denies that class of built-in agent tools on every harness.",
            additionalProperties: false,
            anyOf: [{ required: ["allow"] }, { required: ["deny"] }],
            properties: {
              allow: {
                type: "array",
                items: { type: "string", minLength: 1 },
                minItems: 1,
              },
              deny: {
                type: "array",
                items: { type: "string", minLength: 1 },
                minItems: 1,
                description:
                  "Skill tool names to remove, and/or portable tool classes (shell, write, edit, net, subagent) to deny for built-in agent tools. Each harness enforces a class natively or reports it as degraded; under strict harness policy an unenforceable class refuses the node.",
              },
            },
          },
          fail_soft: {
            type: "boolean",
            description:
              "When true, an agent-level failure at this node (max turns, early termination, SDK error) is downgraded to success with fail_soft: true and the error preserved in data; routing proceeds with partial output. Eval failures are not softened. Default false.",
          },
          on_fail: {
            type: "string",
            enum: [...NODE_ON_FAIL],
            description:
              "What to do when this node finishes 'failed' (agent-level failure, or an eval failure that exhausted retries and was not softened by fail_soft). 'halt' (default) stops the workflow with the failure surfaced so a broken node never advances down a conditional edge; 'continue' preserves the legacy fall-through where routing proceeds from the failed node. Distinct from requires.on_fail (the pre-condition gate).",
          },
          permissions: {
            $ref: "#/$defs/Permissions",
            description:
              "What this node's agent may do. Absent: read when the node declares outputs, else the workflow's permissions, else write.",
          },
          outputs: {
            type: "array",
            items: { $ref: "#/$defs/SafeOutput" },
            minItems: 1,
            description:
              "Typed write intents this node may emit with the emit_output tool. sweny applies them after the node, within the declared caps.",
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
            // No JSON `default` here: evalPolicyZ is `.optional()` with no
            // `.default()`, so Zod leaves this undefined and the executor
            // applies `?? "all_pass"` at use-time (executor.ts aggregateEval).
            // Matches the judge_model / judge_budget treatment (issue #214 #6).
            description: "How evaluator results aggregate. v1 implements all_pass; the others are reserved.",
          },
          judge_model: {
            type: "string",
            minLength: 1,
            description: "Default model for judge evaluators on this node. Overrides workflow-level judge_model.",
          },
          model: {
            type: "string",
            minLength: 1,
            description:
              "Execution model for this node's AI invocation. Overrides the workflow-level model. Free-text passthrough (no registry).",
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
              max: { type: "integer", minimum: 1, maximum: 10 },
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
          when: {
            type: "string",
            description: "Natural language condition, evaluated at runtime by the workflow's harness.",
          },
          max_iterations: {
            type: "integer",
            minimum: 1,
            maximum: EDGE_MAX_ITERATIONS_CEILING,
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
        // Inline skills need usable instructions, including when they declare MCP.
        required: ["instruction"],
        // Round 2: reject unknown keys to match Zod skillDefinitionZ.strict().
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          instruction: {
            type: "string",
            pattern: "\\S",
            description: "Natural language expertise injected into the node prompt",
          },
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
  // Mirror skillZ.refine: a skill must provide at least one of NON-EMPTY
  // tools, instruction, or mcp. `required: ["tools"]` alone is satisfied by
  // `tools: []` (presence, not non-emptiness), so the tools branch pins
  // minItems: 1 to match Zod (which checks `s.tools.length > 0`).
  anyOf: [
    { required: ["tools"], properties: { tools: { minItems: 1 } } },
    { required: ["instruction"] },
    { required: ["mcp"] },
  ],
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
    // Mirror skillZ.mcpAliases: a record mapping a logical MCP server name
    // to a non-empty list of non-empty tool-name aliases. Omitting this from
    // the published schema (which is additionalProperties: false) caused ajv
    // to REJECT valid skills that Zod accepts.
    mcpAliases: {
      type: "object",
      description:
        "Maps a logical MCP server name to the tool-name aliases nodes use to reference it. Each entry is a non-empty list of non-empty strings.",
      additionalProperties: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
      },
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
        access: {
          type: "string",
          enum: [...TOOL_ACCESS],
          description:
            "Side-effect class: read (only reads) or write (creates, updates, deletes, posts, sends). Absent means write. Dry runs pass only read tools to nodes.",
        },
      },
    },
    McpServerConfig: {
      type: "object",
      description: "External MCP server definition.",
      // An MCP server must declare command (stdio) or url (http), mirroring
      // mcpServerConfigZ.refine(c => c.command || c.url) and the workflow
      // inline-skill mcp block. Without this the published skill.json accepted a
      // transport-less mcp block the runtime parser rejects (Zod<->ajv drift).
      anyOf: [{ required: ["command"] }, { required: ["url"] }],
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
