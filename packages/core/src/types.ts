// ─── Source re-exports ──────────────────────────────────────────
export type { Source, ResolvedSource, SourceKind, SourceResolutionMap } from "./sources.js";

// ─── Skill System ────────────────────────────────────────────────
//
// A Skill is a logical group of tools that share configuration.
// Skills replace "providers" — instead of typed interfaces that
// step code calls, skills expose tools that Claude calls directly.

import type { Source as _Source, ResolvedSource as _ResolvedSource } from "./sources.js";

export type JSONSchema = Record<string, unknown>;

/** Context passed to tool handlers at execution time */
export interface ToolContext {
  /** Resolved config values (env vars + explicit overrides) */
  config: Record<string, string>;
  /** Structured logger */
  logger: Logger;
}

/** A single tool Claude can invoke */
export interface Tool {
  name: string;
  description: string;
  input_schema: JSONSchema;
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}

/** Config field declaration — skills say what they need */
export interface ConfigField {
  description: string;
  required?: boolean;
  /** Default environment variable to read from */
  env?: string;
}

/**
 * Skill categories: used for per-node validation and grouping.
 *
 * Single source of truth for runtime + compile-time. The `as const` tuple
 * lets the CLI iterate it for help text and the loader use it for runtime
 * validation; `SkillCategory` is derived so adding a category requires
 * only this line.
 */
export const SKILL_CATEGORIES = ["general", "git", "tasks", "notification", "observability", "data"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** A skill groups related tools with shared config requirements */
export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  config: Record<string, ConfigField>;
  tools: Tool[];
  /** Natural language expertise injected into the node prompt when this skill is referenced. */
  instruction?: string;
  /** External MCP server definition wired for nodes referencing this skill. */
  mcp?: McpServerConfig;
  /**
   * Tool-name aliases recognized by `function` evaluators.
   *
   * When a workflow references `any_tool_called: [linear_create_issue]` and
   * the agent instead calls the equivalent MCP tool exposed by this skill's
   * MCP server (e.g. `save_issue` on Linear's remote MCP), the two names
   * should count as equivalent. Each skill owns the mapping for its own
   * domain. Core stays vendor-neutral.
   *
   * Key: a canonical tool name (usually one of this skill's `tools[].name`,
   * but any name the skill wants to equate is valid).
   * Value: list of equivalent names, typically tool names exposed by this
   * skill's external MCP server.
   *
   * Aliases are symmetric: a function rule naming either side matches a call
   * on either side. Omit names that are ambiguous across providers
   * (e.g. `get_issue` is exposed by both Linear and GitHub MCP servers).
   */
  mcpAliases?: Record<string, string[]>;
}

// ─── Workflow Graph ─────────────────────────────────────────────
//
// A Workflow is a directed graph of nodes connected by edges.
// Each node has an instruction (what Claude should do) and a set of
// available skills. Edges define flow; conditional edges have a
// natural-language `when` clause that Claude evaluates at runtime.
// Edges with `max_iterations` enable controlled retry loops.

/**
 * Per-node rules or context.
 *
 * - Array form (additive): inherits workflow/runtime sources AND adds these.
 * - Object form: when `only: true`, blocks the cascade for this field and
 *   uses only `sources`. When `only` is absent/false, behaves like the
 *   array form.
 */
export type NodeSources = _Source[] | { only?: boolean; sources: _Source[] };

/** Kind of evaluator. See {@link Evaluator}. */
export type EvaluatorKind = "value" | "function" | "judge";

/** Aggregation policy for a node's evaluator results. v1 implements `all_pass`. */
export type EvalPolicy = "all_pass" | "any_pass" | "weighted";

/**
 * The deterministic rule body for a `value` or `function` evaluator.
 *
 * `value` rules use `output_required` and `output_matches` (data-shape).
 * `function` rules use `any_tool_called` / `all_tools_called` / `no_tool_called`
 * (trace-shape). Mixing the two on a single rule is allowed for compactness
 * but discouraged: a single evaluator should test a single thing.
 */
export interface EvaluatorRule {
  /** At least one of these tools was called and succeeded. (`function` rules.) */
  any_tool_called?: string[];
  /** Every named tool was called and succeeded at least once. (`function` rules.) */
  all_tools_called?: string[];
  /** None of these tools may have been invoked. (`function` rules.) */
  no_tool_called?: string[];
  /** Listed paths must be present and non-null in `result.data`. (`value` rules.) */
  output_required?: string[];
  /** Each assertion must hold against `result.data`. (`value` rules.) */
  output_matches?: OutputMatch[];
}

/**
 * A single evaluator on a node.
 *
 * - `value` and `function` use `rule`.
 * - `judge` uses `rubric` (and optional `pass_when`, `model`).
 *
 * Each evaluator produces an {@link EvalResult}. The executor aggregates
 * the results per the node's `eval_policy` (default `all_pass`).
 */
export interface Evaluator {
  /** Stable identifier. Used in EvalResult and retry preambles. */
  name: string;
  /** Discriminator. Determines which fields apply. */
  kind: EvaluatorKind;
  /** Required for `value` / `function`. */
  rule?: EvaluatorRule;
  /** Required for `judge`. Natural-language criterion. */
  rubric?: string;
  /** `judge` only. Verdict token that indicates pass. Default: `"yes"`. */
  pass_when?: string;
  /** `judge` only. Override the judge model for this evaluator. */
  model?: string;
}

/**
 * Per-evaluator result.
 *
 * The executor produces one EvalResult per declared evaluator. The list
 * lands on {@link NodeResult.evals}.
 */
export interface EvalResult {
  /** Echoes the evaluator's name. */
  name: string;
  /** Echoes the evaluator's kind. */
  kind: EvaluatorKind;
  /** Whether this evaluator passed. */
  pass: boolean;
  /**
   * Failure detail for value/function (formatted by the executor) or judge
   * (returned by the model). Capped at ~500 characters when emitted.
   */
  reasoning?: string;
  /** Reserved for `weighted` policies. Not populated in v1. */
  score?: number;
}

/**
 * Machine-checked pre-condition for a node.
 *
 * Evaluated by the executor BEFORE the LLM runs. If any declared check fails,
 * the node is marked `failed` (or `skipped` when `on_fail: "skip"`) and the
 * LLM is never invoked.
 *
 * Path roots resolve against the cross-node context map:
 *   { input: <runtime input>, [priorNodeId]: <data of prior node>, ... }
 *
 * Reuses the same path grammar as `eval` (dotted segments, `[*]` wildcard,
 * optional `all:`/`any:` prefix).
 */
export interface NodeRequires {
  /** Listed paths must be present and non-null in the context map. */
  output_required?: string[];
  /** Each assertion must hold against the context map. */
  output_matches?: OutputMatch[];
  /** Action when checks fail. Default: "fail". */
  on_fail?: "fail" | "skip";
}

/**
 * Node-local retry on eval failure.
 *
 * Re-runs the LLM up to `max` additional times, prepending feedback derived
 * from the failing evaluators. Triggered ONLY by eval failure, not by tool
 * / API errors and not by `requires` failure.
 *
 * `instruction` shapes the feedback preamble:
 *   - omitted        → default "## Previous attempt failed evaluation..."
 *   - string         → static text + structured eval failure list
 *   - { auto: true } → LLM-generated diagnosis from default reflection prompt
 *   - { reflect: s } → LLM-generated diagnosis from author-provided prompt
 */
export interface NodeRetry {
  /** Maximum number of retry attempts after the initial run. Must be ≥ 1. */
  max: number;
  /** Preamble shape — see interface docs. */
  instruction?: string | { auto: true } | { reflect: string };
}

/**
 * A single output assertion. Exactly one of `equals | in | matches` must be set.
 *
 * `path` is a dotted path that may include `[*]` wildcard segments and may be
 * prefixed with `all:` or `any:` to set wildcard semantics (default `all:`).
 *
 * Examples: `prUrl`, `findings[*].severity`, `any:checks[*].conclusion`.
 */
export interface OutputMatch {
  path: string;
  equals?: unknown;
  in?: unknown[];
  /** Regex source (no surrounding slashes, no flags). Value is coerced to string. */
  matches?: string;
}

/** A node in the workflow DAG */
export interface Node {
  /** Human-readable name */
  name: string;
  /** What Claude should accomplish at this step */
  instruction: _Source;
  /** Skill IDs available at this node */
  skills: string[];
  /** Optional structured output schema */
  output?: JSONSchema;
  /** Max AI model turns for this node. When absent, the executor's default applies. */
  max_turns?: number;
  /** Per-node directives. Additive by default; set `{ only: true, sources: [...] }` to block cascade. */
  rules?: NodeSources;
  /** Per-node background knowledge. Additive by default; set `{ only: true, sources: [...] }` to block cascade. */
  context?: NodeSources;
  /** Named evaluators run after the LLM finishes. Each produces an {@link EvalResult}. */
  eval?: Evaluator[];
  /** How evaluator results aggregate. Default `all_pass`. v1 implements only `all_pass`. */
  eval_policy?: EvalPolicy;
  /** Default model for judge evaluators on this node. Overrides workflow-level `judge_model`. */
  judge_model?: string;
  /** Machine-checked pre-conditions. Enforced by the executor before the LLM runs. */
  requires?: NodeRequires;
  /** Node-local retry on eval failure (with optional autonomous reflection). */
  retry?: NodeRetry;
}

/** An edge connecting two nodes */
export interface Edge {
  from: string;
  to: string;
  /** Natural language condition. Claude evaluates at runtime. */
  when?: string;
  /** Max times this edge can be followed (enables retry loops). Default: unlimited. */
  max_iterations?: number;
}

/** A complete workflow definition. Pure data, fully serializable. */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, Node>;
  edges: Edge[];
  entry: string;
  skills?: Record<string, SkillDefinition>;
  /** Directives prepended to every node's instruction. Cascade into per-node rules. */
  rules?: _Source[];
  /** Background knowledge prepended to every node's instruction. Cascade into per-node context. */
  context?: _Source[];
  /** Default model for judge evaluators across the workflow. Overridable per-node and per-evaluator. */
  judge_model?: string;
  /** Soft cap on expected judge calls per workflow run. Warning at load time when exceeded. */
  judge_budget?: number;
}

/**
 * Inline skill definition in a workflow's `skills` block.
 * Must provide at least `instruction` or `mcp`.
 */
export interface SkillDefinition {
  name?: string;
  description?: string;
  /** Natural language expertise injected into the node prompt. */
  instruction?: string;
  /** External MCP server. */
  mcp?: McpServerConfig;
}

// ─── Execution ───────────────────────────────────────────────────

export interface NodeResult {
  status: "success" | "skipped" | "failed";
  /** Arbitrary data produced by this node */
  data: Record<string, unknown>;
  /** Tool calls made during this node's execution */
  toolCalls: ToolCall[];
  /**
   * Per-evaluator results from `node.eval` (one entry per declared evaluator,
   * in declaration order). Absent when the node has no `eval` block or when
   * eval was not run (e.g. node failed during execution).
   */
  evals?: EvalResult[];
}

export interface ToolCall {
  tool: string;
  input: unknown;
  output?: unknown;
  /**
   * Authoritative outcome of the tool invocation.
   *
   * When present, this is the source of truth for `function` evaluators. The
   * output-shape heuristic is a legacy fallback only. Set by the Claude
   * runtime on tool completion: "success" when the tool returned normally,
   * "error" when it threw or the MCP server returned is_error=true.
   *
   * Absent status indicates a legacy or hand-constructed ToolCall. Function
   * evaluators fall back to inspecting `output` for an `error` key.
   */
  status?: "success" | "error";
}

export type ExecutionEvent =
  | { type: "workflow:start"; workflow: string }
  | { type: "sources:resolved"; sources: Record<string, _ResolvedSource> }
  | { type: "node:enter"; node: string; instruction: string }
  | { type: "tool:call"; node: string; tool: string; input: unknown }
  | { type: "tool:result"; node: string; tool: string; output: unknown }
  | { type: "node:exit"; node: string; result: NodeResult }
  | { type: "node:progress"; node: string; message: string }
  | { type: "node:retry"; node: string; attempt: number; reason: string; preamble: string }
  | { type: "route"; from: string; to: string; reason: string }
  | { type: "workflow:end"; results: Record<string, NodeResult> };

export type Observer = (event: ExecutionEvent) => void;

// ─── Execution Trace ────────────────────────────────────────────
//
// Records the full execution path through a workflow, including
// loop iterations and routing decisions. Unlike the results map
// (which stores only the last result per node), the trace preserves
// the complete ordered sequence.

/** A single node execution within the trace */
export interface TraceStep {
  /** Node ID */
  node: string;
  /** Outcome of this execution */
  status: "success" | "failed" | "skipped";
  /** 1-based iteration count (2 = second time this node ran) */
  iteration: number;
  /** 0-indexed retry attempt for this iteration. Absent when no retry fired. */
  retryAttempt?: number;
}

/** A routing decision between nodes */
export interface TraceEdge {
  from: string;
  to: string;
  /** Why this edge was chosen (condition text or "only path") */
  reason: string;
}

/** Full execution trace — ordered steps + edges taken */
export interface ExecutionTrace {
  /** Ordered list of node executions (includes repeats from retry loops) */
  steps: TraceStep[];
  /** Ordered list of routing decisions */
  edges: TraceEdge[];
  /** Resolved sources keyed by field path (e.g. "nodes.gather.instruction") */
  sources: Record<string, _ResolvedSource>;
}

/** Result of execute() — final node results + full execution trace */
export interface ExecutionResult {
  /** Final result per node (last execution if retried) */
  results: Map<string, NodeResult>;
  /** Full execution trace including loops and routing decisions */
  trace: ExecutionTrace;
}

// ─── Claude Interface ────────────────────────────────────────────
//
// Abstract interface so the executor doesn't depend on the SDK.
// Swap in a mock for testing, or a different model provider entirely.

export interface Claude {
  /** Run a node: give Claude an instruction, context, and tools */
  run(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
    /** Called with status messages while Claude is working (tool name, etc.) */
    onProgress?: (message: string) => void;
    /** Per-node turn limit. Overrides the client default when set. */
    maxTurns?: number;
  }): Promise<NodeResult>;

  /** Evaluate a routing condition — pick one of N choices */
  evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
  }): Promise<string>;

  /**
   * Single-completion free-text query. No tools, no output schema.
   * Used by the executor to generate retry strategies in autonomous reflection mode
   * and by judge evaluators to score node results against a rubric.
   *
   * `model` overrides the client's default for this call. Implementations
   * SHOULD use it; mocks MAY ignore it.
   */
  ask(opts: { instruction: string; context: Record<string, unknown>; model?: string }): Promise<string>;
}

// ─── MCP Auto-injection ──────────────────────────────────────────

export interface McpServerConfig {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface McpAutoConfig {
  sourceControlProvider?: string;
  issueTrackerProvider?: string;
  /** One or more observability providers (e.g. ["loki", "sentry"]). */
  observabilityProviders?: string[];
  credentials: Record<string, string>;
  workspaceTools?: string[];
  userMcpServers?: Record<string, McpServerConfig>;
}

// ─── Utilities ───────────────────────────────────────────────────

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (msg, data) => console.log(`[info] ${msg}`, data ?? ""),
  warn: (msg, data) => console.warn(`[warn] ${msg}`, data ?? ""),
  error: (msg, data) => console.error(`[error] ${msg}`, data ?? ""),
  debug: (msg, data) => console.debug(`[debug] ${msg}`, data ?? ""),
};
