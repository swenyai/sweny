/**
 * Browser-safe entry point for @sweny-ai/engine.
 *
 * Exports only pure serializable types and data — no Node.js implementations.
 * Use this entry when bundling for the browser (e.g. in Vite builds).
 */

// Pure types
export type {
  RecipeDefinition,
  StateDefinition,
  WorkflowPhase,
  StepResult,
  WorkflowResult,
  Recipe,
  StateImplementations,
  RunOptions,
  ProviderRegistry,
} from "./types.js";

// Observer types
export type { ExecutionEvent, RunObserver } from "./types.js";

// Observer utilities
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";

// Pure validation — no Node.js deps, safe for browser use
export { validateDefinition } from "./validate.js";

// Runner — browser-safe (no @sweny-ai/providers import, uses console directly)
export { createRecipe, runRecipe, createProviderRegistry } from "./browser-runner.js";

// Pure definition objects (no implementation functions)
export { triageDefinition } from "./recipes/triage/definition.js";
export { implementDefinition } from "./recipes/implement/definition.js";
