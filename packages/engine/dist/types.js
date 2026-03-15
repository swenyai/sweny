/**
 * Thrown by runWorkflow() when required provider environment variables are missing.
 * Reports all missing vars at once — never fails on first missing var.
 */
export class WorkflowConfigError extends Error {
    constructor(workflowName, issues) {
        const lines = issues.map(({ stepId, providerName, missingEnvVars }) => `  step "${stepId}" (${providerName}): ${missingEnvVars.join(", ")}`);
        super(`Missing required configuration for workflow "${workflowName}":\n${lines.join("\n")}\n\nSet the missing environment variables and re-run.`);
        this.name = "WorkflowConfigError";
    }
}
//# sourceMappingURL=types.js.map