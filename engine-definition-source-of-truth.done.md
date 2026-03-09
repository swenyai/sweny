# Task: Engine — Single Source of Truth for Recipe Definitions

## Problem
`packages/engine/src/recipes/triage/index.ts` defines the triage DAG in **two places**:
1. Inline inside the `createRecipe()` call (lines 17–68)
2. Separately in `./definition.ts` (exported as `triageDefinition`)

These are separate objects that currently match but can silently drift if someone edits one.

Also, `implement/index.ts` has no separate `implementDefinition` export — the studio
cannot visualize the implement recipe without importing Node.js-only implementation functions.

## Repo context
- Package: `packages/engine`
- Build: `npm run build` inside `packages/engine`
- Tests: `npx vitest run` inside `packages/engine`

## Fixes required

### Fix 1: triage/index.ts must USE triageDefinition from definition.ts

**Current (broken):**
```typescript
// index.ts re-exports definition.ts...
export { triageDefinition } from "./definition.js";

// ...but createRecipe() uses its OWN INLINE copy:
export const triageRecipe = createRecipe<TriageConfig>(
  {
    id: "triage",
    version: "1.0.0",
    // ... full inline definition ...
  },
  { ...implementations... },
);
```

**Fixed:**
```typescript
import type { TriageConfig } from "./types.js";
import { triageDefinition } from "./definition.js";
import { verifyAccess } from "./steps/verify-access.js";
import { buildContext } from "./steps/build-context.js";
import { investigate } from "./steps/investigate.js";
import { noveltyGate } from "./steps/novelty-gate.js";
import { createIssue } from "./steps/create-issue.js";
import { crossRepoCheck } from "./steps/cross-repo-check.js";
import { implementFix } from "./steps/implement-fix.js";
import { createPr } from "./steps/create-pr.js";
import { sendNotification } from "./steps/notify.js";
import { createRecipe } from "../../runner-recipe.js";

export { triageDefinition };

export const triageRecipe = createRecipe<TriageConfig>(triageDefinition, {
  "verify-access": verifyAccess,
  "build-context": buildContext,
  investigate: investigate,
  "novelty-gate": noveltyGate,
  "create-issue": createIssue,
  "cross-repo-check": crossRepoCheck,
  "implement-fix": implementFix,
  "create-pr": createPr,
  notify: sendNotification,
});

export type {
  TriageConfig,
  InvestigationResult,
  ImplementResult,
  BuildContextData,
  IssueData,
  ImplementFixData,
  PrData,
  CrossRepoData,
  TriageStepDataMap,
} from "./types.js";
export { getStepData } from "./results.js";
```

The definition lives ONLY in `definition.ts`. `index.ts` imports it.

### Fix 2: Create implement/definition.ts

Create `packages/engine/src/recipes/implement/definition.ts` as a browser-safe file
(no implementation imports, no Node.js dependencies):

```typescript
/**
 * The pure serializable definition of the implement recipe.
 * This file has NO implementation imports — safe for browser bundling.
 */
import type { RecipeDefinition } from "../../types.js";

export const implementDefinition: RecipeDefinition = {
  id: "implement",
  version: "1.0.0",
  name: "implement",
  description: "Implement a fix for a specific issue and open a pull request",
  initial: "verify-access",
  states: {
    "verify-access": { phase: "learn", critical: true, next: "create-issue" },
    // Named "create-issue" so that implementFix and createPr find it via getStepData
    "create-issue": { phase: "learn", critical: true, next: "implement-fix", description: "Fetch the issue details" },
    "implement-fix": { phase: "act", next: "create-pr", on: { failed: "notify" } },
    "create-pr": { phase: "act", next: "notify", on: { failed: "notify" } },
    notify: { phase: "report" },
  },
};
```

Then update `implement/index.ts` to:
```typescript
import type { ImplementConfig } from "./types.js";
import { implementDefinition } from "./definition.js";
import { verifyAccess } from "./steps/verify-access.js";
import { fetchIssue } from "./steps/fetch-issue.js";
import { implementFix } from "../../nodes/implement-fix.js";
import { createPr } from "../../nodes/create-pr.js";
import { sendNotification } from "../../nodes/notify.js";
import { createRecipe } from "../../runner-recipe.js";

export { implementDefinition };

export const implementRecipe = createRecipe<ImplementConfig>(implementDefinition, {
  "verify-access": verifyAccess,
  "create-issue": fetchIssue,
  "implement-fix": implementFix,
  "create-pr": createPr,
  notify: sendNotification,
});

export type { ImplementConfig } from "./types.js";
```

### Fix 3: Update engine/src/browser.ts

The browser-safe entry point must export `implementDefinition`. Read the current
`packages/engine/src/browser.ts` and add `implementDefinition` to its exports from
`./recipes/implement/definition.js`.

### Fix 4: Update engine/src/index.ts

Add `implementDefinition` to the main exports:
```typescript
export { implementRecipe, implementDefinition } from "./recipes/implement/index.js";
```

## Verification

After your changes, verify that:
```typescript
import { triageDefinition, implementDefinition } from "@sweny-ai/engine";

// Both must be JSON-serializable — no functions
JSON.stringify(triageDefinition);   // must not throw
JSON.stringify(implementDefinition); // must not throw

// The recipe must use the SAME object (same reference)
import { triageRecipe } from "@sweny-ai/engine";
// triageRecipe.definition === triageDefinition  // true (same object reference)
```

Write a short test verifying `triageRecipe.definition === triageDefinition` (same object, not a copy).
Add it to `packages/engine/src/runner-recipe.test.ts` or create a new file
`packages/engine/src/recipes/triage/definition.test.ts`.

## Success criteria
1. `npm run build` passes in `packages/engine`
2. `npm run typecheck` passes in `packages/engine`
3. `npx vitest run` passes — existing tests green, new reference-equality test green
4. `JSON.stringify(triageDefinition)` and `JSON.stringify(implementDefinition)` work without errors
5. `triageRecipe.definition === triageDefinition` is `true`
6. `implementRecipe.definition === implementDefinition` is `true`

## Commit when done
```
git add packages/engine/src/recipes/
git commit -m "fix(engine): single source of truth for recipe definitions — no inline duplication"
```
Then rename: `mv engine-definition-source-of-truth.todo.md engine-definition-source-of-truth.done.md`
