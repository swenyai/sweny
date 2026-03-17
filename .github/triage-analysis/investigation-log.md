# Investigation Log — 2026-03-17

## Approach
Direct run (no issue override). Followed additional instructions to investigate CI failures
in `/tmp/ci-failures.json`, then look holistically for the highest-value fix.

## Step 1 — Parse CI failure log

Read `/tmp/ci-failures.json`. Failures observed (2026-03-17):

| Workflow | Branch | Run ID |
|----------|--------|--------|
| Deploy Docs | main | 23204701005 |
| Post-Release Docs Update | v3 | 23203365068 |
| CI (×3) | dependabot/npm_and_yarn/types/react-dom-19.2.3 | various |
| Release | main | 23200577502 |
| CI (×4) | various dependabot branches | various |
| CI (×2) | main | 23199604384, 23199468449 |
| Continuous Improvement | main | 23195412282 |
| CI | main | 23195029818 |

## Step 2 — Get job-level failure details via GitHub API

```
GET /repos/swenyai/sweny/actions/runs/23199604384/jobs
```

Results:
- **Format** job → FAILURE: `Run npm run format:check`
  - Files flagged: `packages/action/tests/mapToTriageConfig.test.ts`,
    `packages/providers/src/coding-agent/claude-code.ts`,
    `packages/providers/src/coding-agent/google-gemini.ts`
- All other CI jobs (Typecheck, Lint, Test Node 20, Test Node 22) → SUCCESS

```
GET /repos/swenyai/sweny/actions/runs/23204701005/jobs
```

Results:
- **build** job → FAILURE: `Build site`
  - Error: `"RecipeViewer" is not exported by "../studio/dist-lib/viewer.js"`
  - File: `packages/web/src/components/RecipeExplorer.tsx:2:9`

## Step 3 — Cross-reference with known issues

- **Format violations**: Already tracked as issue #65 / PR #66 (closed failed attempt).
  → SKIP per instructions.
- **RecipeViewer not exported**: No existing issue found. NEW.

## Step 4 — Root cause analysis for RecipeViewer

Searched `RecipeViewer` across the codebase:
- `packages/studio/CHANGELOG.md` confirms: in studio v3.0.0 (major release),
  `RecipeViewer` was renamed to `WorkflowViewer` as a breaking change:
  > "Breaking: Studio public exports renamed to workflow terminology.
  > RecipeViewer → WorkflowViewer"
- `packages/studio/src/lib-viewer.ts` exports only `WorkflowViewer` (confirmed by read).
- `packages/web/src/components/RecipeExplorer.tsx` still imports `RecipeViewer` at line 2
  and uses `<RecipeViewer` at line 1179.

**Root cause**: `RecipeExplorer.tsx` was not updated when studio's public API was renamed
in v3.0.0. The import references a symbol that no longer exists in `dist-lib/viewer.js`.

## Step 5 — Proposed fix

Update `RecipeExplorer.tsx`:
1. Line 2: `import { RecipeViewer }` → `import { WorkflowViewer }`
2. Line 1179: `<RecipeViewer` → `<WorkflowViewer`
   (JSX is self-closing, so no closing tag needs updating)

The `WorkflowViewer` props interface (`definition`, `executionState`, `height`, `onNodeClick`)
is fully compatible with how `RecipeViewer` was used — same props, same behavior.

## Step 6 — Scope and risk

- Change is entirely in `packages/web` (private, non-published package).
- No changeset required (per CLAUDE.md: web is private).
- No type or API surface changes; purely a name update.
- Low risk: straightforward rename, TypeScript will catch regressions.
