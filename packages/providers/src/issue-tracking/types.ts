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
  /** Suggested git branch name derived from the issue. */
  branchName: string;
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
  /** Initial workflow state ID. */
  stateId?: string;
}

/** Options for updating an existing issue. */
export interface IssueUpdateOptions {
  /** New workflow state ID. */
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

/** A historical triage entry used for duplicate/pattern detection. */
export interface TriageHistoryEntry {
  /** Human-readable issue identifier. */
  identifier: string;
  /** Issue title / summary. */
  title: string;
  /** Current workflow state name. */
  state: string;
  /** State category (e.g., "triage", "started", "completed", "cancelled"). */
  stateType: string;
  /** Web URL to view the issue. */
  url: string;
  /** Truncated description for quick comparison. */
  descriptionSnippet: string | null;
  /** Error fingerprint hash for deduplication. */
  fingerprint: string | null;
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

/** Capability for searching issues by error fingerprint. */
export interface FingerprintCapable {
  /**
   * Search for existing issues matching an error fingerprint pattern.
   * @param projectId - Project or team identifier.
   * @param errorPattern - Error pattern string to fingerprint-match against.
   * @param opts - Optional filters (label, service).
   * @returns Issues matching the fingerprint.
   */
  searchByFingerprint(
    projectId: string,
    errorPattern: string,
    opts?: { labelId?: string; service?: string },
  ): Promise<Issue[]>;
}

/** Capability for listing historical triage entries. */
export interface TriageHistoryCapable {
  /**
   * List triage history entries for a project and label.
   * @param projectId - Project or team identifier.
   * @param labelId - Label ID to filter by.
   * @param days - Number of days of history to retrieve (default: provider-specific).
   * @returns Historical triage entries.
   */
  listTriageHistory(projectId: string, labelId: string, days?: number): Promise<TriageHistoryEntry[]>;
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
 * Type guard: checks whether the provider supports fingerprint search.
 * @param p - Issue tracking provider to check.
 * @returns True if the provider implements FingerprintCapable.
 */
export function canSearchByFingerprint(p: IssueTrackingProvider): p is IssueTrackingProvider & FingerprintCapable {
  return "searchByFingerprint" in p && typeof (p as Record<string, unknown>).searchByFingerprint === "function";
}

/**
 * Type guard: checks whether the provider supports triage history listing.
 * @param p - Issue tracking provider to check.
 * @returns True if the provider implements TriageHistoryCapable.
 */
export function canListTriageHistory(p: IssueTrackingProvider): p is IssueTrackingProvider & TriageHistoryCapable {
  return "listTriageHistory" in p && typeof (p as Record<string, unknown>).listTriageHistory === "function";
}
