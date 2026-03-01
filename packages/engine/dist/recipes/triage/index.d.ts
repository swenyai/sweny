import type { Workflow } from "../../types.js";
import type { TriageConfig } from "./types.js";
/** The triage recipe — first workflow on the SWEny platform. */
export declare const triageWorkflow: Workflow<TriageConfig>;
export type { TriageConfig, InvestigationResult, ImplementResult, BuildContextData, IssueData, ImplementFixData, PrData, CrossRepoData, TriageStepDataMap, } from "./types.js";
export { getStepData } from "./results.js";
//# sourceMappingURL=index.d.ts.map