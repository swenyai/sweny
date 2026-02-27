---
title: Issue Tracking
description: Create tickets, search for duplicates, and link PRs.
---

```typescript
import { linear, githubIssues, canLinkPr, canListTriageHistory } from "@sweny/providers/issue-tracking";
```

## Interface

```typescript
interface IssueTrackingProvider {
  verifyAccess(): Promise<void>;
  createIssue(opts: IssueCreateOptions): Promise<Issue>;
  getIssue(identifier: string): Promise<Issue>;
  updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void>;
  searchIssues(opts: IssueSearchOptions): Promise<Issue[]>;
  addComment(issueId: string, body: string): Promise<void>;
}
```

### Optional capabilities

```typescript
interface PrLinkCapable {
  linkPr(issueId: string, prUrl: string, prNumber: number): Promise<void>;
}

interface FingerprintCapable {
  searchByFingerprint(projectId: string, errorPattern: string): Promise<Issue[]>;
}

interface TriageHistoryCapable {
  listTriageHistory(projectId: string, labelId: string, days?: number): Promise<TriageHistoryEntry[]>;
}
```

Use type guards to check capabilities at runtime:

```typescript
if (canLinkPr(tracker)) {
  await tracker.linkPr(issue.id, prUrl, prNumber);
}
```

## Linear

```typescript
const tracker = linear({
  apiKey: process.env.LINEAR_API_KEY!,
  logger: myLogger,
});
```

Supports all optional capabilities: `PrLinkCapable`, `FingerprintCapable`, `TriageHistoryCapable`.

## GitHub Issues

```typescript
const tracker = githubIssues({
  token: process.env.GITHUB_TOKEN!,
  owner: "your-org",
  repo: "your-repo",
  logger: myLogger,
});
```

Supports `PrLinkCapable`.
