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
/** Data from build-context step. */
export interface BuildContextData {
    knownIssuesContent: string;
}
/** Data from create-issue step. */
export interface IssueData {
    issueId: string;
    issueIdentifier: string;
    issueTitle: string;
    issueUrl: string;
    issueBranchName?: string;
}
/** Data from implement-fix step. */
export interface ImplementFixData {
    branchName: string;
    hasCodeChanges: boolean;
}
/** Data from create-pr step. */
export interface PrData {
    issueIdentifier: string;
    issueUrl: string;
    prUrl: string;
    prNumber: number;
}
/** Data from cross-repo-check step. */
export interface CrossRepoData {
    dispatched: boolean;
    targetRepo?: string;
}
/** Maps triage step names to their typed data output. */
export interface TriageStepDataMap {
    "build-context": BuildContextData;
    investigate: InvestigationResult;
    "create-issue": IssueData;
    "cross-repo-check": CrossRepoData;
    "implement-fix": ImplementFixData;
    "create-pr": PrData;
}
//# sourceMappingURL=types.d.ts.map