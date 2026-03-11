/** An issue from an issue tracking provider. */
export interface Issue {
  /** Provider-specific unique identifier. */
  id: string;
  /** Human-readable identifier (e.g., "PROJ-123"). */
  identifier: string;
  /** Issue title / summary. */
  title: string;
  /** Web URL to view the issue. */
  url: string;
  /**
   * Suggested git branch name derived from the issue.
   * Optional — not all trackers compute this (e.g. Jira, GitHub Issues derive a
   * fallback from the issue key/number). Recipe steps that create branches should
   * fall back to `identifier.toLowerCase().replace(/[^a-z0-9]+/g, "-")` if absent.
   */
  branchName?: string;
  /** Current workflow state (e.g., "open", "in progress", "done"). */
  state?: string;
  /** Full markdown description body. */
  description?: string;
}

/** Options for creating a new issue. */
export interface IssueCreateOptions {
  /** Issue title / summary. */
  title: string;
  /** Project or team identifier to create the issue in. */
  projectId: string;
  /** Markdown description body. */
  description?: string;
  /** Label IDs or names to attach. */
  labels?: string[];
  /** Priority level (provider-specific numeric scale). */
  priority?: number;
  /**
   * Initial workflow state ID.
   * Note: semantics differ per provider —
   *   Linear: UUID string
   *   Jira: status name (looked up via transitions API)
   *   GitHub Issues: "open" or "closed"
   */
  stateId?: string;
}

/** Options for updating an existing issue. */
export interface IssueUpdateOptions {
  /**
   * New workflow state ID.
   * Note: semantics differ per provider — see IssueCreateOptions.stateId.
   */
  stateId?: string;
  /** Updated markdown description. */
  description?: string;
  /** Comment to add to the issue. */
  comment?: string;
}

/** Options for searching issues. */
export interface IssueSearchOptions {
  /** Project or team identifier to search within. */
  projectId: string;
  /** Free-text search query. */
  query: string;
  /** Filter by label IDs or names. */
  labels?: string[];
  /** Filter by workflow state names. */
  states?: string[];
}

/**
 * A summary of an issue used for recent history context.
 * Returned by LabelHistoryCapable.searchIssuesByLabel().
 */
export interface IssueHistoryEntry {
  /** Human-readable issue identifier. */
  identifier: string;
  /** Issue title / summary. */
  title: string;
  /** Current workflow state name. */
  state: string;
  /** State category (e.g., "started", "completed", "cancelled"). */
  stateType: string;
  /** Web URL to view the issue. */
  url: string;
  /** Truncated description for quick comparison. */
  descriptionSnippet: string | null;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Labels attached to the issue. */
  labels: string[];
}

// ---------------------------------------------------------------------------
// Core interface — every issue tracking provider implements this
// ---------------------------------------------------------------------------

/** Core interface that every issue tracking provider must implement. */
export interface IssueTrackingProvider {
  /**
   * Verify that the provider credentials and connection are valid.
   * @returns Resolves if access is valid; rejects otherwise.
   */
  verifyAccess(): Promise<void>;

  /**
   * Create a new issue.
   * @param opts - Issue creation options.
   * @returns The newly created issue.
   */
  createIssue(opts: IssueCreateOptions): Promise<Issue>;

  /**
   * Retrieve an issue by its identifier.
   * @param identifier - Human-readable issue identifier (e.g., "PROJ-123").
   * @returns The matching issue.
   */
  getIssue(identifier: string): Promise<Issue>;

  /**
   * Update an existing issue.
   * @param issueId - Provider-specific issue ID.
   * @param opts - Fields to update.
   */
  updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void>;

  /**
   * Search for issues matching the given criteria.
   * @param opts - Search filters.
   * @returns Matching issues.
   */
  searchIssues(opts: IssueSearchOptions): Promise<Issue[]>;

  /**
   * Add a comment to an existing issue.
   * @param issueId - Provider-specific issue ID.
   * @param body - Comment body text (markdown).
   */
  addComment(issueId: string, body: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Optional capability interfaces
// ---------------------------------------------------------------------------

/** Capability for linking pull requests to issues. */
export interface PrLinkCapable {
  /**
   * Link a pull request to an issue.
   * @param issueId - Provider-specific issue ID.
   * @param prUrl - URL of the pull request.
   * @param prNumber - Pull request number.
   */
  linkPr(issueId: string, prUrl: string, prNumber: number): Promise<void>;
}

/**
 * Capability for retrieving recent issues filtered by label and date.
 * Used to provide historical context to recipe steps (e.g., dedup detection).
 */
export interface LabelHistoryCapable {
  /**
   * Search for issues with a specific label created within a recent time window.
   * @param projectId - Project or team identifier.
   * @param labelId - Label ID to filter by.
   * @param opts.days - Number of days of history to retrieve (default: 30).
   * @returns Recent issues matching the label filter.
   */
  searchIssuesByLabel(projectId: string, labelId: string, opts?: { days?: number }): Promise<IssueHistoryEntry[]>;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Type guard: checks whether the provider supports linking pull requests.
 * @param p - Issue tracking provider to check.
 * @returns True if the provider implements PrLinkCapable.
 */
export function canLinkPr(p: IssueTrackingProvider): p is IssueTrackingProvider & PrLinkCapable {
  return "linkPr" in p && typeof (p as Record<string, unknown>).linkPr === "function";
}

/**
 * Type guard: checks whether the provider supports label-filtered issue history.
 * @param p - Issue tracking provider to check.
 * @returns True if the provider implements LabelHistoryCapable.
 */
export function canSearchIssuesByLabel(p: IssueTrackingProvider): p is IssueTrackingProvider & LabelHistoryCapable {
  return "searchIssuesByLabel" in p && typeof (p as Record<string, unknown>).searchIssuesByLabel === "function";
}
