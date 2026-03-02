import type { ObservabilityProvider } from "@sweny-ai/providers/observability";
import type { TriageConfig } from "./types.js";
export declare function buildInvestigationPrompt(config: TriageConfig, observability: ObservabilityProvider, knownIssuesContent: string): string;
export declare function buildImplementPrompt(issueIdentifier: string, analysisDir?: string): string;
export declare function buildPrDescriptionPrompt(issueIdentifier: string, issueUrl: string, analysisDir?: string): string;
//# sourceMappingURL=prompts.d.ts.map