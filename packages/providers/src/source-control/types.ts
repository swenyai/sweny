export interface PullRequest {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  title: string;
  mergedAt?: string | null;
  closedAt?: string | null;
}

export interface PrCreateOptions {
  title: string;
  body: string;
  head: string;
  base?: string;
  labels?: string[];
}

export interface DispatchWorkflowOptions {
  targetRepo: string;
  workflow: string;
  inputs?: Record<string, string>;
}

export interface PrListOptions {
  state?: "open" | "closed" | "merged" | "all";
  labels?: string[];
  limit?: number;
}

export interface SourceControlProvider {
  verifyAccess(): Promise<void>;
  configureBotIdentity(): Promise<void>;
  createBranch(name: string): Promise<void>;
  pushBranch(name: string): Promise<void>;
  hasChanges(): Promise<boolean>;
  hasNewCommits(): Promise<boolean>;
  getChangedFiles(): Promise<string[]>;
  resetPaths(paths: string[]): Promise<void>;
  stageAndCommit(message: string): Promise<void>;
  createPullRequest(opts: PrCreateOptions): Promise<PullRequest>;
  listPullRequests(opts?: PrListOptions): Promise<PullRequest[]>;
  findExistingPr(searchTerm: string): Promise<PullRequest | null>;
  dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<void>;
}
