import { createWorkflow } from "./runner-recipe.js";
/** Global registry of built-in step types */
export const builtinStepRegistry = new Map();
export function registerStepType(entry) {
    builtinStepRegistry.set(entry.type, entry);
}
/**
 * Resolve a WorkflowDefinition into a runnable Workflow by looking up
 * each step's `type` field in the built-in step registry.
 *
 * Steps without a `type` field will throw. For custom implementations,
 * use createWorkflow() directly.
 */
export function resolveWorkflow(definition) {
    const implementations = {};
    for (const [stepId, step] of Object.entries(definition.steps)) {
        if (!step.type) {
            throw new Error(`Step "${stepId}" has no type — set step.type to a built-in type (e.g. "sweny/fetch-issue") or use createWorkflow() with custom implementations`);
        }
        const entry = builtinStepRegistry.get(step.type);
        if (!entry) {
            const available = [...builtinStepRegistry.keys()].join(", ");
            throw new Error(`Unknown step type "${step.type}" in step "${stepId}". Available types: ${available || "(none registered)"}`);
        }
        implementations[stepId] = entry.impl;
    }
    return createWorkflow(definition, implementations);
}
//# sourceMappingURL=step-registry.js.map