# Investigation Log — 2026-03-09

## Approach
Following Additional Instructions: autonomous improvement agent for the SWEny codebase.
Primary input: CI failure logs at `/tmp/ci-logs.json`.

## Step 1: Analyze CI Logs

Parsed CI logs and extracted unique error patterns:

### Error 1: TypeScript type error (critical, blocking CI + Release)
```
src/main.ts(103,35): error TS2339: Property 'nodes' does not exist on type 'Recipe<TriageConfig>'
```
- Affects: packages/cli
- Observed on: main, all dependabot branches
- CI jobs failed: typecheck, Release/Build packages

### Error 2: Format check failure
```
Code style issues found in 7 files. Run Prettier with --write to fix.
```
Files:
- `packages/engine/src/runner-recipe.ts`
- `packages/engine/src/types.ts`
- `packages/providers/src/observability/pagerduty.ts`
- `packages/providers/src/observability/prometheus.ts`
- `packages/providers/tests/observability/pagerduty.test.ts`
- `packages/providers/tests/observability/prometheus.test.ts`
- `packages/studio/index.html`

## Step 2: Root Cause Analysis

### Issue 1: `triageRecipe.nodes` does not exist

Examined `packages/engine/src/types.ts`:
- `Recipe<TConfig>` interface has two fields: `definition: RecipeDefinition` and `implementations: StateImplementations<TConfig>`
- `RecipeDefinition` has `states: Record<string, StateDefinition>` — NOT a `nodes` array

Examined `packages/cli/src/main.ts:103`:
```typescript
const totalSteps = triageRecipe.nodes.length;
```

Root cause: The DAG spec v2 migration (commit `b0958d3 feat(engine): DAG spec v2 — states{} map, createRecipe factory, explicit routing`) changed the `Recipe` shape from a `nodes[]` array to `definition.states` record, but line 103 in `main.ts` was not updated.

Fix: `Object.keys(triageRecipe.definition.states).length`

### Issue 2: Prettier formatting not applied to newly added files

The 7 flagged files were added/modified recently (pagerduty/prometheus providers, studio HTML, engine types/runner) but were not run through prettier before commit.

Fix: Run `npx prettier --write` on the affected files.

## Step 3: Verify Fix Scope

- The `nodes` reference is only on line 103 of `main.ts` — verified via code read
- `triageRecipe.definition.states` has 9 states (verify-access, build-context, investigate, novelty-gate, create-issue, cross-repo-check, implement-fix, create-pr, notify)
- The fix preserves the spinner counter logic correctly

## Conclusion

Both issues are on the same repo (swenyai/sweny). TypeScript error is the primary blocking issue; formatting is secondary but also blocks CI. Both can be fixed in a single PR.
