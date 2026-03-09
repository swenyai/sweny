<!-- TRIAGE_FINGERPRINT
error_pattern: Property 'nodes' does not exist on type 'Recipe<TriageConfig>'
service: sweny-ci / packages/cli
first_seen: 2026-03-09
run_id: 22841195318
-->

RECOMMENDATION: implement

TARGET_SERVICE: sweny
TARGET_REPO: swenyai/sweny

**GitHub Issues Issue**: None found - New issue will be created

# CLI Typecheck and Format Failures After DAG Spec v2 Migration

## Summary

Two CI-blocking issues introduced by the DAG spec v2 migration are preventing every CI run and the Release pipeline from passing:

1. `packages/cli/src/main.ts:103` references `triageRecipe.nodes.length` — a property that no longer exists after the `Recipe` type was refactored to use `definition.states` (a `Record<string, StateDefinition>`) instead of a flat `nodes[]` array.
2. Seven recently committed files were not run through Prettier before commit, causing the format check to fail on all branches.

## Root Cause

The DAG spec v2 migration (`b0958d3`) restructured the `Recipe<TConfig>` type:

**Before:**
```typescript
// Old (implied): Recipe had a nodes: Node[] property
const totalSteps = triageRecipe.nodes.length;
```

**After (current `types.ts`):**
```typescript
export interface Recipe<TConfig = unknown> {
  definition: RecipeDefinition;    // ← states map lives here
  implementations: StateImplementations<TConfig>;
}

export interface RecipeDefinition {
  // ...
  states: Record<string, StateDefinition>;  // ← no `nodes` array
}
```

The CLI spinner at `main.ts:103` was not updated to use the new API shape.

## Exact Code Change

**`packages/cli/src/main.ts` line 103:**
```typescript
// Before:
const totalSteps = triageRecipe.nodes.length;

// After:
const totalSteps = Object.keys(triageRecipe.definition.states).length;
```

This produces the same count (9 states in the triage recipe) while using the correct API.

## Formatting Fix

Ran `npx prettier --write` on the 7 files identified by the CI format check:
- `packages/engine/src/runner-recipe.ts`
- `packages/engine/src/types.ts`
- `packages/providers/src/observability/pagerduty.ts`
- `packages/providers/src/observability/prometheus.ts`
- `packages/providers/tests/observability/pagerduty.test.ts`
- `packages/providers/tests/observability/prometheus.test.ts`
- `packages/studio/index.html`

## Test Plan

- [ ] `npm run typecheck` passes with no `TS2339` error on `main.ts:103`
- [ ] `npm run format:check` passes (all 7 files now Prettier-compliant)
- [ ] `npm run build` in `packages/cli` succeeds
- [ ] `sweny triage --dry-run` spinner shows correct step count (`[N/9]`)
- [ ] CI passes on main branch

## Rollback Plan

Revert the single-line change in `main.ts:103` and re-run `prettier --write` on the 7 files. The change is fully backward-safe — `Object.keys(recipe.definition.states).length` is semantically identical to the old `recipe.nodes.length`.

## Confidence

Very high. Direct, minimal, well-scoped fix to a clear type error introduced by a known migration.
