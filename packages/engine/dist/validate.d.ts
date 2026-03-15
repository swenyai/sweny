import type { WorkflowDefinitionError, WorkflowDefinition } from "./types.js";
/**
 * Validate a WorkflowDefinition for structural correctness.
 * Returns an array of errors (empty array = valid).
 * Does NOT check implementations (use createWorkflow for that).
 *
 * Pure function — no Node.js dependencies, safe for browser use.
 */
export declare function validateWorkflow(def: WorkflowDefinition): WorkflowDefinitionError[];
//# sourceMappingURL=validate.d.ts.map