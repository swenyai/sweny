import type { WorkflowContext } from "../../types.js";
import type { TriageConfig, TriageStepDataMap } from "./types.js";

/**
 * Get typed step result data from the workflow context.
 *
 * Replaces unsafe casts like `ctx.results.get("investigate")?.data as unknown as T`.
 * Step name is checked at compile time — typos are caught immediately.
 *
 * @example
 * const investigation = getStepData(ctx, "investigate");
 * //    ^? InvestigationResult | undefined
 */
export function getStepData<K extends keyof TriageStepDataMap>(
  ctx: WorkflowContext<TriageConfig>,
  stepName: K,
): TriageStepDataMap[K] | undefined {
  return ctx.results.get(stepName)?.data as TriageStepDataMap[K] | undefined;
}
