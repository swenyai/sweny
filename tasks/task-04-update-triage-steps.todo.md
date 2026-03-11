# Task 04: Update Engine Steps for Renamed Interfaces

## Context

After Task 03, the engine steps that import the old names will have TypeScript errors.
This task updates the one call site for `listTriageHistory` and cleans up any dead imports.

Depends on: Task 03 complete.

## Files to Change

### `packages/engine/src/recipes/triage/steps/build-context.ts`

Current:
```typescript
import { canListTriageHistory } from "@sweny-ai/providers/issue-tracking";
import type { IssueTrackingProvider, TriageHistoryCapable } from "@sweny-ai/providers/issue-tracking";

if (canListTriageHistory(issueTracker)) {
  const triageHistory = await (issueTracker as IssueTrackingProvider & TriageHistoryCapable)
    .listTriageHistory(config.projectId, config.triageLabelId, 30);
```

After:
```typescript
import { canSearchIssuesByLabel } from "@sweny-ai/providers/issue-tracking";
import type { IssueTrackingProvider, LabelHistoryCapable } from "@sweny-ai/providers/issue-tracking";

if (canSearchIssuesByLabel(issueTracker)) {
  const history = await (issueTracker as IssueTrackingProvider & LabelHistoryCapable)
    .searchIssuesByLabel(config.projectId, config.triageLabelId, { days: 30 });
```

Update the loop that consumes the result — field names on `IssueHistoryEntry` are the same
as `TriageHistoryEntry` except `fingerprint` is removed. The loop only uses `identifier`,
`state`, `title`, `url` — no changes needed there.

### `packages/engine/src/recipes/triage/steps/build-context.test.ts`

Update mock:
```typescript
// BEFORE
listTriageHistory: vi.fn().mockResolvedValue([...])
// AFTER
searchIssuesByLabel: vi.fn().mockResolvedValue([...])
```

Update assertions:
```typescript
// BEFORE
expect(issueTracker.listTriageHistory).toHaveBeenCalledWith("proj-1", "label-triage", 30);
// AFTER
expect(issueTracker.searchIssuesByLabel).toHaveBeenCalledWith("proj-1", "label-triage", { days: 30 });
```

### `packages/engine/src/recipes/triage/integration.test.ts`

Find mock that has `listTriageHistory` → rename to `searchIssuesByLabel`.

## Verification

```bash
cd packages/engine
npm run typecheck   # must pass
npm test            # must pass
```

Specifically check that build-context tests still pass and the integration test passes.

## Changeset

Create `.changeset/update-triage-steps-renamed-interfaces.md`:
```md
---
"@sweny-ai/engine": minor
---

Updated triage build-context step to use renamed provider interfaces:
`canListTriageHistory` → `canSearchIssuesByLabel`, `listTriageHistory` → `searchIssuesByLabel`.
```

## Commit Message
```
fix(engine): update triage steps for renamed issue-tracking interfaces

canListTriageHistory → canSearchIssuesByLabel
listTriageHistory → searchIssuesByLabel
```
