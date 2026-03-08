import type { StepResult, WorkflowContext } from "../types.js";
import type { SharedNodeConfig } from "./types.js";
/** Create branch, run Claude to implement fix, check for changes, and push. */
export declare function implementFix(ctx: WorkflowContext<SharedNodeConfig>): Promise<StepResult>;
//# sourceMappingURL=implement-fix.d.ts.map