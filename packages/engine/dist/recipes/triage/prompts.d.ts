import type { ObservabilityProvider } from "@sweny-ai/providers/observability";
import type { TriageConfig } from "./types.js";
/** Issue link format for the PR footer — uses GitHub's magic "Closes" keyword when applicable. */
export declare function issueLink(name: string | undefined, identifier: string, url: string): string;
export declare function buildInvestigationPrompt(config: TriageConfig, observability: ObservabilityProvider, knownIssuesContent: string): string;
export declare function buildImplementPrompt(issueIdentifier: string, analysisDir?: string, issueTrackerName?: string): string;
export declare function buildPrDescriptionPrompt(issueIdentifier: string, issueUrl: string, analysisDir?: string, issueTrackerName?: string): string;
//# sourceMappingURL=prompts.d.ts.map