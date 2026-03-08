import type { StepResult, WorkflowContext } from "../types.js";
import type { SharedNodeConfig } from "./types.js";
/** Generate PR description with Claude, create PR, link to issue, update issue state. */
export declare function createPr(ctx: WorkflowContext<SharedNodeConfig>): Promise<StepResult>;
//# sourceMappingURL=create-pr.d.ts.map