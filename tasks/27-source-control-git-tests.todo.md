# Task 27: Source Control Git Operation Tests

## Goal
Add tests for the untested git operations in the GitHub source-control provider: `configureBotIdentity`, `createBranch`, `pushBranch`, `hasChanges`, `resetPaths`, `stageAndCommit`.

## Context
- Source file: `packages/providers/src/source-control/github.ts`
- Existing tests: `packages/providers/tests/source-control.test.ts` (19 tests)
- Already tested: `verifyAccess`, `createPullRequest`, `findExistingPr`, `hasNewCommits`, `getChangedFiles`, `listPullRequests`, `dispatchWorkflow`
- Missing: `configureBotIdentity`, `createBranch`, `pushBranch`, `hasChanges`, `resetPaths`, `stageAndCommit`

## Implementation
Add new describe blocks to `packages/providers/tests/source-control.test.ts` for each missing method.

The test file already mocks `node:child_process` with `execFile` and global `fetch`. Use the same patterns:
- `mockExecFile.mockImplementationOnce(...)` for git commands
- Each git operation calls `execFileAsync("git", [...args])` under the hood

### Tests to add:

**configureBotIdentity:**
- Calls `git config user.name` and `git config user.email`
- Logs debug message

**createBranch:**
- Calls `git checkout -b <name>`
- Logs info with branch name

**pushBranch:**
- Calls `git remote set-url origin` with token URL
- Calls `git push origin <name>`

**hasChanges:**
- Returns true when unstaged changes exist
- Returns true when staged changes exist
- Returns false when no changes

**resetPaths:**
- Calls `git checkout HEAD -- <path>` for each path
- Handles multiple paths

**stageAndCommit:**
- Calls `git add -A` then `git commit -m <message>`

## Verification
```bash
npm test --workspace=packages/providers -- --reporter=verbose tests/source-control.test.ts
```

## Commit
```bash
git add packages/providers/tests/source-control.test.ts
git commit -m "test: add source-control git operation tests (configureBotIdentity, createBranch, pushBranch, hasChanges, resetPaths, stageAndCommit)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
