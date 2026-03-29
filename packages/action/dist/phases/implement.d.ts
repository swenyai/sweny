import { ActionConfig } from "../config.js";
import { Providers } from "../providers/index.js";
import { InvestigationResult } from "./investigate.js";
export interface ImplementResult {
    issueIdentifier: string;
    issueUrl: string;
    prUrl: string;
    prNumber: number;
    skipped: boolean;
    skipReason?: string;
}
export declare function implement(config: ActionConfig, providers: Providers, investigation: InvestigationResult): Promise<ImplementResult>;
//# sourceMappingURL=implement.d.ts.map