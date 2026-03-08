import { createProviderRegistry } from "./registry.js";
import type { ProviderRegistry, RecipeDAG, RunOptions, WorkflowResult } from "./types.js";
/**
 * Execute a RecipeDAG as a state machine.
 *
 * Starts at dag.start, executes each node, then follows transitions to
 * determine the next node. Stops when a transition resolves to "end",
 * there is no next node, or a critical node fails.
 *
 * Outcome resolution order for transitions:
 *   1. result.data?.outcome (string) — explicit from the node
 *   2. result.status ("success" | "skipped" | "failed")
 */
export declare function runDAG<TConfig>(dag: RecipeDAG<TConfig>, config: TConfig, providers: ProviderRegistry, options?: RunOptions): Promise<WorkflowResult>;
export { createProviderRegistry };
//# sourceMappingURL=runner-dag.d.ts.map