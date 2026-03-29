import { ActionConfig } from "../config.js";
import { Providers } from "../providers/index.js";
export interface InvestigationResult {
    issuesFound: boolean;
    bestCandidate: boolean;
    recommendation: string;
    existingIssue: string;
    targetRepo: string;
    shouldImplement: boolean;
}
export declare function investigate(config: ActionConfig, providers: Providers): Promise<InvestigationResult>;
//# sourceMappingURL=investigate.d.ts.map