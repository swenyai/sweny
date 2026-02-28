import type { ObservabilityProvider } from "@sweny/providers/observability";
import type { TriageConfig } from "./types.js";
export declare function buildInvestigationPrompt(config: TriageConfig, observability: ObservabilityProvider, knownIssuesContent: string): string;
export declare function buildImplementPrompt(issueIdentifier: string): string;
export declare function buildPrDescriptionPrompt(issueIdentifier: string, issueUrl: string): string;
//# sourceMappingURL=prompts.d.ts.map