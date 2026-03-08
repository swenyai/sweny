import type { Logger } from "@sweny-ai/providers";
/** The three phases of every workflow. */
export type WorkflowPhase = "learn" | "act" | "report";
/** Result of executing a single step. */
export interface StepResult {
    /** Whether the step succeeded, was skipped, or failed. */
    status: "success" | "skipped" | "failed";
    /** Arbitrary output data — downstream steps read this via context.results. */
    data?: Record<string, unknown>;
    /** Human-readable reason (especially useful for skipped/failed). */
    reason?: string;
    /** True when this result was replayed from cache rather than freshly executed. */
    cached?: boolean;
}
/** A single step in a workflow. */
export interface WorkflowStep<TConfig = unknown> {
    /** Unique name within the workflow (used as key in context.results). */
    name: string;
    /** Which phase this step belongs to. */
    phase: WorkflowPhase;
    /** Execute the step. Return result. Throw to fail. */
    run(ctx: WorkflowContext<TConfig>): Promise<StepResult>;
}
/** Mutable context threaded through all steps in a run. */
export interface WorkflowContext<TConfig = unknown> {
    /** Recipe-specific configuration. */
    config: TConfig;
    /** Logger for structured output. */
    logger: Logger;
    /** Accumulated results from completed steps, keyed by step name. */
    results: Map<string, StepResult>;
    /** Bag of instantiated providers keyed by role. */
    providers: ProviderRegistry;
    /** Signal to short-circuit remaining steps in a phase. */
    skipPhase(phase: WorkflowPhase, reason: string): void;
    /** Check if a phase has been skipped. */
    isPhaseSkipped(phase: WorkflowPhase): boolean;
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
/** A complete workflow definition — an ordered list of steps grouped by phase. */
export interface Workflow<TConfig = unknown> {
    /** Human-readable workflow name. */
    name: string;
    /** Optional description of what this workflow does. */
    description?: string;
    /** Ordered list of steps. Steps are executed in array order but grouped by phase. */
    steps: WorkflowStep<TConfig>[];
}
/** Overall result of running a workflow. */
export interface WorkflowResult {
    /** Completed = all steps done, failed = a learn step failed, partial = act/report failed. */
    status: "completed" | "failed" | "partial";
    /** Results for every step that was attempted. */
    steps: Array<{
        name: string;
        phase: WorkflowPhase;
        result: StepResult;
    }>;
    /** Total wall-clock milliseconds. */
    duration: number;
}
/** Options for the workflow runner. */
export interface RunOptions {
    /** Logger instance. Falls back to console. */
    logger?: Logger;
    /** Called before each step. Return false to skip the step. */
    beforeStep?(step: WorkflowStep, ctx: WorkflowContext): Promise<boolean | void>;
    /** Called after each step completes. */
    afterStep?(step: WorkflowStep, result: StepResult, ctx: WorkflowContext): Promise<void>;
    /** Step-level cache. When provided, successful results are stored and replayed on re-run. */
    cache?: import("./cache.js").StepCache;
}
/**
 * A single node in a recipe DAG.
 * Nodes are atomic, reusable units that run and return a StepResult.
 * Routing to the next node is determined by the outcome (see on).
 */
export interface RecipeStep<TConfig = unknown> {
    /** Unique id within the DAG (used as key in results map and transition targets). */
    id: string;
    /** Phase for logging and failure semantics (learn failure = abort). */
    phase: WorkflowPhase;
    /** Execute the node. Throw to fail. */
    run: (ctx: WorkflowContext<TConfig>) => Promise<StepResult>;
    /**
     * Outcome → next node id.
     *
     * Outcome is resolved in order:
     *   1. result.data?.outcome (string) — explicit outcome returned by the node
     *   2. result.status ("success" | "skipped" | "failed")
     *
     * Special target id "end" stops the DAG.
     * If the outcome has no matching transition, the runner continues to the
     * next node in declaration order (for "success") or stops (for "failed").
     */
    on?: Record<string, string>;
    /**
     * If true, a failure aborts the entire DAG immediately (same semantics as
     * learn phase in the sequential runner). Default: false.
     */
    critical?: boolean;
}
/** A complete recipe as a directed acyclic graph of nodes. */
export interface Recipe<TConfig = unknown> {
    name: string;
    description?: string;
    /** Id of the first node to execute. */
    start: string;
    /** All nodes in declaration order. Used for default sequencing when no transition matches. */
    nodes: RecipeStep<TConfig>[];
}
//# sourceMappingURL=types.d.ts.map