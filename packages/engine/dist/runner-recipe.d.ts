import { createProviderRegistry } from "./registry.js";
import type { ProviderRegistry, Recipe, RunOptions, WorkflowResult } from "./types.js";
/**
 * Execute a Recipe as a state machine.
 *
 * Starts at recipe.start, executes each node, then follows on: transitions to
 * determine the next node. Stops when a transition resolves to "end", there is
 * no next node, or a critical node fails.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the node
 *   2. result.status        ("success" | "skipped" | "failed")
 */
export declare function runRecipe<TConfig>(recipe: Recipe<TConfig>, config: TConfig, providers: ProviderRegistry, options?: RunOptions): Promise<WorkflowResult>;
export { createProviderRegistry };
//# sourceMappingURL=runner-recipe.d.ts.map