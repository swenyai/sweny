import type { Recipe } from "../../types.js";
import type { TriageConfig } from "./types.js";
/** The triage recipe — DAG with explicit on transitions. */
export declare const triageRecipe: Recipe<TriageConfig>;
export { triageRecipe as triageWorkflow };
export type { TriageConfig, InvestigationResult, ImplementResult, BuildContextData, IssueData, ImplementFixData, PrData, CrossRepoData, TriageStepDataMap, } from "./types.js";
export { getStepData } from "./results.js";
//# sourceMappingURL=index.d.ts.map