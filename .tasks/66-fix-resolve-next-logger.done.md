# Fix: `resolveNext` doesn't propagate `logger` to `safeObserve` calls

**Issue:** [#127](https://github.com/swenyai/sweny/issues/127)
**Package:** `packages/core`
**Severity:** Low

## Problem

In `packages/core/src/executor.ts`, the `resolveNext()` function calls `safeObserve()` twice (lines ~246 and ~286) but never passes the `logger` parameter. Every other `safeObserve()` call in the `execute()` function correctly passes `logger` as the third argument. This means routing events silently fall back to `consoleLogger` instead of using the caller-configured logger.

## What to change

**File:** `packages/core/src/executor.ts`

1. Add `logger?: Logger` to the `resolveNext` function signature (after `edgeCounts`)
2. Pass `logger` to both `safeObserve()` calls inside `resolveNext`:
   - The unconditional single-edge path (~line 246): `safeObserve(observer, {...}, logger)`
   - The conditional multi-edge path (~line 286): `safeObserve(observer, {...}, logger)`
3. Update the call site in `execute()` (~line 115) to pass `logger` when calling `resolveNext`

## Verification

```bash
cd packages/core
npx vitest run
npm run typecheck
```

All existing executor tests should still pass — this is additive (new optional param with fallback behavior unchanged).

## Reference

Compare the `safeObserve` calls in `execute()` (lines ~50-125) that correctly pass `logger` as the third arg.
