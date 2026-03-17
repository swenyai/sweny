---
title: Issue Tracking
description: Create tickets, search for duplicates, and link PRs.
---

```typescript
import { linear, githubIssues, jira, fileIssueTracking, canLinkPr, canSearchIssuesByLabel } from "@sweny-ai/providers/issue-tracking";
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

interface LabelHistoryCapable {
  searchIssuesByLabel(projectId: string, labelId: string, since?: Date): Promise<Issue[]>;
}
```

Use type guards to check capabilities at runtime:

```typescript
if (canLinkPr(tracker)) {
  await tracker.linkPr(issue.id, prUrl, prNumber);
}

if (canSearchIssuesByLabel(tracker)) {
  const recent = await tracker.searchIssuesByLabel(projectId, triageLabelId);
}
```

## Linear

```typescript
const tracker = linear({
  apiKey: process.env.LINEAR_API_KEY!,
  logger: myLogger,
});
```

Supports both optional capabilities: `PrLinkCapable`, `LabelHistoryCapable`.

### Creating an issue

```typescript
const issue = await tracker.createIssue({
  title: "NullPointerException in WebhookHandler.process()",
  description: "312 occurrences in the last 24h. Root cause: missing null check on refund payload.",
  projectId: "TEAM-UUID",
  labels: ["bug-label-uuid", "triage-label-uuid"],
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

Supports both optional capabilities: `PrLinkCapable`, `LabelHistoryCapable`. Uses the Jira REST API v3. Native `fetch` only.

## File (testing)

Writes issues to local JSON files — no credentials, no network. Ideal for unit tests, CI workflows, and offline environments.

```typescript
const tracker = fileIssueTracking({ outputDir: "/tmp/sweny-test" });
await tracker.verifyAccess(); // initialises the output directory

const issue = await tracker.createIssue({ title: "Test issue", projectId: "LOCAL" });
// issue.identifier → "LOCAL-1"
// issue.url → "file:///tmp/sweny-test/LOCAL-1.md"
```

Call `verifyAccess()` before `createIssue()` to ensure the output directory is initialised. Returned identifiers follow the pattern `LOCAL-N`. Does not implement `PrLinkCapable` or `LabelHistoryCapable`.
