export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName: string;
  state?: string;
}

export interface IssueCreateOptions {
  title: string;
  teamId: string;
  description?: string;
  labelIds?: string[];
  priority?: number;
  stateId?: string;
}

export interface IssueSearchOptions {
  teamId: string;
  query: string;
  labelId?: string;
  states?: string[];
}

export interface TriageHistoryEntry {
  identifier: string;
  title: string;
  state: string;
  stateType: string;
  url: string;
  descriptionSnippet: string | null;
  fingerprint: string | null;
  createdAt: string;
  labels: string[];
}

export interface IssueTrackerProvider {
  verifyAccess(): Promise<void>;
  createIssue(opts: IssueCreateOptions): Promise<Issue>;
  updateIssue(
    issueId: string,
    opts: { stateId?: string; description?: string; comment?: string },
  ): Promise<void>;
  getIssue(identifier: string): Promise<Issue>;
  searchIssues(opts: IssueSearchOptions): Promise<Issue[]>;
  addOccurrence(issueId: string): Promise<void>;
  linkPr(issueId: string, prUrl: string, prNumber: number): Promise<void>;
  listTriageHistory(
    teamId: string,
    labelId: string,
    days?: number,
  ): Promise<TriageHistoryEntry[]>;
  searchByFingerprint(
    teamId: string,
    errorPattern: string,
    opts?: { labelId?: string; service?: string },
  ): Promise<Issue[]>;
}
