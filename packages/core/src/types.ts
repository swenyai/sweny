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

/** Skill categories — used for validation and grouping */
export type SkillCategory = "git" | "observability" | "tasks" | "notification" | "general";

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

/**
 * Machine-checked post-condition for a node.
 *
 * Evaluated by the executor AFTER the LLM finishes. If any declared check
 * fails, the node is marked `failed` even if the LLM itself returned success.
 *
 * All declared checks are AND-ed. The executor runs every check (no fast-fail)
 * and concatenates failures into a single error string on `result.data.error`.
 *
 * Keep the shape small and declarative. Anything richer should be a skill or
 * a dedicated workflow node, not a verify clause.
 */
export interface NodeVerify {
  /** At least one of these tools was called and succeeded during this node. */
  any_tool_called?: string[];
  /** Every named tool was called and succeeded at least once during this node. */
  all_tools_called?: string[];
  /** None of these tools may have been invoked during this node. */
  no_tool_called?: string[];
  /** Listed paths must be present and non-null in `result.data` (see Path resolution in the spec). */
  output_required?: string[];
  /** Each assertion must hold against `result.data`. */
  output_matches?: OutputMatch[];
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
 * Reuses the same path grammar as `verify` (dotted segments, `[*]` wildcard,
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
 * Node-local retry on verify failure.
 *
 * Re-runs the LLM up to `max` additional times, prepending feedback derived
 * from the verify failure. Triggered ONLY by verify failure — not by tool/API
 * errors and not by `requires` failure.
 *
 * `instruction` shapes the feedback preamble:
 *   - omitted        → default "## Previous attempt failed verification..."
 *   - string         → static text + verify error
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
  /** Machine-checked post-conditions. Enforced by the executor after the LLM finishes. */
  verify?: NodeVerify;
  /** Machine-checked pre-conditions. Enforced by the executor before the LLM runs. */
  requires?: NodeRequires;
  /** Node-local retry on verify failure (with optional autonomous reflection). */
  retry?: NodeRetry;
}

/** An edge connecting two nodes */
export interface Edge {
  from: string;
  to: string;
  /** Natural language condition — Claude evaluates at runtime */
  when?: string;
  /** Max times this edge can be followed (enables retry loops). Default: unlimited. */
  max_iterations?: number;
}

/** A complete workflow definition — pure data, fully serializable */
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
}

export interface ToolCall {
  tool: string;
  input: unknown;
  output?: unknown;
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
   * Used by the executor to generate retry strategies in autonomous reflection mode.
   */
  ask(opts: { instruction: string; context: Record<string, unknown> }): Promise<string>;
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
