import type { Logger } from "@sweny-ai/providers";

/** The three phases of every recipe. */
export type WorkflowPhase = "learn" | "act" | "report";

/** Result returned by a node after execution. */
export interface StepResult {
  /** Whether the node succeeded, was skipped, or failed. */
  status: "success" | "skipped" | "failed";
  /**
   * Arbitrary output data — downstream nodes read this via ctx.results.
   * Set data.outcome (string) to drive on: routing in the runner.
   */
  data?: Record<string, unknown>;
  /** Human-readable reason (especially useful for skipped/failed). */
  reason?: string;
  /** True when this result was replayed from cache rather than freshly executed. */
  cached?: boolean;
}

/** Mutable context threaded through every node in a recipe run. */
export interface WorkflowContext<TConfig = unknown> {
  /** Recipe-specific configuration. */
  config: TConfig;
  /** Logger for structured output. */
  logger: Logger;
  /** Accumulated results from completed nodes, keyed by node id. */
  results: Map<string, StepResult>;
  /** Instantiated providers, keyed by role ("observability", "issueTracker", etc.). */
  providers: ProviderRegistry;
}

/** Type-safe provider bag. */
export interface ProviderRegistry {
  /** Get a provider by role key. Throws if not found. */
  get<T>(key: string): T;
  /** Check if a provider is registered under this key. */
  has(key: string): boolean;
  /** Register a provider under a role key. */
  set(key: string, provider: unknown): void;
}

/** Overall result of running a recipe. */
export interface WorkflowResult {
  /** completed = all nodes finished, failed = critical node failed, partial = non-critical failure. */
  status: "completed" | "failed" | "partial";
  /** Every node that was attempted, in execution order. */
  steps: Array<{ name: string; phase: WorkflowPhase; result: StepResult }>;
  /** Total wall-clock milliseconds. */
  duration: number;
}

/** Minimal node identity passed to beforeStep / afterStep hooks. */
export interface StepMeta {
  /** The node's unique id within the recipe. */
  id: string;
  /** The phase this node belongs to. */
  phase: WorkflowPhase;
}

/** Options for runRecipe. */
export interface RunOptions {
  /** Logger instance. Falls back to console. */
  logger?: Logger;
  /**
   * Called before each node executes.
   * Return false to skip the node (it will be recorded as "skipped" and routing continues normally).
   */
  beforeStep?(step: StepMeta, ctx: WorkflowContext): Promise<boolean | void>;
  /** Called after each node completes (including skipped and cached). */
  afterStep?(step: StepMeta, result: StepResult, ctx: WorkflowContext): Promise<void>;
  /** Step-level cache. When provided, successful results are stored and replayed on re-run. */
  cache?: import("./cache.js").StepCache;
}

// ---------------------------------------------------------------------------
// Recipe Spec v2 — states{} map, pure serializable definition
// ---------------------------------------------------------------------------

/**
 * A pure-data recipe definition. Fully serializable — no functions.
 * Can be stored in JSON, versioned, and rendered as a visual graph.
 * Implementations are injected separately via createRecipe().
 */
export interface RecipeDefinition {
  /** Unique machine-readable identifier (for persistence and import/export). */
  id: string;
  /** Semver string, e.g. "1.0.0". Increment when the shape changes. */
  version: string;
  /** Human-readable name used in logs. */
  name: string;
  /** Optional description of what this recipe does. */
  description?: string;
  /** Id of the first state to execute. Must be a key in `states`. */
  initial: string;
  /**
   * All states keyed by their unique id.
   * Order is irrelevant — all routing is explicit via `on` and `next`.
   */
  states: Record<string, StateDefinition>;
}

export interface StateDefinition {
  /** Phase for swimlane grouping and failure semantics. */
  phase: WorkflowPhase;
  /** Human-readable description (shown in visual editor, not executed). */
  description?: string;
  /**
   * If true, any failure immediately aborts the entire recipe (status: "failed").
   * Use for states whose output is required by everything downstream.
   */
  critical?: boolean;
  /**
   * Explicit default successor state (for linear chains).
   * Used when no `on` key matches the resolved outcome.
   * Shorthand for `on: { success: "...", skipped: "..." }`.
   */
  next?: string;
  /**
   * Outcome-based transition map.
   *
   * Key resolution order:
   *   1. result.data?.outcome (string)  — explicit outcome set by implementation
   *   2. result.status                  — "success" | "skipped" | "failed"
   *   3. "*"                            — wildcard default
   *
   * After `on` is exhausted, falls back to `next` (success/skipped only).
   *
   * Reserved target value: "end" — stops the recipe successfully.
   */
  on?: Record<string, string>;
}

/**
 * Implementation functions keyed by state id.
 * Every state id in RecipeDefinition.states must have an entry here.
 */
export type StateImplementations<TConfig> = Record<string, (ctx: WorkflowContext<TConfig>) => Promise<StepResult>>;

/**
 * A complete wired recipe ready to run.
 * Definition is pure data; implementations are the actual async functions.
 */
export interface Recipe<TConfig = unknown> {
  definition: RecipeDefinition;
  implementations: StateImplementations<TConfig>;
}

/** Validation error describing a structural problem with a RecipeDefinition. */
export interface DefinitionError {
  code:
    | "MISSING_INITIAL" // initial does not exist in states
    | "UNKNOWN_TARGET" // an on/next target does not exist in states and isn't "end"
    | "MISSING_IMPLEMENTATION"; // a state id has no implementation (checked by createRecipe)
  message: string;
  stateId?: string;
  targetId?: string;
}
