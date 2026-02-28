import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";
/** Extract issue title from best-candidate.md, then get-or-create an issue in the tracker. */
export declare function createIssue(ctx: WorkflowContext<TriageConfig>): Promise<StepResult>;
//# sourceMappingURL=create-issue.d.ts.map