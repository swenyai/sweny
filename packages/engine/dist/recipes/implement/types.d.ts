/**
 * Configuration for the implement recipe.
 *
 * A focused workflow: given a known issue identifier, clone the repo,
 * implement a fix, and open a PR. No log investigation needed.
 */
export interface ImplementConfig {
    issueIdentifier: string;
    repository: string;
    dryRun: boolean;
    reviewMode?: "auto" | "review";
    maxImplementTurns: number;
    prDescriptionMaxTurns?: number;
    baseBranch?: string;
    prLabels?: string[];
    agentEnv: Record<string, string>;
    analysisDir?: string;
    projectId: string;
    stateInProgress: string;
    statePeerReview: string;
    issueTrackerName?: string;
}
//# sourceMappingURL=types.d.ts.map