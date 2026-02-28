import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";
/** If the bug belongs to a different repo, dispatch the workflow there and skip remaining act steps. */
export declare function crossRepoCheck(ctx: WorkflowContext<TriageConfig>): Promise<StepResult>;
//# sourceMappingURL=cross-repo-check.d.ts.map