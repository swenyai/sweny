export interface PullRequest {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  title: string;
}

export interface PrCreateOptions {
  title: string;
  body: string;
  head: string;
  base?: string;
  labels?: string[];
}

export interface SourceControlProvider {
  verifyAccess(): Promise<void>;
  configureBotIdentity(): Promise<void>;
  createBranch(name: string): Promise<void>;
  pushBranch(name: string): Promise<void>;
  hasChanges(): Promise<boolean>;
  stageAndCommit(message: string): Promise<void>;
  createPullRequest(opts: PrCreateOptions): Promise<PullRequest>;
  findExistingPr(searchTerm: string): Promise<PullRequest | null>;
}
