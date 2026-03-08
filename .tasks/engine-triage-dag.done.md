# Task: Convert Triage Recipe to Recipe

## Depends on
- `engine-dag-runner.todo.md` must be done first (Recipe type + runRecipe must exist)
- `engine-shared-nodes.todo.md` must be done first (SharedNodeConfig must exist)

## Goal
Rewrite `packages/engine/src/recipes/triage/index.ts` to use `Recipe` with
explicit node on instead of the `ctx.skipPhase()` hack. The routing
that is currently implicit (via phase skipping) becomes explicit DAG edges.

## Current routing (to preserve as DAG on)

**novelty-gate** currently:
- returns `data.action = "dry-run"` + calls `skipPhase("act")` → should go to notify
- returns `data.action = "skip"` + calls `skipPhase("act")` → should go to notify
- returns `data.action = "+1"` + calls `skipPhase("act")` → should go to notify
- returns `data.action = "implement"` (no skip) → should continue to create-issue

**cross-repo-check** currently:
- returns `data.dispatched = false` → continue to implement-fix
- returns `data.dispatched = true` + calls `skipPhase("act")` → should go to notify

## Steps

### 1. Update `novelty-gate.ts` — remove skipPhase, add data.outcome

The step should no longer call `ctx.skipPhase()`. Instead, set `data.outcome`
so the DAG runner can route via on:

```typescript
// dry-run
return { status: "success", data: { outcome: "skip", action: "dry-run", ... } };

// skip
return { status: "success", data: { outcome: "skip", action: "skip", ... } };

// +1 existing
return { status: "success", data: { outcome: "skip", action: "+1", ... } };  // same transition target

// implement
return { status: "success", data: { outcome: "implement", action: "implement", ... } };
```

Remove ALL `ctx.skipPhase()` calls from novelty-gate.ts.

### 2. Update `cross-repo-check.ts` — remove skipPhase, add data.outcome

```typescript
// local
return { status: "success", data: { outcome: "local", dispatched: false } };

// dispatched
return { status: "success", data: { outcome: "dispatched", dispatched: true, targetRepo } };
```

Remove `ctx.skipPhase("act", ...)` call.

### 3. Rewrite `recipes/triage/index.ts`

Replace the `Workflow<TriageConfig>` steps array with a `Recipe<TriageConfig>`:

```typescript
import { runRecipe } from "../../runner-recipe.js";
import type { Recipe } from "../../types.js";
import type { TriageConfig } from "./types.js";
// ... import all steps ...

export const triageRecipe: Recipe<TriageConfig> = {
  name: "triage",
  description: "Investigate production issues, implement fixes, and report results",
  start: "verify-access",
  steps: [
    { id: "verify-access",   phase: "learn", run: verifyAccess,   critical: true },
    { id: "build-context",   phase: "learn", run: buildContext,   critical: true },
    { id: "investigate",     phase: "learn", run: investigate,    critical: true },
    {
      id: "novelty-gate", phase: "act", run: noveltyGate,
      on: {
        skip:      "notify",   // dry-run, skip, or +1 all go straight to report
        implement: "create-issue",
      },
    },
    { id: "create-issue",      phase: "act", run: createIssue },
    {
      id: "cross-repo-check", phase: "act", run: crossRepoCheck,
      on: {
        local:      "implement-fix",
        dispatched: "notify",
      },
    },
    { id: "implement-fix", phase: "act",    run: implementFix },
    { id: "create-pr",     phase: "act",    run: createPr },
    { id: "notify",        phase: "report", run: sendNotification },
  ],
};

// Keep backwards-compatible export as Workflow for any callers that use runWorkflow
// by wrapping the DAG in a flat steps array
export { triageRecipe as triageWorkflow };
export type { TriageConfig, /* ... all types ... */ } from "./types.js";
export { getStepData } from "./results.js";
```

### 4. Update callers of triageWorkflow

The main caller is `packages/action/src/main.ts` which does:
```typescript
await runWorkflow(triageWorkflow, config, providers, options);
```

Update it to use `runRecipe`:
```typescript
import { runRecipe } from "@sweny-ai/engine";
// ...
await runRecipe(triageRecipe, config, providers, options);
```

Also check `packages/cli/src/main.ts` for the same pattern and update it.

## Verification

```bash
cd packages/engine && npm run build && npx vitest run
cd packages/action && npm run build   # or: cd ../.. && npm run build
cd packages/cli   && npm run typecheck
```

Key test: `recipes/triage/integration.test.ts` — make sure it still passes.
The novelty-gate and cross-repo-check tests need updating since they no longer
call `ctx.skipPhase()` — update mocks/assertions to check `data.outcome` instead.

## Notes
- `triageRecipe` should still export as `triageWorkflow` for backwards compat.
- The `WorkflowResult` shape is identical between `runWorkflow` and `runRecipe` — no
  downstream changes to how results are consumed.
- Commit message: `feat(engine): convert triage recipe to Recipe with explicit on`
