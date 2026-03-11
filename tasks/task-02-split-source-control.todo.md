# Task 02: Split SourceControlProvider → GitProvider + RepoProvider

## Context

`SourceControlProvider` currently mixes two fundamentally different concerns:
- **Local git shell operations** — run in the working directory (branch, commit, push, diff)
- **Remote API operations** — HTTP calls to GitHub/GitLab (create PR, list PRs, dispatch workflow)

This makes it impossible for remote contexts (cloud worker, MCP server, CI without checkout)
to implement only the API half. The split is the fix.

## New Interfaces (add to `packages/providers/src/source-control/types.ts`)

```typescript
/** Local git operations — requires a working directory with git initialized. */
export interface GitProvider {
  configureBotIdentity(): Promise<void>;
  createBranch(name: string): Promise<void>;
  pushBranch(name: string): Promise<void>;
  hasChanges(): Promise<boolean>;
  hasNewCommits(): Promise<boolean>;
  getChangedFiles(): Promise<string[]>;
  resetPaths(paths: string[]): Promise<void>;
  stageAndCommit(message: string): Promise<void>;
}

/** Remote repository API operations — no local filesystem required. */
export interface RepoProvider {
  verifyAccess(): Promise<void>;
  createPullRequest(opts: PrCreateOptions): Promise<PullRequest>;
  listPullRequests(opts?: PrListOptions): Promise<PullRequest[]>;
  findExistingPr(searchTerm: string): Promise<PullRequest | null>;
  dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<void>;
  enableAutoMerge?(prNumber: number): Promise<void>;
}

/**
 * Combined interface for providers that do both (GitHub, GitLab, file).
 * Kept as the standard registry key so existing steps don't break.
 */
export type SourceControlProvider = GitProvider & RepoProvider;
```

## Files to Change

### `packages/providers/src/source-control/types.ts`
- Add `GitProvider` interface (the 8 local git methods)
- Add `RepoProvider` interface (verifyAccess + PR/workflow methods)
- Change `SourceControlProvider` to `type SourceControlProvider = GitProvider & RepoProvider`
- Keep all existing option types (PrCreateOptions, PrListOptions, etc.) unchanged

### `packages/providers/src/source-control/index.ts`
- Export `GitProvider` and `RepoProvider` types alongside existing exports

### `packages/providers/src/source-control/github.ts`
- No behavior changes needed — it already implements all methods
- Add `implements GitProvider, RepoProvider` annotation if using classes
  (Note: it uses a factory function pattern, so TypeScript structural typing handles this)

### `packages/providers/src/source-control/gitlab.ts`
- Same — no behavior changes, structural typing already satisfied

### `packages/providers/src/source-control/file.ts`
- Same — no behavior changes needed

## What Does NOT Change

- Registry key stays `"sourceControl"` — steps still call `ctx.providers.get<SourceControlProvider>("sourceControl")`
- No step changes needed in this task (steps still use the combined interface)
- The split is additive — new types exported, existing type becomes an alias

## Verification

```bash
cd packages/providers
npm run typecheck   # must pass
npm test            # must pass (767 tests)
```

Check that `GitProvider` and `RepoProvider` are exported from the source-control subpath:
```typescript
import type { GitProvider, RepoProvider, SourceControlProvider } from "@sweny-ai/providers/source-control";
```

## Changeset

Create `.changeset/split-source-control-interfaces.md`:
```md
---
"@sweny-ai/providers": minor
---

Add `GitProvider` (local git ops) and `RepoProvider` (remote API ops) interfaces.
`SourceControlProvider` is now a type alias for `GitProvider & RepoProvider` — fully
backward compatible. Enables partial implementations for contexts without a local checkout.
```

## Commit Message
```
feat(providers): split SourceControlProvider into GitProvider + RepoProvider

Adds two focused interfaces for local git operations and remote API operations.
SourceControlProvider = GitProvider & RepoProvider for backward compatibility.
```
