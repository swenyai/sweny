# Investigation Log — 2026-03-12

## Approach
Direct run (no GitHub issue provided, no dispatcher). Followed the autonomous improvement agent mandate:
1. Parse CI failure logs from `/tmp/ci-logs.json`
2. Investigate the codebase holistically
3. Identify the highest-value fix

---

## Step 1: Parse CI Logs

**Command**: Parsed 28,988 log entries from `/tmp/ci-logs.json`.

**Breakdown by workflow**:
- CI: 19,649 entries
- Release: 8,347 entries
- Deploy Docs: 785 entries
- Auto Changeset: 207 entries

**Meaningful errors filtered on main branch (2026-03-12)**:

1. `src/schema.test.ts > triageDefinition passes schema validation` — FAIL (every run)
2. `src/schema.test.ts > implementDefinition passes schema validation` — FAIL (every run)
3. `AssertionError: expected [ { …(5) }, { …(5) }, { …(5) }, …(6) ] to be null`
4. `AssertionError: expected [ { …(5) }, { …(5) }, { …(5) }, …(1) ] to be null`
5. `Cannot read properties of undefined (reading 'find')` in action `tests/main.test.ts`
6. `src/model/adapter.ts(13,72): error TS2345` — TypeScript in agent package (2026-03-11)

**Focus**: The `schema.test.ts` failures are consistent across every run on main (confirmed at 00:30, 00:32, 01:11 on 2026-03-12). High confidence this is the right target.

---

## Step 2: Reproduce Root Cause

**Read**: `packages/engine/src/schema.test.ts`
- Compiles AJV from `schema/recipe-definition.schema.json`
- Validates `triageDefinition` and `implementDefinition` against it
- Expects `validate.errors` to be `null` (passes = null errors)

**Read**: `packages/engine/schema/recipe-definition.schema.json`
- `StateDefinition.$defs` has `additionalProperties: false`
- Allowed properties: `phase`, `description`, `critical`, `next`, `on`
- **Missing**: `provider`

**Read**: `packages/engine/src/recipes/triage/definition.ts`
- 9 states have `provider: "<role>"` (observability, codingAgent, issueTracking, sourceControl, notification)
- Only `verify-access` has no `provider` field

**Read**: `packages/engine/src/recipes/implement/definition.ts`
- 4 states have `provider: "<role>"`
- Only `verify-access` has no `provider` field

**Read**: `packages/engine/src/types.ts` line 197:
```typescript
provider?: string;
// "Pure metadata — no runtime effect. Used by Studio to surface configuration
// options and required env vars for each step."
```

**Root Cause**: The `provider?: string` field was added to the TypeScript `StateDefinition` interface but the JSON Schema was not updated to match. `additionalProperties: false` causes AJV to reject the `provider` field as an unknown property.

**Validation error count matches**:
- triage: 9 states with `provider` → 9 AJV errors → `[…(5), …(5), …(5), …(6)]` array
- implement: 4 states with `provider` → 4 AJV errors → `[…(5), …(5), …(5), …(1)]` array

---

## Step 3: Confirm No Duplicate Issue

Checked known triage history (KNOWN ISSUES section) — no existing PR or issue for this schema/provider mismatch.

---

## Decision: Fix the Schema

**Target file**: `packages/engine/schema/recipe-definition.schema.json`

**Fix**: Add `provider` property to `StateDefinition` in the JSON schema to match the TypeScript type.

This fix:
- Is minimal (one property added to JSON schema)
- Unblocks CI on every push to main
- Keeps the JSON schema in sync with the TypeScript `StateDefinition` interface
- Purely additive to the schema — cannot break any existing code
