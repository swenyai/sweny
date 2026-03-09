/**
 * Browser-safe runner utilities.
 *
 * Re-implements createProviderRegistry and a minimal runRecipe/createRecipe
 * without importing @sweny-ai/providers (which pulls in Node.js-only code).
 *
 * This module is only used by the browser entry point (browser.ts).
 */
import type { ProviderRegistry, Recipe, RecipeDefinition, RunOptions, StateImplementations, WorkflowResult } from "./types.js";
/** Create an empty provider registry. */
export declare function createProviderRegistry(): ProviderRegistry;
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
 * on: transitions to determine the next state.
 */
export declare function runRecipe<TConfig>(recipe: Recipe<TConfig>, config: TConfig, providers: ProviderRegistry, options?: RunOptions): Promise<WorkflowResult>;
//# sourceMappingURL=browser-runner.d.ts.map