/** Configuration for the triage recipe. Provider-agnostic — no Linear/GitHub specifics. */
export interface TriageConfig {
    timeRange: string;
    severityFocus: string;
    serviceFilter: string;
    investigationDepth: string;
    maxInvestigateTurns: number;
    maxImplementTurns: number;
    serviceMapPath: string;
    projectId: string;
    bugLabelId: string;
    triageLabelId: string;
    stateBacklog: string;
    stateInProgress: string;
    statePeerReview: string;
    repository: string;
    dryRun: boolean;
    noveltyMode: boolean;
    issueOverride: string;
    additionalInstructions: string;
    agentEnv: Record<string, string>;
}
/** Result of the investigation (learn) phase. */
export interface InvestigationResult {
    issuesFound: boolean;
    bestCandidate: boolean;
    recommendation: string;
    existingIssue: string;
    targetRepo: string;
    shouldImplement: boolean;
}
/** Result of the implementation (act) phase. */
export interface ImplementResult {
    issueIdentifier: string;
    issueUrl: string;
    prUrl: string;
    prNumber: number;
    skipped: boolean;
    skipReason?: string;
}
//# sourceMappingURL=types.d.ts.map