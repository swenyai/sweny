# Task 82: Activate the version-consistency todo test

## Problem

`packages/core/src/__tests__/version-consistency.test.ts` has a `.todo` test that verifies no docs code block uses `swenyai/sweny@v5` with triage-only inputs. After all the docs are fixed (tasks 75-81), this test should pass.

## What to change

In `packages/core/src/__tests__/version-consistency.test.ts`, change:

```typescript
it.todo("no docs code block uses swenyai/sweny@v5 with triage-only inputs", () => {
```

To:

```typescript
it("no docs code block uses swenyai/sweny@v5 with triage-only inputs", () => {
```

## Validation

Run: `npx vitest run src/__tests__/version-consistency.test.ts`

All 14 tests should pass with 0 todo. If any fail, investigate which docs file still has the wrong action reference and fix it.

Also run the full test suite: `npm test` — all tests should pass.
