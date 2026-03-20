import type { DedupStore } from "../../lib/dedup-store.js";
import type { MCPServerConfig } from "@sweny-ai/providers";
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
    /**
     * Extra labels applied to every agent-created issue (in addition to bugLabelId and triageLabelId).
     * Provider-agnostic: pass UUIDs for Linear, label names for GitHub Issues / Jira.
     * Use this to apply the compound "agent" marker label from the label system.
     */
    issueLabels?: string[];
    stateBacklog: string;
    stateInProgress: string;
    statePeerReview: string;
    repository: string;
    dryRun: boolean;
    /** Controls PR merge behavior after creation.
     *  - "auto"   — enable GitHub auto-merge (merges when CI passes)
     *  - "review" — open PR and wait for human approval (default)
     *  - "notify" — same as review, intended for notification integrations
     */
    reviewMode?: "auto" | "review";
    noveltyMode: boolean;
    issueOverride: string;
    additionalInstructions: string;
    /** Default branch for PR targets (default: "main"). */
    baseBranch?: string;
    /** Labels applied to created PRs (default: ["agent", "triage", "needs-review"]). */
    prLabels?: string[];
    /** Directory for triage analysis files (default: ".github/triage-analysis"). */
    analysisDir?: string;
    /** Max Claude turns for PR description generation (default: 10). */
    prDescriptionMaxTurns?: number;
    /** Default priority for new issues (default: 2). */
    issuePriority?: number;
    issueTrackerName?: string;
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
//# sourceMappingURL=types.d.ts.map