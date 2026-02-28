import { createProviderRegistry } from "./registry.js";
import type { ProviderRegistry, RunOptions, Workflow, WorkflowResult } from "./types.js";
/**
 * Run a workflow end-to-end: learn → act → report.
 *
 * Steps execute in array order within their phase.
 * If a learn step fails, the workflow is aborted (status: "failed").
 * If an act or report step fails, remaining steps continue (status: "partial").
 */
export declare function runWorkflow<TConfig>(workflow: Workflow<TConfig>, config: TConfig, providers: ProviderRegistry, options?: RunOptions): Promise<WorkflowResult>;
/** Re-export for convenience. */
export { createProviderRegistry };
//# sourceMappingURL=runner.d.ts.map