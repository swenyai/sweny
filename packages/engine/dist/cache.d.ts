import type { StepResult, WorkflowPhase } from "./types.js";
/** A cached step result with metadata for replay. */
export interface CacheEntry {
    /** The step's result, exactly as returned from step.run(). */
    result: StepResult;
    /** Any ctx.skipPhase() calls made during this step's execution. */
    skippedPhases: Array<{
        phase: WorkflowPhase;
        reason: string;
    }>;
    /** Unix ms timestamp when this entry was written. */
    createdAt: number;
}
/** Storage contract for step-level caching. */
export interface StepCache {
    /** Retrieve a non-expired entry, or undefined on miss/expiry. */
    get(stepName: string): Promise<CacheEntry | undefined>;
    /** Persist a successful step result. */
    set(stepName: string, entry: CacheEntry): Promise<void>;
}
//# sourceMappingURL=cache.d.ts.map