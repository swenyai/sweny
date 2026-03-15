import { createProviderRegistry } from "./registry.js";
import { validateWorkflow } from "./validate.js";
import type { ProviderRegistry, Workflow, WorkflowDefinition, RunOptions, StepImplementations, WorkflowResult } from "./types.js";
import { WorkflowConfigError } from "./types.js";
export { WorkflowConfigError };
export { validateWorkflow };
/**
 * Create a Workflow by combining a definition with implementations.
 * Validates the definition and that all step ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export declare function createWorkflow<TConfig>(definition: WorkflowDefinition, implementations: StepImplementations<TConfig>): Workflow<TConfig>;
/**
 * Execute a Workflow as a state machine.
 *
 * Starts at workflow.definition.initial, executes each step, then follows
 * on: transitions to determine the next step. Stops when a transition
 * resolves to "end", there is no next step, or a critical step fails.
 *
 * Runs pre-flight config validation before any steps execute.
 * Throws WorkflowConfigError if any required provider env vars are missing.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the implementation
 *   2. result.status        ("success" | "skipped" | "failed")
 *   3. "*"                  — wildcard default
 *   4. next                 — fallback for success/skipped
 */
export declare function runWorkflow<TConfig>(workflow: Workflow<TConfig>, config: TConfig, providers: ProviderRegistry, options?: RunOptions): Promise<WorkflowResult>;
export { createProviderRegistry };
//# sourceMappingURL=runner-recipe.d.ts.map