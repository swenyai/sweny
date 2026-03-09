/**
 * Browser-safe entry point for @sweny-ai/engine.
 *
 * Exports only pure serializable types and data — no Node.js implementations.
 * Use this entry when bundling for the browser (e.g. in Vite builds).
 */

// Pure types
export type { RecipeDefinition, StateDefinition, WorkflowPhase, StepResult, WorkflowResult } from "./types.js";

// Observer types
export type { ExecutionEvent, RunObserver } from "./types.js";

// Observer utilities
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";

// Runner — no Node.js deps, safe for browser simulation
export { runRecipe, createRecipe, validateDefinition, createProviderRegistry } from "./runner-recipe.js";

// Pure definition objects (no implementation functions)
export { triageDefinition } from "./recipes/triage/definition.js";
export { implementDefinition } from "./recipes/implement/definition.js";
