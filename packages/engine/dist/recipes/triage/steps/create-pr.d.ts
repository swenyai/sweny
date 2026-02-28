import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";
/** Generate PR description with Claude, create PR, link to issue, update issue state. */
export declare function createPr(ctx: WorkflowContext<TriageConfig>): Promise<StepResult>;
//# sourceMappingURL=create-pr.d.ts.map