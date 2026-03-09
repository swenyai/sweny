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
  /** Triage-specific: optional in implement context (undefined → omitted from notification). */
  serviceFilter?: string;
  /** Triage-specific: optional in implement context (undefined → omitted from notification). */
  timeRange?: string;
  /** Triage-specific: if set, skip duplicate-PR check for merged PRs. */
  issueOverride?: string;
  /** Issue tracker provider key (e.g. "linear", "github-issues", "jira") — used for dynamic prompt/template labels. */
  issueTrackerName?: string;
  /** Controls PR merge behavior. "auto" enables GitHub auto-merge after CI. */
  reviewMode?: "auto" | "review";
}
