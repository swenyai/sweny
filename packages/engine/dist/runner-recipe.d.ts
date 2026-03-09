import { createProviderRegistry } from "./registry.js";
import { validateDefinition } from "./validate.js";
import type { ProviderRegistry, Recipe, RecipeDefinition, RunOptions, StateImplementations, WorkflowResult } from "./types.js";
export { validateDefinition };
/**
 * Create a Recipe by combining a definition with implementations.
 * Validates the definition and that all state ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export declare function createRecipe<TConfig>(definition: RecipeDefinition, implementations: StateImplementations<TConfig>): Recipe<TConfig>;
/**
 * Execute a Recipe as a state machine.
 *
 * Starts at recipe.definition.initial, executes each state, then follows
 * on: transitions to determine the next state. Stops when a transition
 * resolves to "end", there is no next state, or a critical state fails.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the implementation
 *   2. result.status        ("success" | "skipped" | "failed")
 *   3. "*"                  — wildcard default
 *   4. next                 — fallback for success/skipped
 */
export declare function runRecipe<TConfig>(recipe: Recipe<TConfig>, config: TConfig, providers: ProviderRegistry, options?: RunOptions): Promise<WorkflowResult>;
export { createProviderRegistry };
//# sourceMappingURL=runner-recipe.d.ts.map