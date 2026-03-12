import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";
/**
 * Deterministic dedup check — short-circuits the recipe before any LLM or
 * provider calls if this event has already been processed within the TTL window.
 *
 * Only active when `config.dedupStore` is provided. Safe to omit for one-off
 * runs or when the caller guarantees uniqueness upstream.
 */
export declare function dedupCheck(ctx: WorkflowContext<TriageConfig>): Promise<StepResult>;
//# sourceMappingURL=dedup-check.d.ts.map