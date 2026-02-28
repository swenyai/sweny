import type { Logger } from "@sweny/providers";
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
}
//# sourceMappingURL=types.d.ts.map