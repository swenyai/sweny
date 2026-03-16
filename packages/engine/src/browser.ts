/**
 * Browser-safe entry point for @sweny-ai/engine.
 *
 * Exports only pure serializable types and data — no Node.js implementations.
 * Use this entry when bundling for the browser (e.g. in Vite builds).
 */

// Pure types
export type {
  WorkflowDefinition,
  StepDefinition,
  WorkflowPhase,
  StepResult,
  WorkflowResult,
  Workflow,
  StepImplementations,
  RunOptions,
  ProviderRegistry,
} from "./types.js";

// Observer types
export type { ExecutionEvent, RunObserver } from "./types.js";

// Observer utilities
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";

// Pure validation — no Node.js deps, safe for browser use
export { validateWorkflow } from "./validate.js";

// Runner — browser-safe (no @sweny-ai/providers import, uses console directly)
export { createWorkflow, runWorkflow, createProviderRegistry } from "./browser-runner.js";

// Pure definition objects (no implementation functions)
export { triageDefinition } from "./recipes/triage/definition.js";
export { implementDefinition } from "./recipes/implement/definition.js";

// Schema metadata — pure string constant, safe for browser use.
// Defined here directly (not re-exported from index.ts) to avoid pulling
// in Node.js transitive deps from the main entry.
export const WORKFLOW_YAML_SCHEMA_HEADER =
  "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n";
