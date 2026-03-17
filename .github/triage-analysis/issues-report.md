# Issues Report — 2026-03-17

## Issue 1: RecipeViewer Import Breaks Deploy Docs Build

- **Severity**: High
- **Environment**: CI (Deploy Docs workflow on main)
- **Frequency**: Every push to main since studio v3.0.0 rename

### Description
`packages/web/src/components/RecipeExplorer.tsx` imports `RecipeViewer` from
`@sweny-ai/studio/viewer`, but this export was renamed to `WorkflowViewer` in studio v3.0.0.
Rollup cannot resolve the import and the Deploy Docs build fails with exit code 1.

### Evidence
```
[ERROR] [vite] ✗ Build failed in 2.11s
src/components/RecipeExplorer.tsx (2:9): "RecipeViewer" is not exported by
"../studio/dist-lib/viewer.js", imported by "src/components/RecipeExplorer.tsx".

file: /home/runner/work/sweny/sweny/packages/web/src/components/RecipeExplorer.tsx:2:9
  1: import { useState, useRef, useCallback, useEffect } from "react";
  2: import { RecipeViewer } from "@sweny-ai/studio/viewer";
              ^
```
Run ID: 23204701005, Job: build (67436666701)

### Root Cause Analysis
Studio v3.0.0 renamed `RecipeViewer` → `WorkflowViewer` (breaking change documented in
CHANGELOG.md). The `packages/web` package was not updated when this rename happened.
`lib-viewer.ts` now exports only `WorkflowViewer`.

### Impact
- Deploy Docs workflow fails on every push to main.
- Documentation site cannot be rebuilt or deployed.
- The `packages/web` SPA (RecipeExplorer page) is broken at build time.

### Suggested Fix
In `packages/web/src/components/RecipeExplorer.tsx`:
1. Line 2: Change `import { RecipeViewer }` to `import { WorkflowViewer }`
2. Line 1179: Change `<RecipeViewer` to `<WorkflowViewer`

### Files to Modify
- `packages/web/src/components/RecipeExplorer.tsx`

### Confidence Level
High — the rename in studio is documented, the old symbol provably does not exist in
`dist-lib/viewer.js`, and the props interface is identical.

### GitHub Issues Status
No existing GitHub Issues issue found — New issue will be created.

---

## Issue 2: Prettier Format Violations Break CI on Main (Known Issue)

- **Severity**: Medium
- **Environment**: CI (main branch)
- **Frequency**: Every push to main

### Description
`npm run format:check` fails on three files with prettier violations.
Files: `packages/action/tests/mapToTriageConfig.test.ts`,
`packages/providers/src/coding-agent/claude-code.ts`,
`packages/providers/src/coding-agent/google-gemini.ts`

### GitHub Issues Status
**Existing issue #65** — already tracked. PR #66 closed as failed attempt.
→ No new issue or fix proposed for this. Recommend +1 on issue #65.
