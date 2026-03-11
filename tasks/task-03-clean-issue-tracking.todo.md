# Task 03: Clean IssueTrackingProvider — Rename Triage-Specific Names, Remove Dead Code

## Context

Three problems in `packages/providers/src/issue-tracking/types.ts`:

1. `TriageHistoryCapable` / `listTriageHistory` — valid capability, bad name ("triage" in a generic interface)
2. `FingerprintCapable` / `searchByFingerprint` — implemented in linear.ts and jira.ts, exported,
   documented, but **never called from any recipe step**. Dead code.
3. `Issue.branchName` — required field, but Jira fakes it as `fix/${key}` and GitHub Issues as
   `fix/${number}`. Engine already has a fallback for missing branchName in implement-fix.ts.

## Changes Required

### `packages/providers/src/issue-tracking/types.ts`

**Rename:**
```typescript
// BEFORE
export interface TriageHistoryCapable {
  listTriageHistory(projectId: string, labelId: string, days?: number): Promise<TriageHistoryEntry[]>;
}
export interface TriageHistoryEntry { ... }
export function canListTriageHistory(...) { ... }

// AFTER
export interface LabelHistoryCapable {
  searchIssuesByLabel(projectId: string, labelId: string, opts?: { days?: number }): Promise<IssueHistoryEntry[]>;
}
export interface IssueHistoryEntry {
  identifier: string;
  title: string;
  state: string;
  stateType: string;
  url: string;
  descriptionSnippet: string | null;
  // NOTE: 'fingerprint' field removed — was null in Jira, never used anywhere
  createdAt: string;
  labels: string[];
}
export function canSearchIssuesByLabel(p: IssueTrackingProvider): p is IssueTrackingProvider & LabelHistoryCapable {
  return "searchIssuesByLabel" in p && typeof (p as Record<string, unknown>).searchIssuesByLabel === "function";
}
```

**Remove entirely:**
```typescript
// DELETE these:
export interface FingerprintCapable { ... }
export function canSearchByFingerprint(...) { ... }
```

**Fix branchName:**
```typescript
// BEFORE
export interface Issue {
  branchName: string;  // required
  ...
}

// AFTER
export interface Issue {
  branchName?: string;  // optional — not all trackers provide this
  ...
}
```

### `packages/providers/src/issue-tracking/linear.ts`

- Rename `listTriageHistory` method to `searchIssuesByLabel`
- Update method signature: `(projectId, labelId, opts?: { days?: number })` instead of `(projectId, labelId, days?)`
- Update class `implements` declaration: `IssueTrackingProvider & PrLinkCapable & LabelHistoryCapable`
  (remove `FingerprintCapable & TriageHistoryCapable`)
- Remove `searchByFingerprint` method body
- `branchName` field already returned from API — no change needed

### `packages/providers/src/issue-tracking/jira.ts`

- Rename `listTriageHistory` to `searchIssuesByLabel`, update signature
- Update class `implements` declaration: remove `FingerprintCapable & TriageHistoryCapable`, add `LabelHistoryCapable`
- Remove `searchByFingerprint` method body
- `branchName: fix/${result.key}` stays as-is (now optional, still provided)

### `packages/providers/src/issue-tracking/github-issues.ts`

- No `listTriageHistory` or `searchByFingerprint` to rename/remove
- `branchName: fix/${result.number}` stays as-is (now optional, still provided)
- Class `implements` stays `IssueTrackingProvider & PrLinkCapable`

### `packages/providers/src/issue-tracking/file.ts`

- Check if it implements any of the removed capabilities → remove if so

### `packages/providers/src/issue-tracking/index.ts`

- Export `LabelHistoryCapable`, `IssueHistoryEntry`, `canSearchIssuesByLabel`
- Remove exports of `FingerprintCapable`, `TriageHistoryCapable`, `TriageHistoryEntry`,
  `canSearchByFingerprint`, `canListTriageHistory`
- Keep backward compat: add `export { canSearchIssuesByLabel as canListTriageHistory }` temporarily?
  NO — just remove them. The only call site is in the engine (updated in Task 04).

## Verification

After changes:
```bash
cd packages/providers
npm run typecheck   # must pass
npm test            # must pass — update any test mocks that use old names
```

Search for tests that mock `listTriageHistory` or `TriageHistoryEntry`:
```bash
grep -rn "listTriageHistory\|TriageHistoryEntry\|TriageHistoryCapable\|searchByFingerprint\|FingerprintCapable" packages/providers/tests/
```
Update any found tests to use new names.

## Changeset

Create `.changeset/clean-issue-tracking-interfaces.md`:
```md
---
"@sweny-ai/providers": major
---

BREAKING: Renamed triage-specific interfaces to generic names:
- `TriageHistoryCapable` → `LabelHistoryCapable`
- `listTriageHistory()` → `searchIssuesByLabel()`
- `TriageHistoryEntry` → `IssueHistoryEntry` (removed `fingerprint` field)
- `canListTriageHistory()` → `canSearchIssuesByLabel()`

Removed dead code: `FingerprintCapable`, `searchByFingerprint()`, `canSearchByFingerprint()`
— these were implemented but never called from any recipe step.

`Issue.branchName` is now optional (`branchName?: string`).
```

## Commit Message
```
feat(providers)!: rename triage-specific interfaces, remove dead fingerprint code

TriageHistoryCapable → LabelHistoryCapable
listTriageHistory → searchIssuesByLabel
TriageHistoryEntry → IssueHistoryEntry (fingerprint field removed)
Issue.branchName is now optional
FingerprintCapable and searchByFingerprint deleted (never used)
```
