# Fix: `safeObserve` accepts `event: any` instead of `ExecutionEvent`

**Issue:** [#125](https://github.com/swenyai/sweny/issues/125)
**Package:** `packages/core`
**Severity:** Medium

## Problem

In `packages/core/src/executor.ts`, the `safeObserve()` helper function (~line 167) accepts `event: any`, which bypasses TypeScript's discriminated union type checking on `ExecutionEvent`. The `Observer` type is correctly defined as `(event: ExecutionEvent) => void` in `types.ts`, but the wrapper function loses that type safety.

## What to change

**File:** `packages/core/src/executor.ts`

1. Change `safeObserve` signature from:
   ```typescript
   function safeObserve(observer: Observer | undefined, event: any, logger?: Logger): void
   ```
   to:
   ```typescript
   function safeObserve(observer: Observer | undefined, event: ExecutionEvent, logger?: Logger): void
   ```
2. Ensure `ExecutionEvent` is imported from `./types.js` (it likely already is, since `Observer` is imported)

## Verification

```bash
cd packages/core
npm run typecheck
npx vitest run
```

All existing callers already pass properly-typed `ExecutionEvent` objects, so typecheck should pass with no other changes. If any caller fails typecheck, that's a real bug the `any` was hiding — fix the caller, don't revert.

## Reference

- `ExecutionEvent` type: `packages/core/src/types.ts` (~lines 102-110)
- `Observer` type: `packages/core/src/types.ts` (~line 112)
- All 10 `safeObserve` callers are in `executor.ts`
