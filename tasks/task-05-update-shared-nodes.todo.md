# Task 05: Update Shared Nodes to Use Split Interfaces

## Context

The shared nodes (implement-fix, create-pr) use `SourceControlProvider` for the combined
interface. After Task 02, `GitProvider` and `RepoProvider` are available as distinct types.

This task updates the nodes to be explicit about WHICH half of the interface they need.
This is primarily a type-clarity improvement — behavior doesn't change.

Depends on: Task 02 complete.

## Files to Change

### `packages/engine/src/nodes/implement-fix.ts`

This node needs: `configureBotIdentity`, `createBranch`, `pushBranch`, `hasChanges`,
`hasNewCommits`, `getChangedFiles`, `resetPaths`, `stageAndCommit`, `findExistingPr`

That's 8 git ops + 1 repo op. So it needs both interfaces.
Keep using `SourceControlProvider` (= `GitProvider & RepoProvider`) for now — no change needed.

HOWEVER: update the import to also import `GitProvider` so it's explicit in the comment
that git ops and repo ops are conceptually separate here. This helps future readers.

```typescript
// Note: implement-fix needs both GitProvider (local ops) and RepoProvider (findExistingPr)
// Future: split into separate registry keys when cloud/remote contexts need support
import type { SourceControlProvider } from "@sweny-ai/providers/source-control";
```

### `packages/engine/src/nodes/create-pr.ts`

This node calls: `createPullRequest`, `listPullRequests` (via risk assessor — actually
`getChangedFiles`), `enableAutoMerge?`, `findExistingPr` (not called here — checked above)

Actually looking more carefully at create-pr.ts:
- `sourceControl.createPullRequest(...)` → RepoProvider
- `sourceControl.getChangedFiles()` → GitProvider
- `sourceControl.enableAutoMerge?.(...)` → RepoProvider

So create-pr also needs both halves. Keep `SourceControlProvider` for now.

### `packages/engine/src/recipes/triage/steps/cross-repo-check.ts`

This only calls `sourceControl.dispatchWorkflow(...)` → RepoProvider only.

**Update this one**: type hint to `RepoProvider` since that's all it needs:
```typescript
import type { RepoProvider } from "@sweny-ai/providers/source-control";
const sourceControl = ctx.providers.get<RepoProvider>("sourceControl");
```

### `packages/engine/src/recipes/implement/steps/verify-access.ts`

This only calls `sourceControl.verifyAccess()` → RepoProvider only.

**Update this one**: type hint to `RepoProvider`:
```typescript
import type { RepoProvider } from "@sweny-ai/providers/source-control";
const sourceControl = ctx.providers.get<RepoProvider>("sourceControl");
```

## Why This Matters

By narrowing the type where possible, we document intent: "this step only needs the
remote API half, not a local git checkout." Future implementers building a remote
context (cloud job, MCP-backed) know exactly what they need to satisfy.

## Verification

```bash
cd packages/engine
npm run typecheck   # must pass
npm test            # must pass
```

## Changeset

Create `.changeset/narrow-step-provider-types.md`:
```md
---
"@sweny-ai/engine": patch
---

Narrowed provider type hints in cross-repo-check and implement verify-access steps
to use `RepoProvider` instead of the full `SourceControlProvider` where only remote
API operations are needed.
```

## Commit Message
```
refactor(engine): narrow provider type hints in steps to GitProvider/RepoProvider

cross-repo-check and implement/verify-access only need RepoProvider.
Documents which steps require local git access vs. remote API access.
```
