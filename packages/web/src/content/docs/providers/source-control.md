---
title: Source Control
description: Create branches, push commits, open PRs, and dispatch workflows.
---

```typescript
import { github, gitlab } from "@swenyai/providers/source-control";
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

### Typical triage flow

```typescript
// Create a branch for the fix
await sc.createBranch("sweny/fix-webhook-null-pointer-1234");

// ... the agent writes the fix ...

// Check if anything was changed
if (await sc.hasChanges()) {
  await sc.stageAndCommit("fix: add null check for refund webhook payload");
  await sc.pushBranch("sweny/fix-webhook-null-pointer-1234");

  const pr = await sc.createPullRequest({
    title: "Fix null pointer in WebhookHandler for refund webhooks",
    body: "Closes ENG-456. Adds guard clause for undefined metadata on refund events.",
    head: "sweny/fix-webhook-null-pointer-1234",
    base: "main",
  });
  // pr.url → "https://github.com/org/repo/pull/89"
}
```

### Cross-repo dispatch

Trigger a workflow in another repository (requires a `bot-token` with `repo` and `actions` scopes):

```typescript
await sc.dispatchWorkflow({
  owner: "your-org",
  repo: "target-repo",
  workflow: "sweny-triage.yml",
  ref: "main",
  inputs: { service: "payment-api" },
});
```

## GitLab

```typescript
const sc = gitlab({
  token: process.env.GITLAB_TOKEN!,
  projectId: "my-group/my-project",
  baseUrl: "https://gitlab.com",  // optional
  baseBranch: "main",  // optional
  logger: myLogger,
});
```

Uses the GitLab REST API v4. Native `fetch` only.
