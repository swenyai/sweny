import type { MCPServerConfig } from "@sweny-ai/providers";

/**
 * Configuration for the implement recipe.
 *
 * A focused workflow: given a known issue identifier, clone the repo,
 * implement a fix, and open a PR. No log investigation needed.
 */
export interface ImplementConfig {
  // The issue to implement (exactly one required)
  issueIdentifier: string; // e.g., "ENG-123" or "github#42"

  // Source control context
  repository: string; // "owner/repo"

  // Behavior
  dryRun: boolean;
  reviewMode?: "auto" | "review";
  maxImplementTurns: number;
  prDescriptionMaxTurns?: number;

  // PR settings
  baseBranch?: string;
  prLabels?: string[];

  // Coding agent auth
  agentEnv: Record<string, string>;

  // Analysis directory for intermediate files
  analysisDir?: string;

  // Issue tracker config (needed to update issue state)
  projectId: string;
  stateInProgress: string;
  statePeerReview: string;

  // Issue tracker provider key (e.g. "linear", "github-issues") — used for prompt/template labels
  issueTrackerName?: string;

  /** MCP servers injected into the coding agent during implement-fix. */
  mcpServers?: Record<string, MCPServerConfig>;
}
