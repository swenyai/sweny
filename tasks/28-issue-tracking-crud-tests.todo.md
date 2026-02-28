# Task 28: Issue Tracking CRUD Tests

## Goal
Add tests for untested CRUD operations on Linear and GitHub Issues providers: `getIssue`, `updateIssue`, `addComment`, and Linear-specific capabilities (`linkPr`, `searchByFingerprint`, `listTriageHistory`).

## Context
- Linear source: `packages/providers/src/issue-tracking/linear.ts`
- GitHub Issues source: `packages/providers/src/issue-tracking/github-issues.ts`
- Types: `packages/providers/src/issue-tracking/types.ts`
- Existing tests: `packages/providers/tests/issue-tracking.test.ts` (16 tests)
- Already tested: config validation, type guards, `verifyAccess`, `createIssue`, `searchIssues`
- Missing: `getIssue`, `updateIssue`, `addComment` for both providers, plus `linkPr`, `searchByFingerprint`, `listTriageHistory` for Linear

## Implementation
Add new describe blocks to `packages/providers/tests/issue-tracking.test.ts`.

Both providers use `globalThis.fetch` which is already mocked in the test file. Linear uses GraphQL (`https://api.linear.app/graphql`), GitHub Issues uses REST (`https://api.github.com/...`).

### Tests to add:

**Linear — getIssue:**
- Sends GraphQL query with identifier, returns Issue object

**Linear — updateIssue:**
- Sends GraphQL mutation with issueId and options (stateId, description)
- Handles comment option by calling addComment separately

**Linear — addComment:**
- Sends GraphQL mutation with issueId and body

**Linear — linkPr:**
- Sends mutation to attach PR URL and number to issue

**Linear — searchByFingerprint:**
- Queries issues filtered by labelId and error pattern
- Returns matching Issue array

**Linear — listTriageHistory:**
- Queries issues by projectId and labelId with date range
- Returns TriageHistoryEntry array

**GitHub Issues — getIssue:**
- Calls GET /repos/{owner}/{repo}/issues/{number}
- Returns Issue with # identifier format

**GitHub Issues — updateIssue:**
- Calls PATCH /repos/{owner}/{repo}/issues/{number}

**GitHub Issues — addComment:**
- Calls POST /repos/{owner}/{repo}/issues/{number}/comments

**GitHub Issues — linkPr:**
- Adds a comment with PR URL to the issue

The silent logger `{ info: () => {}, debug: () => {}, warn: () => {} }` is already defined in the test file.

## Verification
```bash
npm test --workspace=packages/providers -- --reporter=verbose tests/issue-tracking.test.ts
```

## Commit
```bash
git add packages/providers/tests/issue-tracking.test.ts
git commit -m "test: add issue-tracking CRUD tests (getIssue, updateIssue, addComment, linkPr, listTriageHistory)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
