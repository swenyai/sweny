# Task: Migrate Existing Recipes to DAG Spec v2

## Prerequisite
This task depends on `dag-spec-v2-types-and-runner.todo.md` being **done first**.
Check that `dag-spec-v2-types-and-runner.done.md` exists before starting.

## Goal
Migrate the triage and implement recipes from the old `nodes[]` format to the new
`states{}` format using `createRecipe(definition, implementations)`.

## Repo context
- Package: `packages/engine`
- Build: `npm run build` inside `packages/engine`
- Tests: `npx vitest run` inside `packages/engine`

## What changed in the spec

### Old format:
```typescript
export const triageRecipe: Recipe<TriageConfig> = {
  name: "triage",
  description: "...",
  start: "verify-access",
  nodes: [
    { id: "verify-access", phase: "learn", run: verifyAccess, critical: true },
    { id: "novelty-gate", phase: "act", run: noveltyGate, on: { skip: "notify", implement: "create-issue", failed: "notify" } },
    { id: "notify", phase: "report", run: sendNotification },
  ],
};
```

### New format:
```typescript
import { createRecipe } from "../../runner-recipe.js";  // or wherever it's exported from

const definition: RecipeDefinition = {
  id: "triage",
  version: "1.0.0",
  name: "triage",
  description: "...",
  initial: "verify-access",
  states: {
    "verify-access": { phase: "learn", critical: true, next: "build-context" },
    "novelty-gate":  { phase: "act",   on: { skip: "notify", implement: "create-issue", failed: "notify" } },
    "notify":        { phase: "report" },
  },
};

const implementations = {
  "verify-access": verifyAccess,
  "novelty-gate":  noveltyGate,
  "notify":        sendNotification,
};

export const triageRecipe = createRecipe<TriageConfig>(definition, implementations);
```

Key changes:
- `nodes: []` → `states: {}`
- `start` → `initial`
- `run: fn` removed from state definitions — moved to separate `implementations` object
- `next: "..."` replaces implicit sequential fallback (old: just being next in the array)
- `createRecipe()` validates at construction time

## Files to migrate

### 1. `packages/engine/src/recipes/triage/index.ts`

Current triage DAG (from the file):
```
verify-access (learn, critical)
  → build-context (learn, critical)
  → investigate (learn, critical)
  → novelty-gate (act)
      skip     → notify
      implement → create-issue
      failed   → notify
  → create-issue (act, on: { failed: notify })
      [default] → cross-repo-check
  → cross-repo-check (act)
      local      → implement-fix
      dispatched → notify
      failed     → notify
  → implement-fix (act, on: { failed: notify })
      [default]  → create-pr
  → create-pr (act, on: { failed: notify })
      [default]  → notify
  → notify (report, terminal)
```

In the new format, every `[default]` arrow becomes `next: "..."`.

**Important**: The implementations for `implement-fix`, `create-pr`, and `notify` are imported
from `../../nodes/` (shared nodes). The triage-specific steps are in `./steps/`.
The implementations object just maps state ids to the right function — the state id can be
anything (it doesn't need to match the function name).

### 2. `packages/engine/src/recipes/implement/index.ts`

Current implement DAG:
```
verify-access (learn, critical)
  → create-issue (learn, critical, run: fetchIssue — note: different function, same state id)
  → implement-fix (act, on: { failed: notify })
  → create-pr (act, on: { failed: notify })
  → notify (report, terminal)
```

Note the naming quirk: the state is called "create-issue" but the implementation function
is `fetchIssue` (it fetches an existing issue rather than creating one). Keep this state id
as-is since downstream nodes use `ctx.results.get("create-issue")` to read it.

## Also check and update these files if they reference old Recipe types

- `packages/engine/src/recipes/triage/types.ts` — may reference `RecipeStep`
- `packages/engine/src/recipes/implement/types.ts` — same
- `packages/engine/src/recipes/triage/integration.test.ts` — may use old recipe format
- `packages/engine/src/recipes/implement/implement.test.ts` — same
- `packages/engine/src/recipes/triage/e2e.test.ts` — same
- `packages/engine/src/recipes/implement/e2e.test.ts` — same

For integration/e2e tests: if they construct a Recipe directly, update to use `createRecipe`.
If they import the recipe object and call `runRecipe` on it, they should still work as-is
since the recipe object interface is compatible.

## Export shape

After migration, `packages/engine/src/recipes/triage/index.ts` should still export:
```typescript
export { triageRecipe };
export type { TriageConfig, InvestigationResult, ImplementResult, ... } from "./types.js";
export { getStepData } from "./results.js";
```

And `packages/engine/src/recipes/implement/index.ts`:
```typescript
export { implementRecipe };
export type { ImplementConfig } from "./types.js";
```

## The RecipeDefinition should also be exported

Export `triageDefinition` and `implementDefinition` as named exports alongside the recipe.
This makes the pure-data definition available to the future visual editor without needing
to strip out functions.

```typescript
export const triageDefinition: RecipeDefinition = { ... };
export const triageRecipe = createRecipe<TriageConfig>(triageDefinition, triageImplementations);
```

## Success criteria
1. `npm run build` passes in `packages/engine`
2. `npm run typecheck` passes in `packages/engine`
3. `npx vitest run` passes in `packages/engine` — all existing recipe tests green
4. `triageDefinition` and `implementDefinition` are exported and are plain JSON-serializable objects
5. `JSON.stringify(triageDefinition)` works without errors (no functions in the definition)

## Commit when done
```
git add packages/engine/src/recipes/
git commit -m "feat(engine): migrate triage and implement recipes to DAG spec v2"
```
Then rename: `mv dag-spec-v2-recipe-migration.todo.md dag-spec-v2-recipe-migration.done.md`
