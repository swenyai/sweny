# Task: Extract Shared Nodes — eliminate type cast hacks

## Goal
Move the three steps shared between `triage` and `implement` recipes into a
`packages/engine/src/nodes/` directory. Make them typed to a `SharedNodeConfig`
interface so `implement/index.ts` can use them without `as unknown as` casts.

## Why
`packages/engine/src/recipes/implement/index.ts` currently does:
```typescript
run: implementFix as unknown as WorkflowStep<ImplementConfig>["run"],
```
This is because `implementFix`, `createPr`, and `sendNotification` are typed
to `TriageConfig` but `ImplementConfig` only provides a subset of those fields.
The fix: extract a `SharedNodeConfig` interface that both configs satisfy,
and type the shared nodes to that interface.

## Steps

### 1. Create `packages/engine/src/nodes/types.ts`

```typescript
/**
 * Minimal config interface required by shared nodes (implement-fix, create-pr, notify).
 * Both TriageConfig and ImplementConfig satisfy this interface.
 */
export interface SharedNodeConfig {
  repository: string;
  dryRun: boolean;
  maxImplementTurns: number;
  prDescriptionMaxTurns?: number;
  baseBranch?: string;
  prLabels?: string[];
  analysisDir?: string;
  agentEnv: Record<string, string>;
  projectId: string;
  stateInProgress: string;
  statePeerReview: string;
}
```

### 2. Create `packages/engine/src/nodes/index.ts`

```typescript
export type { SharedNodeConfig } from "./types.js";
export { implementFix } from "./implement-fix.js";
export { createPr } from "./create-pr.js";
export { sendNotification } from "./notify.js";
```

### 3. Copy + retype shared step files

Copy these three files from `recipes/triage/steps/` to `nodes/`:
- `implement-fix.ts` → `nodes/implement-fix.ts`
- `create-pr.ts` → `nodes/create-pr.ts`
- `notify.ts` → `nodes/notify.ts`

In each copied file, change the import of `TriageConfig` to `SharedNodeConfig`:
```typescript
// Before:
import type { TriageConfig } from "../types.js";
// ...
export async function implementFix(ctx: WorkflowContext<TriageConfig>)

// After:
import type { SharedNodeConfig } from "./types.js";
// ...
export async function implementFix(ctx: WorkflowContext<SharedNodeConfig>)
```

Also fix relative imports in the copied files (they import from `../results.js`
which is triage-specific — check each file and update paths accordingly).
`getStepData` lives at `recipes/triage/results.ts` — import it as
`../../recipes/triage/results.js` from the nodes directory.

### 4. Update `recipes/triage/steps/implement-fix.ts`, `create-pr.ts`, `notify.ts`

These originals should now just re-export from `nodes/` to avoid breaking
any existing imports:
```typescript
// recipes/triage/steps/implement-fix.ts
export { implementFix } from "../../../nodes/implement-fix.js";
```
Do this for all three files.

### 5. Update `recipes/implement/index.ts`

Remove the `as unknown as` casts. Import from `nodes/` directly:
```typescript
// Before:
import { implementFix } from "../triage/steps/implement-fix.js";
// ...
run: implementFix as unknown as WorkflowStep<ImplementConfig>["run"],

// After:
import { implementFix } from "../../nodes/implement-fix.js";
// ...
run: implementFix,   // no cast needed — SharedNodeConfig is satisfied
```

ImplementConfig must satisfy SharedNodeConfig. Check that all fields from
SharedNodeConfig exist in ImplementConfig (packages/engine/src/recipes/implement/types.ts).
Add any missing fields.

### 6. Update `recipes/triage/index.ts`

Optionally import directly from `nodes/` instead of `triage/steps/` for the
three shared nodes (implement-fix, create-pr, notify). Either works since
the originals now re-export.

## Verification

```bash
cd packages/engine
npm run build        # 0 errors
npm run typecheck    # 0 errors — no more as unknown as
npx vitest run       # all tests pass
```

## Notes
- Keep the originals in `recipes/triage/steps/` as re-exports — don't delete them,
  other code may import from there.
- Do NOT change the function signatures or logic, only the config type parameter.
- Commit message: `refactor(engine): extract shared nodes, eliminate type cast hacks`
