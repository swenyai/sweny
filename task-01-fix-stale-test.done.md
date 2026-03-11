# Task 01 — Fix stale `listTriageHistory` reference in action test

## Context

`IssueTrackingProvider.listTriageHistory()` was renamed to `searchIssuesByLabel()` as part of
the provider interface cleanup. All provider implementations and call sites were updated, but
one test in the Action package still asserts the old method name.

## File to change

`packages/action/tests/providers.test.ts` line 107:
```ts
expect(typeof (issueTracker as any).listTriageHistory).toBe("function");
```

## What to do

1. Read the full test file to understand context (what provider is being tested, what the
   test is actually checking).

2. Replace the `listTriageHistory` assertion with `searchIssuesByLabel`:
   ```ts
   expect(typeof (issueTracker as any).searchIssuesByLabel).toBe("function");
   ```

3. Run tests in `packages/action` to confirm the test passes:
   ```
   cd packages/action && npx vitest run
   ```

## Definition of done

- `listTriageHistory` does not appear anywhere in the codebase (grep should return nothing)
- `packages/action` tests pass
