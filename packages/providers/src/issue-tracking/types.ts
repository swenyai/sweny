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
  projectId: string;
  description?: string;
  labels?: string[];
  priority?: number;
  stateId?: string;
}

export interface IssueUpdateOptions {
  stateId?: string;
  description?: string;
  comment?: string;
}

export interface IssueSearchOptions {
  projectId: string;
  query: string;
  labels?: string[];
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

// ---------------------------------------------------------------------------
// Core interface — every issue tracking provider implements this
// ---------------------------------------------------------------------------

export interface IssueTrackingProvider {
  verifyAccess(): Promise<void>;
  createIssue(opts: IssueCreateOptions): Promise<Issue>;
  getIssue(identifier: string): Promise<Issue>;
  updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void>;
  searchIssues(opts: IssueSearchOptions): Promise<Issue[]>;
  addComment(issueId: string, body: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Optional capability interfaces
// ---------------------------------------------------------------------------

export interface PrLinkCapable {
  linkPr(issueId: string, prUrl: string, prNumber: number): Promise<void>;
}

export interface FingerprintCapable {
  searchByFingerprint(
    projectId: string,
    errorPattern: string,
    opts?: { labelId?: string; service?: string },
  ): Promise<Issue[]>;
}

export interface TriageHistoryCapable {
  listTriageHistory(projectId: string, labelId: string, days?: number): Promise<TriageHistoryEntry[]>;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function canLinkPr(p: IssueTrackingProvider): p is IssueTrackingProvider & PrLinkCapable {
  return "linkPr" in p && typeof (p as Record<string, unknown>).linkPr === "function";
}

export function canSearchByFingerprint(p: IssueTrackingProvider): p is IssueTrackingProvider & FingerprintCapable {
  return "searchByFingerprint" in p && typeof (p as Record<string, unknown>).searchByFingerprint === "function";
}

export function canListTriageHistory(p: IssueTrackingProvider): p is IssueTrackingProvider & TriageHistoryCapable {
  return "listTriageHistory" in p && typeof (p as Record<string, unknown>).listTriageHistory === "function";
}
