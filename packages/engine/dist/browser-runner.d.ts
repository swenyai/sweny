/**
 * Browser-safe runner utilities.
 *
 * Mirrors runner-recipe.ts but avoids importing @sweny-ai/providers
 * (which pulls in Node.js-only code). Uses a console-based logger instead.
 *
 * This module is only used by the browser entry point (browser.ts).
 */
import { createProviderRegistry } from "./registry.js";
import type { Recipe, RecipeDefinition, RunOptions, StateImplementations, WorkflowResult } from "./types.js";
export { createProviderRegistry };
/**
 * Create a Recipe by combining a definition with implementations.
 * Validates the definition and that all state ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export declare function createRecipe<TConfig>(definition: RecipeDefinition, implementations: StateImplementations<TConfig>): Recipe<TConfig>;
/**
 * Execute a Recipe as a state machine (browser-safe version).
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
export declare function runRecipe<TConfig>(recipe: Recipe<TConfig>, config: TConfig, providers: ReturnType<typeof createProviderRegistry>, options?: RunOptions): Promise<WorkflowResult>;
//# sourceMappingURL=browser-runner.d.ts.map