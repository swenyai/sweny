---
title: Source Control
description: Create branches, push commits, open PRs, and dispatch workflows.
---

```typescript
import { github } from "@sweny/providers/source-control";
```

## Interface

```typescript
interface SourceControlProvider {
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
  findExistingPr(searchTerm: string): Promise<PullRequest | null>;
  dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<void>;
}
```

## GitHub

```typescript
const sc = github({
  token: process.env.GITHUB_TOKEN!,
  owner: "your-org",
  repo: "your-repo",
  baseBranch: "main",  // optional, defaults to "main"
  logger: myLogger,
});
```

Zero external dependencies. Uses `child_process.execFile("git", ...)` for local git operations and native `fetch` for the GitHub API.
