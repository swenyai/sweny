---
title: Issue Tracking
description: Create tickets, search for duplicates, and link PRs.
---

```typescript
import { linear, githubIssues, jira, canLinkPr, canListTriageHistory } from "@swenyai/providers/issue-tracking";
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

### Creating an issue

```typescript
const issue = await tracker.createIssue({
  title: "NullPointerException in WebhookHandler.process()",
  description: "312 occurrences in the last 24h. Root cause: missing null check on refund payload.",
  teamId: "TEAM-UUID",
  labelIds: ["bug-label-uuid", "triage-label-uuid"],
  priority: 2,  // High
});
// issue.identifier → "ENG-456"
// issue.url → "https://linear.app/team/issue/ENG-456"
```

### Searching for duplicates

```typescript
const existing = await tracker.searchIssues({
  query: "NullPointerException WebhookHandler",
  projectId: "TEAM-UUID",
});
// Returns matching issues — SWEny uses this for duplicate detection
```

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

## Jira

```typescript
const tracker = jira({
  baseUrl: "https://mycompany.atlassian.net",
  email: "bot@mycompany.com",
  apiToken: process.env.JIRA_API_TOKEN!,
  logger: myLogger,
});
```

Supports `PrLinkCapable`. Uses the Jira REST API v3. Native `fetch` only.
