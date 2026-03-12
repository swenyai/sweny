# Task 10: Close Stale PR #44

## Context

PR #44 ("fix(#43): engine schema missing provider field breaks schema validation tests")
was opened against the `fix/engine-schema-missing-provider-field` branch. The fix it
contains was already landed directly to `main` in commit `a1486a6` (the schema fix that
added the `provider` field to `StateDefinition` in `recipe-definition.schema.json`).

The PR is now stale — merging it would create a duplicate commit or conflict.

## What to Do

1. Close PR #44 without merging:
```bash
gh pr close 44 --repo swenyai/sweny --comment "Fix already landed in main directly (commit a1486a6). Closing stale PR."
```

2. Delete the remote branch:
```bash
gh api -X DELETE repos/swenyai/sweny/git/refs/heads/fix/engine-schema-missing-provider-field
```

3. Verify main has the fix:
```bash
grep -A 5 '"provider"' packages/engine/schema/recipe-definition.schema.json
# Should show the provider property definition
```

## Verification

```bash
npm test -w packages/engine
# All 379 tests should pass including schema validation tests
```

## No Changeset Required

CI/workflow-only change — no published packages modified.

## Commit Message

```
chore: close stale PR #44 — schema fix already in main
```
