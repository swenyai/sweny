# Cleanup: Remove dead `NO_OUTGOING_EDGE` error code from `WorkflowError`

**Issue:** [#126](https://github.com/swenyai/sweny/issues/126)
**Package:** `packages/core`
**Severity:** Low

## Problem

In `packages/core/src/schema.ts`, the `WorkflowError` interface's `code` union includes `"NO_OUTGOING_EDGE"` (~line 83), but this code is **never emitted** by `validateWorkflow()`. The JSDoc for `validateWorkflow()` also claims it checks "All non-terminal nodes have at least one outgoing edge" but that check doesn't exist. This is dead public API surface that misleads consumers.

## What to change

**File:** `packages/core/src/schema.ts`

1. Remove `| "NO_OUTGOING_EDGE"` from the `WorkflowError.code` union type (~line 83)
2. Remove the JSDoc bullet "All non-terminal nodes have at least one outgoing edge" from the `validateWorkflow` docstring (~line 97)

That's it. No implementation code references this value — only the type definition and docstring.

## Verification

```bash
cd packages/core
npm run typecheck
npx vitest run
```

Grep to confirm nothing else references it:
```bash
grep -r "NO_OUTGOING_EDGE" packages/
```

Should return zero results after the fix.

## Reference

- `WorkflowError` type: `packages/core/src/schema.ts` (~lines 74-86)
- `validateWorkflow` JSDoc: `packages/core/src/schema.ts` (~lines 88-98)
- Exported publicly via `packages/core/src/index.ts` and `packages/core/src/browser.ts`
