# Task 04: Migrate Studio Lib Functions + Export Code

## Why
Studio has library functions for export (TypeScript, YAML, GitHub Actions), layout (ELK), and permalink generation. These all use old engine types and need to use core types.

## What to do

### export-typescript.ts
- Replace with call to `exportAsTypescript()` from `@sweny-ai/core/studio`
- Or rewrite to generate `import type { Workflow } from "@sweny-ai/core"` instead of `@sweny-ai/engine`

### export-yaml.ts
- Remove `WORKFLOW_YAML_SCHEMA_HEADER` import from engine
- Write a new YAML header for core workflow schema
- Serialize `Workflow` type (nodes/edges) instead of old format

### export-github-actions.ts
- Update type imports `WorkflowDefinition` → `Workflow`

### layout/elk.ts
- Change `WorkflowDefinition` → `Workflow` type
- Update node creation to use `workflowToFlow()` output instead of custom conversion

### permalink.ts
- Update `WorkflowDefinition` → `Workflow`
- Update `validateWorkflow` import

### simulate-runner.ts
- Update types: `StepResult` → `NodeResult`, `WorkflowDefinition` → `Workflow`
- Or remove if SimulationPanel now uses `execute()` directly

## Files to modify
- `packages/studio/src/lib/export-typescript.ts` (REWRITE)
- `packages/studio/src/lib/export-yaml.ts` (UPDATE)
- `packages/studio/src/lib/export-github-actions.ts` (UPDATE)
- `packages/studio/src/layout/elk.ts` (UPDATE)
- `packages/studio/src/lib/permalink.ts` (UPDATE)
- `packages/studio/src/lib/simulate-runner.ts` (UPDATE or DELETE)

## Acceptance criteria
- All lib functions work with `Workflow` type from core
- Export generates correct `@sweny-ai/core` imports
- `npx tsc --noEmit` passes
