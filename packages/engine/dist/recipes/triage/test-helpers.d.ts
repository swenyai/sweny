import type { WorkflowContext, StepResult } from "../../types.js";
import { createProviderRegistry } from "../../runner-recipe.js";
import type { TriageConfig } from "./types.js";
export declare const silentLogger: {
    info: import("vitest").Mock<import("@vitest/spy").Procedure>;
    debug: import("vitest").Mock<import("@vitest/spy").Procedure>;
    warn: import("vitest").Mock<import("@vitest/spy").Procedure>;
    error: import("vitest").Mock<import("@vitest/spy").Procedure>;
};
export declare const defaultConfig: TriageConfig;
/** Create a mock WorkflowContext with sensible defaults. Override anything via params. */
export declare function createCtx(overrides?: {
    config?: Partial<TriageConfig>;
    results?: Map<string, StepResult>;
    providers?: ReturnType<typeof createProviderRegistry>;
}): WorkflowContext<TriageConfig>;
//# sourceMappingURL=test-helpers.d.ts.map