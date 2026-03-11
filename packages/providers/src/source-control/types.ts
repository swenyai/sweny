/** A pull request from a source control provider. */
export interface PullRequest {
  /** Pull request number. */
  number: number;
  /** Web URL to view the pull request. */
  url: string;
  /** Current pull request state. */
  state: "open" | "merged" | "closed";
  /** Pull request title. */
  title: string;
  /** ISO 8601 timestamp when the PR was merged, or null. */
  mergedAt?: string | null;
  /** ISO 8601 timestamp when the PR was closed, or null. */
  closedAt?: string | null;
}

/** Options for creating a new pull request. */
export interface PrCreateOptions {
  /** Pull request title. */
  title: string;
  /** Pull request description body (markdown). */
  body: string;
  /** Source branch name. */
  head: string;
  /** Target branch name (defaults to repository default branch). */
  base?: string;
  /** Labels to attach to the pull request. */
  labels?: string[];
}

/** Options for dispatching a remote workflow (e.g., GitHub Actions). */
export interface DispatchWorkflowOptions {
  /** Full repository reference (e.g., "owner/repo"). */
  targetRepo: string;
  /** Workflow filename or ID to dispatch. */
  workflow: string;
  /** Key-value inputs to pass to the workflow. */
  inputs?: Record<string, string>;
}

/** Options for listing pull requests. */
export interface PrListOptions {
  /** Filter by pull request state. */
  state?: "open" | "closed" | "merged" | "all";
  /** Filter by labels. */
  labels?: string[];
  /** Maximum number of results to return. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Split interfaces
// ---------------------------------------------------------------------------

/**
 * Local git operations — requires a working directory with git initialized.
 *
 * These methods run shell commands (`git checkout`, `git commit`, `git push`, etc.)
 * in the current working directory. They cannot be satisfied by a remote process
 * or MCP server. Any recipe step that needs these must run in a context with a
 * local git checkout.
 */
export interface GitProvider {
  /** Configure the git bot identity (name and email) for automated commits. */
  configureBotIdentity(): Promise<void>;

  /**
   * Create a new local branch.
   * @param name - Branch name to create.
   */
  createBranch(name: string): Promise<void>;

  /**
   * Push a local branch to the remote repository.
   * @param name - Branch name to push.
   */
  pushBranch(name: string): Promise<void>;

  /**
   * Check whether there are uncommitted changes in the working tree.
   * @returns True if there are uncommitted changes.
   */
  hasChanges(): Promise<boolean>;

  /**
   * Check whether there are unpushed commits on the current branch.
   * @returns True if there are new commits not yet pushed.
   */
  hasNewCommits(): Promise<boolean>;

  /**
   * Get the list of files changed relative to the base branch.
   * @returns Array of changed file paths.
   */
  getChangedFiles(): Promise<string[]>;

  /**
   * Reset (discard) changes for the specified paths.
   * @param paths - File paths to reset.
   */
  resetPaths(paths: string[]): Promise<void>;

  /**
   * Stage all changes and create a commit.
   * @param message - Commit message.
   */
  stageAndCommit(message: string): Promise<void>;
}

/**
 * Remote repository API operations — no local filesystem required.
 *
 * These methods call the hosting provider's HTTP API (GitHub, GitLab, etc.)
 * and can be satisfied by a remote process, cloud worker, or MCP server.
 */
export interface RepoProvider {
  /**
   * Verify that the provider credentials and connection are valid.
   * @returns Resolves if access is valid; rejects otherwise.
   */
  verifyAccess(): Promise<void>;

  /**
   * Create a new pull request.
   * @param opts - Pull request creation options.
   * @returns The newly created pull request.
   */
  createPullRequest(opts: PrCreateOptions): Promise<PullRequest>;

  /**
   * List pull requests matching the given filters.
   * @param opts - Optional list filters.
   * @returns Matching pull requests.
   */
  listPullRequests(opts?: PrListOptions): Promise<PullRequest[]>;

  /**
   * Find an existing pull request by a search term.
   * @param searchTerm - Term to search for (e.g., branch name or title substring).
   * @returns The matching pull request, or null if not found.
   */
  findExistingPr(searchTerm: string): Promise<PullRequest | null>;

  /**
   * Dispatch a remote workflow.
   * @param opts - Workflow dispatch options.
   */
  dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<void>;

  /**
   * Enable auto-merge on the given pull request number.
   * The PR merges automatically once all required status checks pass.
   * Optional — providers that do not support auto-merge can omit this.
   */
  enableAutoMerge?(prNumber: number): Promise<void>;
}

/**
 * Combined interface for providers that handle both local git operations and
 * remote API calls (GitHub, GitLab, file-based implementations).
 *
 * This is the standard registry key `"sourceControl"` — existing recipe steps
 * that need both halves continue to use this type unchanged.
 *
 * Steps that only need remote API operations should type-hint to `RepoProvider`.
 * Steps that only need local git operations should type-hint to `GitProvider`.
 */
export type SourceControlProvider = GitProvider & RepoProvider;
