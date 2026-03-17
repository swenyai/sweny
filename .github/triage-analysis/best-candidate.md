<!-- TRIAGE_FINGERPRINT
error_pattern: "RecipeViewer" is not exported by "../studio/dist-lib/viewer.js"
service: sweny-web
first_seen: 2026-03-17
run_id: 23204701005
-->

RECOMMENDATION: implement

TARGET_SERVICE: sweny-web
TARGET_REPO: swenyai/sweny

**GitHub Issues Issue**: None found - New issue will be created

# RecipeViewer Stale Import Breaks Deploy Docs Build

## Summary

`packages/web/src/components/RecipeExplorer.tsx` still imports `RecipeViewer` from
`@sweny-ai/studio/viewer`, but studio v3.0.0 renamed this export to `WorkflowViewer`.
Every push to `main` fails the Deploy Docs workflow with a Rollup build error.

## Root Cause

Studio v3.0.0 introduced a documented breaking change (CHANGELOG.md):

> **Breaking**: Studio public exports renamed to workflow terminology.
> `RecipeViewer` → `WorkflowViewer`

`packages/studio/src/lib-viewer.ts` now exports only `WorkflowViewer`. However,
`packages/web/src/components/RecipeExplorer.tsx` was never updated to match.

The Deploy Docs workflow runs `build:lib` (studio) before building `packages/web`.
When Rollup resolves `@sweny-ai/studio/viewer`, it finds `dist-lib/viewer.js` with no
`RecipeViewer` export, and fails with exit code 1.

## CI Evidence

```
[ERROR] [vite] ✗ Build failed in 2.11s
src/components/RecipeExplorer.tsx (2:9): "RecipeViewer" is not exported by
"../studio/dist-lib/viewer.js", imported by "src/components/RecipeExplorer.tsx".

  1: import { useState, useRef, useCallback, useEffect } from "react";
  2: import { RecipeViewer } from "@sweny-ai/studio/viewer";
              ^
  3: import { triageDefinition, implementDefinition } from "@sweny-ai/engine/browser";
```

Run 23204701005, job 67436666701 ("build"), step "Build site".

## Exact Code Changes

**File**: `packages/web/src/components/RecipeExplorer.tsx`

Change 1 — line 2, import statement:
```diff
-import { RecipeViewer } from "@sweny-ai/studio/viewer";
+import { WorkflowViewer } from "@sweny-ai/studio/viewer";
```

Change 2 — line 1179, JSX usage:
```diff
-      <RecipeViewer
+      <WorkflowViewer
```

The props are identical (`definition`, `executionState`, `height`, `onNodeClick`) — no
prop name changes are needed.

## Changeset Required

No — `packages/web` is a private package (not published to npm per CLAUDE.md).

## Test Plan

1. Confirm the fix locally: `npm run build:lib --workspace=packages/studio` then
   `npm run build --workspace=packages/web` — should succeed.
2. Confirm TypeScript is happy: `npm run typecheck` from root.
3. Push to a branch and verify the Deploy Docs workflow passes.

## Rollback Plan

Revert the two-line change in `RecipeExplorer.tsx`. The only risk is the current broken
state (build fails), so rollback simply restores the broken state — not applicable.

## Impact

- **Unblocks** the Deploy Docs workflow on every push to main.
- **No published package changes** — web is private.
- **No API surface or behavior changes** — purely a component name update.

## Confidence

High — the rename is unambiguous (CHANGELOG, lib-viewer.ts), the props are identical,
and the fix is two lines.
