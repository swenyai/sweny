# Task 52: Fix duplicate issue creation — harden novelty gate

## Problem

Despite adding novelty check instructions to the `investigate` and `create_issue` nodes, SWEny is still creating duplicate issues. The triage run against sooo.dev created issues #45, #46, #47 — all variations of the same "missing AbortSignal timeout" root cause that was already tracked in closed issue #44 and 12 closed per-function issues (#20-#42).

## Root Cause Analysis

The novelty check relies entirely on Claude following instructions, with no structural enforcement:

1. **`investigate` node**: `is_duplicate` is optional in the output schema (not in `required`). Claude may not set it, and the edge evaluator can't reliably detect duplicates.

2. **`create_issue` node**: Instruction says "search before creating" but Claude can still choose to create. There's no guard that prevents `github_create_issue` from being called when duplicates exist.

3. **Edge routing** (`investigate → create_issue` vs `investigate → skip`): Claude evaluates the natural-language condition. If `is_duplicate` wasn't explicitly set to `true`, the evaluator may route to `create_issue` anyway.

4. **Closed vs Open**: The search instruction says "search for existing open issues" but the duplicate issues (#20-#44) are all closed. Claude may find them but not consider closed issues as duplicates.

## Required Changes

### 1. Make `is_duplicate` required in investigate output schema

**File**: `packages/core/src/workflows/triage.ts`

Change the `investigate` node's output schema `required` array from:
```typescript
required: ["root_cause", "severity", "recommendation"],
```
to:
```typescript
required: ["root_cause", "severity", "is_duplicate", "recommendation"],
```

### 2. Update investigate instruction — search OPEN AND CLOSED issues

**File**: `packages/core/src/workflows/triage.ts`

Update the novelty check instruction in the `investigate` node to:
- Search for BOTH open AND closed issues (a closed issue about the same root cause still means it's known)
- Be explicit about what constitutes a match: same root cause, same affected service, same error pattern
- Set `is_duplicate=true` if ANY matching issue exists (open or closed)

### 3. Remove duplicate search from create_issue — trust the routing

**File**: `packages/core/src/workflows/triage.ts`

The `create_issue` node shouldn't need to re-search for duplicates — the routing edge should have already filtered. Simplify `create_issue` back to just creating the issue. The novelty gate belongs in `investigate` + routing, not in `create_issue`.

However, keep the `github_add_comment` instruction as a fallback: "If you determine during issue creation that a very similar issue already exists, add a comment to it instead of creating a duplicate."

### 4. Strengthen the edge condition

**File**: `packages/core/src/workflows/triage.ts`

Change the edge condition from:
```
"The issue is novel (not a duplicate) and severity is medium or higher"
```
to:
```
"is_duplicate is false AND severity is medium or higher"
```

This makes the evaluator check the structured field rather than re-interpreting the situation.

## Acceptance Criteria

- Running triage twice against the same repo with no new errors produces zero new issues on the second run
- Closed issues are recognized as existing coverage (not just open ones)
- `is_duplicate` is always present in investigate output
- All existing tests pass
- Build succeeds

## Files to modify

- `packages/core/src/workflows/triage.ts` — investigate instruction, output schema, create_issue instruction, edge conditions
