// ─── Source re-exports ──────────────────────────────────────────
export type { Source, ResolvedSource, SourceKind, SourceResolutionMap } from "./sources.js";

// ─── Workflow input re-exports ──────────────────────────────────
export type {
  WorkflowInputs,
  WorkflowInputField,
  WorkflowInputType,
  InputValidationError,
  InputValidationResult,
} from "./inputs.js";
export { WORKFLOW_INPUT_TYPES } from "./inputs.js";

// ─── Skill System ────────────────────────────────────────────────
//
// A Skill is a logical group of tools that share configuration.
// Skills replace "providers" — instead of typed interfaces that
// step code calls, skills expose tools that Claude calls directly.

import type { Source as _Source, ResolvedSource as _ResolvedSource } from "./sources.js";
import type { ToolClass } from "./harness/types.js";
import type { Budget, BudgetOverrun } from "./budget.js";

export type JSONSchema = Record<string, unknown>;

/** Context passed to tool handlers at execution time */
export interface ToolContext {
  /** Resolved config values (env vars + explicit overrides) */
  config: Record<string, string>;
  /** Structured logger */
  logger: Logger;
}

/**
 * Side-effect class of a tool. `"read"` only reads. `"write"` can change
 * something outside the run: create, update, delete, post, send, invoke.
 */
export const TOOL_ACCESS = ["read", "write"] as const;
export type ToolAccess = (typeof TOOL_ACCESS)[number];

/** A single tool Claude can invoke */
export interface Tool {
  name: string;
  description: string;
  input_schema: JSONSchema;
  /**
   * Side-effect class. Under dry-run (`input.dryRun === true`) the executor
   * passes only `"read"` tools to a node. Absent means `"write"`, so a new or
   * unclassified tool fails safe: it is withheld from dry runs.
   */
  access?: ToolAccess;
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

/**
 * Skill harness directories, listed in ascending priority order.
 *
 * Both the loader (which scans these directories last-wins for ID
 * collisions) and the CLI (which writes scaffolds into one of them)
 * must agree on this list. A divergence means scaffolded skills land
 * somewhere the loader doesn't read, or the loader reads from a
 * directory the CLI can't target.
 *
 * Order matters: the loader treats later entries as higher priority,
 * so `.sweny/skills/` overrides `.claude/skills/` on a name collision.
 */
export const SKILL_HARNESSES = [
  { key: "gemini", path: ".gemini/skills" },
  { key: "agents", path: ".agents/skills" },
  { key: "claude", path: ".claude/skills" },
  { key: "sweny", path: ".sweny/skills" },
] as const;
export type SkillHarnessKey = (typeof SKILL_HARNESSES)[number]["key"];

/**
 * Skill ID validation rules, declared once for runtime + spec.
 *
 * The pattern excludes consecutive hyphens via a negative lookahead so a
 * single regex is the whole rule. JSON Schema regex follows ECMA 262, which
 * supports lookaheads, so the spec can embed this string directly.
 *
 * Length cap is enforced separately because JSON Schema's `maxLength` is
 * the canonical place to express it (vs. cramming `{1,64}` into the regex).
 */
export const SKILL_ID_PATTERN = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const SKILL_ID_MAX_LENGTH = 64;

/** True when `id` is a structurally valid skill ID under the rules above. */
export function isValidSkillId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= SKILL_ID_MAX_LENGTH && SKILL_ID_PATTERN.test(id);
}

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
export const EVALUATOR_KINDS = ["value", "function", "judge"] as const;
export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number];

/** Aggregation policy for a node's evaluator results. v1 implements `all_pass`. */
export const EVAL_POLICIES = ["all_pass", "any_pass", "weighted"] as const;
export type EvalPolicy = (typeof EVAL_POLICIES)[number];

/** What prior results a node's prompt receives (#337). See {@link Workflow.context_mode}. */
export const CONTEXT_MODES = ["bounded", "full"] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

/** Action when a `requires` precondition fails. */
export const REQUIRES_ON_FAIL = ["fail", "skip"] as const;
export type RequiresOnFail = (typeof REQUIRES_ON_FAIL)[number];

/**
 * Post-execution failure policy for a node (the top-level `on_fail` field).
 *
 * Distinct from {@link REQUIRES_ON_FAIL}, which governs the pre-condition
 * `requires` gate (`fail | skip`). This one governs what happens AFTER the
 * node ran and its retry budget is exhausted with `status: "failed"`:
 *  - `halt`     (default) — stop the workflow, leaving the failed node in the
 *                results so the run surfaces as failed. Fails closed: a broken
 *                node never advances down a conditional edge.
 *  - `continue` — legacy fall-through: routing proceeds from the failed node.
 */
export const NODE_ON_FAIL = ["halt", "continue"] as const;
export type NodeOnFail = (typeof NODE_ON_FAIL)[number];

/** MCP server transport type. Inferred from command/url when omitted. */
export const MCP_TRANSPORTS = ["stdio", "http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

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
  /**
   * Spend ceiling for one visit to this node (all retry attempts included),
   * in input + output tokens and/or reported USD. Never above the workflow's
   * `budget`. A crossing stops the agent and fails the node (see `budget.ts`).
   */
  budget?: Budget;
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
  /**
   * Execution model for this node's AI invocation. Resolves as
   * `node.model ?? workflow.model ?? client default`. Free-text passthrough
   * (no registry), consistent with `judge_model`.
   */
  model?: string;
  /** Machine-checked pre-conditions. Enforced by the executor before the LLM runs. */
  requires?: NodeRequires;
  /** Node-local retry on eval failure (with optional autonomous reflection). */
  retry?: NodeRetry;
  /**
   * Built-in tool names the agent must NOT have access to during this node.
   * Forwarded to the Claude Agent SDK's `disallowedTools` option, which
   * removes the named tools from the model's context entirely (not just
   * blocked-via-permission). Use this to scope a node — e.g. an implement
   * node that should commit but must not shell out `gh pr create` or
   * `git push`. Names follow the SDK's tool naming (e.g. `Bash`, `Write`).
   */
  disallowed_tools?: string[];
  /**
   * Per-node filter over skill-provided tools. Complements
   * `disallowed_tools` (which covers built-in agent tools only): this field
   * restricts which of the node's skill tools are registered for the run.
   * Filtered tools are never exposed to the model at all. Structural
   * enforcement, not prompt-begging.
   *
   * - `allow`: when present, ONLY these skill tool names are exposed.
   * - `deny`: these skill tool names are removed (applied after `allow`).
   *
   * Absent field = all skill tools exposed (previous behavior, back-compat).
   * Driving incident: the triage `gather` node, scoped to read-only context
   * gathering, created Linear issues and GitHub PRs mid-gather because every
   * write tool from its skills was in context (letsoffload/permit-service
   * scheduled run on 2026-06-08, PRs #101/#102).
   */
  tools?: NodeToolFilter;
  /**
   * When true, an agent-level failure at this node (max turns reached,
   * early termination, SDK error) does not fail the workflow: the node's
   * result is downgraded to `success` with `fail_soft: true` set and the
   * original `error` preserved in `data`, and routing proceeds so
   * downstream nodes can work with whatever partial output exists.
   * Eval failures are NOT softened; evals are correctness gates.
   * Default false (previous behavior, back-compat).
   */
  fail_soft?: boolean;
  /**
   * What to do when this node finishes with `status: "failed"` (agent-level
   * failure or an eval failure that exhausted the retry budget and was not
   * softened by `fail_soft`).
   *
   *  - `"halt"` (default) — stop the workflow. The failed node stays in the
   *    results so the run surfaces as failed; routing does NOT proceed. This
   *    fails closed: a broken node can never take a conditional out-edge (e.g.
   *    file an issue/PR) on the back of a failure.
   *  - `"continue"` — legacy fall-through: routing proceeds from the failed
   *    node, letting a downstream branch inspect or recover from the failure.
   *
   * Distinct from `requires.on_fail`, which is the pre-condition gate.
   */
  on_fail?: NodeOnFail;
  /**
   * What this node's agent may do (#365). `read` runs the node read-only:
   * only `access: "read"` skill tools, no external skill MCP servers, no
   * shell / file-write / edit / fetch / subagent built-ins. Absent: `read`
   * when the node declares `outputs`, else the workflow's `permissions`,
   * else `write` (today's behavior).
   */
  permissions?: NodePermissions;
  /**
   * Typed write intents this node may emit (#365). The agent records them with
   * the `emit_output` tool; sweny applies them after the node, within the
   * declared caps. See {@link SafeOutputDeclaration}.
   */
  outputs?: SafeOutputDeclaration[];
}

// ─── Permissions and safe outputs (#365) ─────────────────────────

/** Node access level. `read` = no write-capable tool reaches the agent. */
export const NODE_ACCESS = ["read", "write"] as const;
export type NodeAccess = (typeof NODE_ACCESS)[number];

/** Portable built-in tool classes, compiled per harness (Claude Code: native tool names). */
export const TOOL_CLASSES = ["shell", "write", "edit", "net", "subagent"] as const;

/** Object form of {@link NodePermissions}. */
export interface NodePermissionsSpec {
  access?: NodeAccess;
  /** Built-in tool classes the agent must not have. */
  deny?: (typeof TOOL_CLASSES)[number][];
  /** Exclusive MCP, and refuse the node on a harness that cannot enforce the policy. */
  strict?: boolean;
}

/** `read` / `write` shorthand, or the object form. */
export type NodePermissions = NodeAccess | NodePermissionsSpec;

/** Write operations a node may request through `emit_output`. */
export const SAFE_OUTPUT_TYPES = ["comment", "issue", "pr", "label", "issue_state"] as const;
export type SafeOutputType = (typeof SAFE_OUTPUT_TYPES)[number];

/** What an `issue_state` output may do to an issue: reopen a closed one, or close an open one. */
export const SAFE_OUTPUT_STATES = ["reopen", "close"] as const;
export type SafeOutputState = (typeof SAFE_OUTPUT_STATES)[number];

/**
 * Skills that can apply each output type. The write stage calls the skill's
 * own tool handler; a skill not listed here cannot apply safe outputs.
 */
export const SAFE_OUTPUT_APPLIERS: Readonly<Record<string, readonly SafeOutputType[]>> = {
  github: ["comment", "issue", "pr", "label", "issue_state"],
  linear: ["comment", "issue", "issue_state"],
};

/** GitHub author associations accepted by `safe_outputs.trusted_associations`. */
export const AUTHOR_ASSOCIATIONS = [
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIME_CONTRIBUTOR",
  "FIRST_TIMER",
  "NONE",
] as const;
export type AuthorAssociation = (typeof AUTHOR_ASSOCIATIONS)[number];

/** Upper bound on a single output's `max` and on `safe_outputs.max`. */
export const SAFE_OUTPUT_MAX_CEILING = 100;

/** `expires` grammar: a positive integer and a unit (s, m, h, d). */
export const SAFE_OUTPUT_EXPIRES_PATTERN = /^[1-9][0-9]*(s|m|h|d)$/;

/** One declared output on a node. */
export interface SafeOutputDeclaration {
  type: SafeOutputType;
  /** Skill that applies it. Default: the first node skill that supports the type. */
  via?: string;
  /** Max writes of this type from this node per run. Default 1. */
  max?: number;
  /** Pinned target (GitHub `owner/repo`, Linear team id). GitHub default: `GITHUB_REPOSITORY`. */
  target?: string;
  /** Prepended to issue / PR titles that do not already start with it. */
  title_prefix?: string;
  /** issue / pr: labels always added. label: the only labels the agent may add. */
  labels?: string[];
  /** Drop an intent older than this when the write stage runs (e.g. `30m`, `2h`, `7d`). */
  expires?: string;
  /**
   * comment / label / issue_state: the only issue or PR this output may write
   * to (GitHub issue or PR number, Linear issue identifier), or `{ input: <name> }`
   * to pin it to a run input. An intent naming another is refused; an intent
   * naming none uses the pin. An empty pinned input refuses the write.
   * `issue_state` always needs an issue: the pin, or a number on the intent.
   */
  number?: SafeOutputPin;
  /** issue_state only: the one change this output may make. Default: either. */
  state?: SafeOutputState;
}

/** A pinned issue / PR: a literal number or identifier, or the name of a run input that holds one. */
export type SafeOutputPin = string | number | { input: string };

/** Workflow-level safe-output policy: the ceiling and run-wide limits. */
export interface SafeOutputsPolicy {
  /** Output types any node may declare. Absent: all types. */
  allow?: SafeOutputType[];
  /** Total writes per run across all nodes. */
  max?: number;
  /** Preview every write and apply none. */
  staged?: boolean;
  /** GitHub logins whose runs may write. */
  trusted_actors?: string[];
  /** Author associations whose runs may write (from the GitHub event payload). */
  trusted_associations?: AuthorAssociation[];
  /** One model call that may veto the writes. It can never authorize one. */
  screen?: boolean;
}

/** What the write stage did with one intent. Metadata only: never a title or body. */
export interface SafeOutputReceipt {
  type: string;
  /** Skill that applied (or would apply) it. */
  via?: string;
  status: "applied" | "staged" | "skipped" | "refused" | "vetoed" | "failed";
  /** Why it was skipped, refused, vetoed or failed. Fixed wording, never model text. */
  reason?: string;
  target?: string;
  /** Issue / PR / comment number or id the write produced. */
  ref?: string | number;
  /** Web URL of what the write produced, as the API returned it. */
  url?: string;
}

/**
 * Per-node skill-tool filter. See {@link Node.tools}.
 * At least one of `allow` / `deny` must be declared (schema-enforced).
 */
export interface NodeToolFilter {
  /** When present, only these skill tool names are exposed at the node. */
  allow?: string[];
  /** Skill tool names removed from the node (applied after `allow`). */
  deny?: string[];
}

/** An edge connecting two nodes */
export interface Edge {
  from: string;
  to: string;
  /** Natural language condition, evaluated at runtime by the workflow's harness. */
  when?: string;
  /** Max times this edge can be followed (enables retry loops). Default: unlimited. */
  max_iterations?: number;
}

/**
 * Workflow type discriminator. Cloud uses this to render runs in a
 * type-specific way. Adding a value requires a corresponding renderer.
 *
 * Single source of truth: the Zod enum (`workflowTypeZ`), the published
 * JSON-schema enum (`workflowJsonSchema.properties.workflow_type.enum`),
 * and the `WorkflowType` TS type are all derived from this tuple. See the
 * contract test in `__tests__/contract-tests.test.ts` asserting they agree.
 */
export const WORKFLOW_TYPES = [
  "pr_review",
  "e2e_test",
  "content_generation",
  "monitor",
  "data_sync",
  "generic",
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

/** A complete workflow definition. Pure data, fully serializable. */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  /** Optional. Defaults to "generic" when absent. Required on marketplace templates. */
  workflow_type?: WorkflowType;
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
  /** Default execution model for every node. Overridable per-node. Free-text passthrough. */
  model?: string;
  /** Soft cap on expected judge calls per workflow run. Warning at load time when exceeded. */
  judge_budget?: number;
  /**
   * Spend ceiling for the whole run and for every node (#449). A node's own
   * `budget` may only narrow it. The CLI's `--max-tokens` / `--max-cost` tighten it.
   */
  budget?: Budget;
  /**
   * What prior results a node's prompt receives (#337). `bounded` (default):
   * only nodes it can depend on (graph ancestors, nodes named by `requires`
   * or its instruction), and a schema'd node's declared fields instead of its
   * free-text `summary`. `full`: every prior node's complete data.
   */
  context_mode?: ContextMode;
  /**
   * Declared per-run input contract. When present, the CLI validates the
   * caller-provided `--input` JSON against this declaration, applies defaults
   * for omitted optional fields, and rejects malformed input before the
   * executor runs. Workflows without an `inputs` block accept any JSON
   * object (back-compat).
   *
   * See `src/inputs.ts` for the field shape and validation rules.
   */
  inputs?: import("./inputs.js").WorkflowInputs;
  /** Default and ceiling for every node's `permissions` (#365). Absent: `write`. */
  permissions?: NodePermissions;
  /** Workflow-level safe-output policy (#365). */
  safe_outputs?: SafeOutputsPolicy;
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

/**
 * Model usage + cost accounting for a single node's AI invocation.
 *
 * SHAPE-ONLY telemetry: counts, cost, and turn totals. Never any prompt,
 * response, or tool payload. Populated from the Claude Agent SDK's terminal
 * `result` message (`total_cost_usd`, `usage`, `num_turns`). Absent when the
 * node made no AI call (e.g. a deterministic node) or when running against a
 * mock/older SDK that doesn't emit the fields.
 */
export interface NodeUsage {
  /** Aggregate USD cost the SDK billed for this node's turn(s). */
  costUsd?: number;
  /** Input (prompt) tokens across the node's turns. */
  inputTokens?: number;
  /** Output (completion) tokens across the node's turns. */
  outputTokens?: number;
  /** Cache-read input tokens (prompt-cache hits). */
  cacheReadTokens?: number;
  /** Cache-creation input tokens (prompt-cache writes). */
  cacheCreationTokens?: number;
  /** Number of model turns the SDK ran for this node. */
  numTurns?: number;
}

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
  /**
   * Token + cost accounting for this node's AI invocation. Shape-only
   * telemetry; see {@link NodeUsage}. Absent for nodes that made no AI call.
   */
  usage?: NodeUsage;
  /**
   * Dry-run only: names of the node's skill tools that were withheld because
   * they are write-capable or unclassified. Absent on normal runs and on
   * dry-run nodes that had no write tools.
   */
  skippedWrites?: string[];
  /** Which harness ran this node (id + version). Set by harness adapters; absent for mocks. */
  harness?: { id: string; version: string };
  /** Opinions this run could not honor natively. Always empty for Claude Code. */
  degraded?: string[];
  /**
   * Agent floor this node actually ran under, for the run receipt. Set by the
   * Claude Code harness only; absent for harnesses that do not report it.
   */
  policy?: NodePolicyFacts;
  /** Safe outputs (#365): what the write stage did with each intent. Absent when the node declares none. */
  outputs?: SafeOutputReceipt[];
  /**
   * Set when this node's spend crossed a token or cost budget (#449), or when
   * the run's budget was already spent before it could start. The node is
   * `failed`, `fail_soft` and `on_fail: continue` do not apply, and the run halts.
   */
  budget?: BudgetOverrun;
}

/** Facts about the agent floor (scoped env, process sandbox) a node ran under. Booleans and a mode only. */
export interface NodePolicyFacts {
  /** The agent subprocess env was narrowed to the allowlist. */
  envScope: boolean;
  /** Requested sandbox mode. */
  sandbox: "off" | "auto" | "strict";
  /** The sandbox was enabled for this node (false under `off`, or `auto` on a host that cannot sandbox). */
  sandboxStarted: boolean;
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
  /**
   * Non-fatal contract violation surfaced during node execution. Currently
   * emitted when a source node declares output properties that the agent
   * did not emit. The route eval view fills the missing keys with `null`
   * so the LLM evaluator can't ghost-match conditions like "is undefined"
   * or "is 0", but the operator still wants a loud signal in the log
   * stream.
   *
   * `fields` lists the declared property names that were missing from the
   * emitted data. `reason` is a short human-readable summary.
   */
  | { type: "node:warning"; node: string; reason: string; fields: string[] }
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

/**
 * @deprecated as the public seam: new code targets `AgentHarness`
 * (harness/types.ts). This interface stays for back-compat;
 * `claudeCompat()` wraps it into a harness.
 */
export interface Claude {
  /** Default judge model when no evaluator, node or workflow names one. */
  readonly defaultJudgeModel?: string;
  /** Run a node: give Claude an instruction, context, and tools */
  run(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
    /** Called with status messages while Claude is working (tool name, etc.) */
    onProgress?: (message: string) => void;
    /** MCP servers declared by this node's resolved skills. Explicit client configs win. */
    mcpServers?: Record<string, McpServerConfig>;
    /** Per-node turn limit. Overrides the client default when set. */
    maxTurns?: number;
    /** Built-in SDK tool names to disallow for this node (e.g. ["Bash"]). */
    disallowedTools?: string[];
    /**
     * Portable built-in tool classes denied at this node (`tools.deny` entries
     * that name a class: shell, write, edit, net, subagent). Each harness
     * compiles them to its native form, or reports them in `degraded`.
     */
    deny?: ToolClass[];
    /** Per-node execution model. Overrides the client default when set. Absent = no SDK model option emitted. */
    model?: string;
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
    /**
     * What this node's agent may see (#360): env var names declared by the
     * node's skills (added to the scoped subprocess env) and the provider
     * hosts its sandboxed commands may reach. Absent = allowlist only.
     */
    agentAccess?: { envVars: string[]; domains: string[] };
    /**
     * Dry-run: the node must not change anything. `tools` is already filtered
     * to reads; implementations MUST NOT add any other write-capable tool
     * (external MCP servers, shell, file-edit built-ins).
     */
    readOnly?: boolean;
    /**
     * The node's portable policy (#365), compiled per adapter. Legacy `Claude`
     * implementations may ignore it; `readOnly` and `disallowedTools` above
     * carry the same read-only and native-deny intent.
     */
    policy?: import("./harness/types.js").NodePolicy;
    /**
     * Live spend (#449): a harness that declares `capabilities.usage.live`
     * calls this with the run's cumulative usage as it grows. The executor
     * aborts `signal` when a budget is crossed. Harnesses that report usage
     * only at the end never call it.
     */
    onUsage?: (usage: NodeUsage) => void;
  }): Promise<NodeResult>;

  /**
   * Evaluate a routing condition — pick one of N choices.
   *
   * Fails closed: returns `null` when the routing decision could not be made
   * (SDK error, timeout, non-success subtype, or an unparseable answer).
   * Callers MUST treat `null` as "no decision" and take an explicit default
   * edge or terminate — never fall through to the first choice. Returning a
   * choice id on that path is the fail-open bug this contract exists to close.
   */
  evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
  }): Promise<string | null>;

  /**
   * Single-completion free-text query. No tools, no output schema.
   * Used by the executor to generate retry strategies in autonomous reflection mode
   * and by judge evaluators to score node results against a rubric.
   *
   * `model` overrides the client's default for this call. Implementations
   * SHOULD use it; mocks MAY ignore it.
   */
  ask(opts: {
    instruction: string;
    context: Record<string, unknown>;
    model?: string;
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
  }): Promise<string>;
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
