import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";
/** Build known-issues context from issue tracker + source control to prevent duplicates. */
export declare function buildContext(ctx: WorkflowContext<TriageConfig>): Promise<StepResult>;
//# sourceMappingURL=build-context.d.ts.map