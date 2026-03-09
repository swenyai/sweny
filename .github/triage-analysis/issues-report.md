# Issues Report — 2026-03-09

## Issue 1: TypeScript Error — `triageRecipe.nodes` does not exist

- **Severity**: Critical
- **Environment**: Production (main branch + all dependabot branches)
- **Frequency**: Every CI run — 100% failure rate

### Description
`packages/cli/src/main.ts:103` references `triageRecipe.nodes.length` but the `Recipe<TConfig>` type has no `nodes` property. The property is `definition.states` (a `Record<string, StateDefinition>`).

### Evidence
```
src/main.ts(103,35): error TS2339: Property 'nodes' does not exist on type 'Recipe<TriageConfig>'.
npm error code 2
npm error workspace @sweny-ai/cli@0.2.0
npm error command sh -c tsc --noEmit
```
Observed on: main, dependabot/github_actions/actions/checkout-6, dependabot/github_actions/peter-evans/create-pull-request-8, dependabot/npm_and_yarn/* branches.

Also causes: **Release pipeline build failure** (`npm run build` in CLI package fails).

### Root Cause Analysis
Commit `b0958d3` introduced DAG spec v2, migrating `Recipe` from a flat `nodes[]` array to `{ definition: RecipeDefinition, implementations: StateImplementations<TConfig> }`. The `main.ts` spinner logic at line 103 used `triageRecipe.nodes.length` to determine total step count for the progress counter but was never updated to reflect the new API.

### Impact
- CI fails on every push to main and all dependabot branches
- Release pipeline is broken — no new releases can be cut
- The `sweny triage` CLI command cannot be type-checked

### Suggested Fix
```typescript
// Before (line 103):
const totalSteps = triageRecipe.nodes.length;

// After:
const totalSteps = Object.keys(triageRecipe.definition.states).length;
```

### Files to Modify
- `packages/cli/src/main.ts` — line 103

### Confidence Level
Very high — direct, single-line fix with clear causal chain.

### GitHub Issues Status
No existing GitHub Issues issue found — new issue will be created.

---

## Issue 2: Prettier Formatting Not Applied to 7 Recently Added Files

- **Severity**: High (CI-blocking)
- **Environment**: Production (all branches)
- **Frequency**: Every CI run — 100% failure rate

### Description
7 files added/modified in recent commits were not run through Prettier before committing, causing the format check step to fail.

### Evidence
```
[warn] packages/engine/src/runner-recipe.ts
[warn] packages/engine/src/types.ts
[warn] packages/providers/src/observability/pagerduty.ts
[warn] packages/providers/src/observability/prometheus.ts
[warn] packages/providers/tests/observability/pagerduty.test.ts
[warn] packages/providers/tests/observability/prometheus.test.ts
[warn] packages/studio/index.html
[warn] Code style issues found in 7 files. Run Prettier with --write to fix.
```

### Root Cause Analysis
The pagerduty and prometheus providers (and their tests), plus studio HTML and engine runner/types files, were committed without running `prettier --write`. No pre-commit hook is configured to enforce formatting automatically.

### Impact
- CI format check fails on every branch
- Combined with Issue 1, CI has zero passing checks on main

### Suggested Fix
Run `npx prettier --write` on the 7 affected files.

### Confidence Level
Very high — formatting-only change, no logic impact.

### GitHub Issues Status
No existing GitHub Issues issue found — bundling with Issue 1 fix.
