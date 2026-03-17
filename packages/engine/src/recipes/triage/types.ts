import type { DedupStore } from "../../lib/dedup-store.js";
import type { MCPServerConfig } from "@sweny-ai/providers";

/** Configuration for the triage recipe. Provider-agnostic — no Linear/GitHub specifics. */
export interface TriageConfig {
  // Investigation parameters
  timeRange: string;
  severityFocus: string;
  serviceFilter: string;
  investigationDepth: string;
  maxInvestigateTurns: number;
  maxImplementTurns: number;
  serviceMapPath: string;

  // Issue tracker settings (generic — maps to Linear team, Jira project, etc.)
  projectId: string;
  bugLabelId: string;
  triageLabelId: string;
  stateBacklog: string;
  stateInProgress: string;
  statePeerReview: string;

  // Source control context
  repository: string; // "owner/repo"

  // Behavior
  dryRun: boolean;
  /** Controls PR merge behavior after creation.
   *  - "auto"   — enable GitHub auto-merge (merges when CI passes)
   *  - "review" — open PR and wait for human approval (default)
   *  - "notify" — same as review, intended for notification integrations
   */
  reviewMode?: "auto" | "review";
  noveltyMode: boolean;
  issueOverride: string; // specific issue identifier to work on
  additionalInstructions: string;

  // PR / branch settings
  /** Default branch for PR targets (default: "main"). */
  baseBranch?: string;
  /** Labels applied to created PRs (default: ["agent", "triage", "needs-review"]). */
  prLabels?: string[];

  // Directories and limits
  /** Directory for triage analysis files (default: ".github/triage-analysis"). */
  analysisDir?: string;
  /** Max Claude turns for PR description generation (default: 10). */
  prDescriptionMaxTurns?: number;
  /** Default priority for new issues (default: 2). */
  issuePriority?: number;

  // Issue tracker display name for prompts and templates (e.g. "linear", "github-issues", "jira", "file")
  issueTrackerName?: string;

  // Coding agent auth (passed through as env vars)
  agentEnv: Record<string, string>;

  /**
   * MCP servers injected into the coding agent for investigate and implement-fix steps.
   * The agent receives all configured tools during its reasoning session.
   */
  mcpServers?: Record<string, MCPServerConfig>;

  /**
   * Optional dedup store for deterministic idempotency.
   *
   * When provided, triage short-circuits before any LLM invocation if the
   * incoming event fingerprint was already processed within the TTL window.
   * Use `inMemoryDedupStore()` for single-process deployments, or provide a
   * Redis-backed implementation for multi-process cloud workers.
   */
  dedupStore?: DedupStore;
}

/** Result of the investigation (learn) phase. */
export interface InvestigationResult {
  issuesFound: boolean;
  bestCandidate: boolean;
  recommendation: string; // "implement" | "+1 existing ENG-XXX" | "skip"
  existingIssue: string; // e.g., "ENG-123" from +1 recommendation
  targetRepo: string; // e.g., "org/repo" for cross-repo dispatch
  shouldImplement: boolean; // recommendation starts with "implement"
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

// ---------------------------------------------------------------------------
// Step data interfaces — typed outputs for inter-step communication
// ---------------------------------------------------------------------------

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
  outcome: "local" | "dispatched" | "dispatch-failed";
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
