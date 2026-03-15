/**
 * Validate a WorkflowDefinition for structural correctness.
 * Returns an array of errors (empty array = valid).
 * Does NOT check implementations (use createWorkflow for that).
 *
 * Pure function — no Node.js dependencies, safe for browser use.
 */
export function validateWorkflow(def) {
    const errors = [];
    const stepIds = new Set(Object.keys(def.steps));
    // initial must exist
    if (!stepIds.has(def.initial)) {
        errors.push({
            code: "MISSING_INITIAL",
            message: `initial step "${def.initial}" does not exist in steps`,
        });
    }
    // all on/next targets must be valid step ids or "end"
    for (const [stepId, step] of Object.entries(def.steps)) {
        if (step.next && step.next !== "end" && !stepIds.has(step.next)) {
            errors.push({
                code: "UNKNOWN_TARGET",
                message: `step "${stepId}" next target "${step.next}" does not exist`,
                stateId: stepId,
                targetId: step.next,
            });
        }
        for (const [outcome, target] of Object.entries(step.on ?? {})) {
            if (target !== "end" && !stepIds.has(target)) {
                errors.push({
                    code: "UNKNOWN_TARGET",
                    message: `step "${stepId}" on["${outcome}"] target "${target}" does not exist`,
                    stateId: stepId,
                    targetId: target,
                });
            }
        }
    }
    return errors;
}
//# sourceMappingURL=validate.js.map