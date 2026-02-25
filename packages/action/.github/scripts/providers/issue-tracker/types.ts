/**
 * Issue Tracker Provider Contract
 *
 * Each issue tracker provider is a standalone TypeScript CLI invoked by the workflow.
 * The built-in implementation wraps the linear-cli commands.
 *
 * Commands:
 *   create-issue     — Create a new issue. Outputs KEY=VALUE pairs.
 *   update-issue     — Update an existing issue (state, description, comment).
 *   search-issues    — Search for issues matching a query. Outputs FOUND=true/false + details.
 *   get-issue        — Get issue details by identifier. Outputs KEY=VALUE pairs.
 *   link-pr          — Link a GitHub PR to an issue.
 *   add-occurrence   — Add a +1 occurrence comment to an existing issue.
 *   list-history     — List recent triage issues for dedup context.
 *   search-fingerprint — Search issues by error fingerprint in description.
 *
 * Output format: KEY=VALUE pairs (one per line) for easy parsing in GitHub Actions.
 *
 * Expected output keys for create-issue / get-issue:
 *   ISSUE_ID, ISSUE_IDENTIFIER, ISSUE_URL, ISSUE_BRANCH, ISSUE_TITLE
 *
 * Expected output keys for search-issues:
 *   FOUND (true/false), COUNT, ISSUE_ID, ISSUE_IDENTIFIER, ISSUE_URL, ISSUES_JSON
 */

export interface IssueCreateOptions {
  title: string;
  teamId: string;
  description?: string;
  labelIds?: string[];
  priority?: number;
  stateId?: string;
}

export interface IssueUpdateOptions {
  issueId: string;
  stateId?: string;
  description?: string;
  comment?: string;
}

export interface IssueSearchOptions {
  teamId: string;
  query: string;
  labelId?: string;
  states?: string[];
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName: string;
}
