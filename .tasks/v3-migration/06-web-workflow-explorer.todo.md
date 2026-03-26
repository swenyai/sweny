# Task 06: Rewrite WorkflowExplorer.tsx for Core Types

## Why
The docs site embeds Studio's `WorkflowViewer` component with built-in workflows. It currently imports `triageDefinition` and `implementDefinition` from `@sweny-ai/engine/browser`. These need to come from `@sweny-ai/core`.

## What to do

### WorkflowExplorer.tsx
- Change imports:
  - `@sweny-ai/engine/browser` → `@sweny-ai/core/browser` (or `@sweny-ai/core/workflows`)
  - `triageDefinition` → `triageWorkflow`
  - `implementDefinition` → `implementWorkflow`
  - `WorkflowDefinition` → `Workflow`
  - `StepDefinition` → `Node`
- `@sweny-ai/studio/viewer` import stays (Studio's viewer component is the same)
- Update any prop types or component usage for new model

### package.json
- Add `@sweny-ai/core` dependency (or verify it's already there)
- Remove `@sweny-ai/engine` if only used via WorkflowExplorer

### Astro/Vite config
- If astro.config.mjs has aliases for `@sweny-ai/engine`, update to `@sweny-ai/core`

## Files to modify
- `packages/web/src/components/WorkflowExplorer.tsx` (REWRITE)
- `packages/web/package.json` (EDIT deps)
- `packages/web/astro.config.mjs` (CHECK for engine aliases)

## Acceptance criteria
- WorkflowExplorer renders triage and implement workflows from core
- No imports from `@sweny-ai/engine` in packages/web
- `npm run build` succeeds in packages/web (or at least TypeScript compiles)
