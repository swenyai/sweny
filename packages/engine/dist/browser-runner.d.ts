/**
 * Browser-safe runner utilities.
 *
 * Mirrors runner-recipe.ts but avoids importing @sweny-ai/providers
 * (which pulls in Node.js-only code). Uses a console-based logger instead.
 *
 * This module is only used by the browser entry point (browser.ts).
 */
import { createProviderRegistry } from "./registry.js";
import type { Workflow, WorkflowDefinition, RunOptions, StepImplementations, WorkflowResult } from "./types.js";
export { createProviderRegistry };
/**
 * Create a Workflow by combining a definition with implementations.
 * Validates the definition and that all step ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export declare function createWorkflow<TConfig>(definition: WorkflowDefinition, implementations: StepImplementations<TConfig>): Workflow<TConfig>;
/**
 * Execute a Workflow as a state machine (browser-safe version).
 *
 * Starts at workflow.definition.initial, executes each step, then follows
 * on: transitions to determine the next step. Stops when a transition
 * resolves to "end", there is no next step, or a critical step fails.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the implementation
 *   2. result.status        ("success" | "skipped" | "failed")
 *   3. "*"                  — wildcard default
 *   4. next                 — fallback for success/skipped
 */
export declare function runWorkflow<TConfig>(workflow: Workflow<TConfig>, config: TConfig, providers: ReturnType<typeof createProviderRegistry>, options?: RunOptions): Promise<WorkflowResult>;
//# sourceMappingURL=browser-runner.d.ts.map