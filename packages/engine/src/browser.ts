/**
 * Browser-safe entry point for @sweny-ai/engine.
 *
 * Exports only pure serializable types and data — no Node.js implementations.
 * Use this entry when bundling for the browser (e.g. in Vite builds).
 */

// Pure types
export type { RecipeDefinition, StateDefinition, WorkflowPhase, StepResult, WorkflowResult } from "./types.js";

// Pure definition objects (no implementation functions)
export { triageDefinition } from "./recipes/triage/definition.js";
export { implementDefinition } from "./recipes/implement/definition.js";
