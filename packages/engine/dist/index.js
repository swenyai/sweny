// WorkflowConfigError is a class, not just a type
export { WorkflowConfigError } from "./types.js";
// Runner
export { runWorkflow, createProviderRegistry, validateWorkflow, createWorkflow } from "./runner-recipe.js";
// Observer utilities
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";
// Built-in workflows
export { triageWorkflow, triageDefinition } from "./recipes/triage/index.js";
export { implementWorkflow, implementDefinition } from "./recipes/implement/index.js";
export { getStepData } from "./recipes/triage/index.js";
export { inMemoryDedupStore } from "./lib/dedup-store.js";
export { fingerprintEvent } from "./lib/fingerprint.js";
// Schema metadata — use this header when emitting workflow YAML so editors
// can auto-validate against the published JSON Schema.
export const WORKFLOW_YAML_SCHEMA_HEADER = "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n";
// builtinStepRegistry is intentionally not re-exported: it is a mutable singleton
// whose state is managed by @sweny-ai/engine/builtin-steps. Exposing direct Map
// access would let consumers clear or corrupt registrations from other modules.
export { registerStepType, resolveWorkflow, listStepTypes } from "./step-registry.js";
//# sourceMappingURL=index.js.map