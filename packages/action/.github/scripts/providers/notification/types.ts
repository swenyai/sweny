/**
 * Notification Provider Contract
 *
 * Each notification provider is a standalone TypeScript CLI invoked by the workflow
 * to report triage results.
 *
 * Commands:
 *   summarize  — Create a summary of the triage run. Reads analysis files and outputs
 *                a human-readable report.
 *
 * Options:
 *   --recommendation <value>    — implement | +1 existing XYZ-123 | skip
 *   --issue-id <id>             — Issue tracker identifier (e.g., ENG-123)
 *   --issue-url <url>           — Issue tracker URL
 *   --pr-url <url>              — Pull request URL (if created)
 *   --target-repo <repo>        — Target repo for cross-repo dispatch
 *   --analysis-dir <path>       — Path to analysis artifacts directory
 *
 * The built-in `github-summary` provider writes to $GITHUB_STEP_SUMMARY.
 * Users could add providers for Slack, PagerDuty, email, etc.
 */

export interface SummaryOptions {
  recommendation: string;
  issueId?: string;
  issueUrl?: string;
  prUrl?: string;
  targetRepo?: string;
  analysisDir: string;
  serviceFilter: string;
  timeRange: string;
  dryRun: boolean;
  dispatchedFrom?: string;
}
