/**
 * Browser-safe entry point for @sweny-ai/engine.
 *
 * Exports only pure serializable types and data — no Node.js implementations.
 * Use this entry when bundling for the browser (e.g. in Vite builds).
 */
export type { RecipeDefinition, StateDefinition, WorkflowPhase, StepResult, WorkflowResult } from "./types.js";
export { triageDefinition } from "./recipes/triage/definition.js";
//# sourceMappingURL=browser.d.ts.map