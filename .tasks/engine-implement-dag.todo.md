# Task: Convert Implement Recipe to Recipe

## Depends on
- `engine-dag-runner.todo.md` must be done (Recipe + runRecipe)
- `engine-shared-nodes.todo.md` must be done (no more type casts)
- `engine-triage-dag.todo.md` must be done (triage already migrated, verify pattern)

## Goal
Rewrite `packages/engine/src/recipes/implement/index.ts` to use `Recipe`.
The implement recipe is simpler than triage — linear flow, no conditional routing.

## Current implement/index.ts

```typescript
export const implementWorkflow: Workflow<ImplementConfig> = {
  name: "implement",
  steps: [
    { name: "verify-access", phase: "learn", run: verifyAccess },
    { name: "create-issue",  phase: "learn", run: fetchIssue },  // named "create-issue" for getStepData compat
    { name: "implement-fix", phase: "act",   run: implementFix as unknown as ... },
    { name: "create-pr",     phase: "act",   run: createPr as unknown as ... },
    { name: "notify",        phase: "report",run: sendNotification as unknown as ... },
  ],
};
```

## Target

```typescript
import type { Recipe } from "../../types.js";
import type { ImplementConfig } from "./types.js";
import { verifyAccess }      from "./steps/verify-access.js";
import { fetchIssue }        from "./steps/fetch-issue.js";
import { implementFix }      from "../../nodes/implement-fix.js";
import { createPr }          from "../../nodes/create-pr.js";
import { sendNotification }  from "../../nodes/notify.js";

export const implementRecipe: Recipe<ImplementConfig> = {
  name: "implement",
  description: "Implement a fix for a specific issue and open a pull request",
  start: "verify-access",
  steps: [
    { id: "verify-access", phase: "learn", run: verifyAccess, critical: true },
    // Named "create-issue" so implement-fix and create-pr find it via getStepData
    { id: "create-issue",  phase: "learn", run: fetchIssue,   critical: true },
    { id: "implement-fix", phase: "act",   run: implementFix },
    { id: "create-pr",     phase: "act",   run: createPr },
    { id: "notify",        phase: "report",run: sendNotification },
  ],
};

// Backwards compat alias
export { implementRecipe as implementWorkflow };
export type { ImplementConfig } from "./types.js";
```

No `as unknown as` casts — shared nodes are typed to `SharedNodeConfig` which
`ImplementConfig` satisfies (after engine-shared-nodes task).

## Update callers

Check `packages/action/src/main.ts` and `packages/cli/src/main.ts` for any calls
to `runWorkflow(implementWorkflow, ...)` and update to `runRecipe(implementRecipe, ...)`.

## Verification

```bash
cd packages/engine
npm run build     # 0 errors, no `as unknown as` in implement/index.ts
npm run typecheck # 0 errors
npx vitest run    # all tests pass
```

Check `recipes/implement/implement.test.ts` — update if needed.

## Notes
- The `create-issue` node id naming is intentional — `getStepData(ctx, "create-issue")`
  in implement-fix.ts looks for this key to find the issue data.
- Commit message: `feat(engine): convert implement recipe to Recipe`
