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
    steps: Array<{
        name: string;
        phase: WorkflowPhase;
        result: StepResult;
    }>;
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
/**
 * A single node in a Recipe.
 *
 * Nodes are atomic, reusable units: they receive context, do work, and return
 * a StepResult. The same node can be wired into multiple recipes. Routing to
 * the next node is determined by the `on` transition map.
 */
export interface RecipeStep<TConfig = unknown> {
    /** Unique id within the recipe (used as key in ctx.results and as transition target). */
    id: string;
    /** Phase for logging and failure semantics (critical nodes in any phase abort on failure). */
    phase: WorkflowPhase;
    /** Execute the node. Throw to fail. */
    run: (ctx: WorkflowContext<TConfig>) => Promise<StepResult>;
    /**
     * Outcome → next node id.
     *
     * Outcome is resolved in order:
     *   1. result.data?.outcome (string) — explicit outcome set by the node
     *   2. result.status           ("success" | "skipped" | "failed")
     *
     * Reserved target: "end" — stops the recipe immediately (success).
     * No match: falls back to the next node in declaration order for
     * success/skipped, or stops for failed.
     */
    on?: Record<string, string>;
    /**
     * If true, any failure immediately aborts the entire recipe (status: "failed").
     * Use for nodes whose output is required by everything that follows.
     * Default: false.
     */
    critical?: boolean;
}
/**
 * A complete recipe — a named, composable workflow defined as a DAG of nodes.
 *
 * The runner starts at `start`, executes each node, and follows `on` transitions
 * to determine the next node. Shared nodes (e.g. create-pr, notify) can be
 * imported by multiple recipes without duplication.
 */
export interface Recipe<TConfig = unknown> {
    /** Human-readable name used in logs. */
    name: string;
    /** Optional description of what this recipe does. */
    description?: string;
    /** Id of the first node to execute. */
    start: string;
    /** All nodes in declaration order. Order is the default routing fallback. */
    nodes: RecipeStep<TConfig>[];
}
//# sourceMappingURL=types.d.ts.map