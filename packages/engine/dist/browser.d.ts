/**
 * Browser-safe entry point for @sweny-ai/engine.
 *
 * Exports only pure serializable types and data — no Node.js implementations.
 * Use this entry when bundling for the browser (e.g. in Vite builds).
 */
export type { WorkflowDefinition, StepDefinition, WorkflowPhase, StepResult, WorkflowResult, Workflow, StepImplementations, RunOptions, ProviderRegistry, } from "./types.js";
export type { ExecutionEvent, RunObserver } from "./types.js";
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";
export { validateWorkflow } from "./validate.js";
export { createWorkflow, runWorkflow, createProviderRegistry } from "./browser-runner.js";
export { triageDefinition } from "./recipes/triage/definition.js";
export { implementDefinition } from "./recipes/implement/definition.js";
export declare const WORKFLOW_YAML_SCHEMA_HEADER = "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n";
//# sourceMappingURL=browser.d.ts.map