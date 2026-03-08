/**
 * Minimal config interface required by shared nodes (implement-fix, create-pr, notify).
 * Both TriageConfig and ImplementConfig satisfy this interface.
 */
export interface SharedNodeConfig {
  repository: string;
  dryRun: boolean;
  maxImplementTurns: number;
  prDescriptionMaxTurns?: number;
  baseBranch?: string;
  prLabels?: string[];
  analysisDir?: string;
  agentEnv: Record<string, string>;
  projectId: string;
  stateInProgress: string;
  statePeerReview: string;
  // Optional triage-specific fields (undefined when running implement recipe)
  serviceFilter?: string;
  timeRange?: string;
  issueOverride?: string;
}
