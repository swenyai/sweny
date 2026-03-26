# Task 02: Migrate Studio Store + Types from @sweny-ai/engine to @sweny-ai/core

## Why
Studio currently imports all types and functions from `@sweny-ai/engine`. The new core package has different types: `Workflow` (not `WorkflowDefinition`), `Node` (not `StepDefinition`), `Edge` (not transitions), skills (not phases/uses). The store is the heart of Studio — it must be rewritten for the new model.

## Context
- Old model: `WorkflowDefinition` → `steps: Record<string, StepDefinition>` with `phase`, `uses`, `next`, `on`
- New model: `Workflow` → `nodes: Record<string, Node>` with `instruction`, `skills[]`, explicit `edges[]`
- `packages/core/src/studio.ts` provides adapter functions: `workflowToFlow()`, `flowToWorkflow()`, `applyExecutionEvent()`, `getSkillCatalog()`
- `packages/core/src/studio.ts` defines `FlowNode`, `SkillNodeData`, `FlowEdge` types

## What to do

### 1. Rewrite `packages/studio/src/store/editor-store.ts`
- Replace imports: `@sweny-ai/engine` → `@sweny-ai/core/browser` for types, `@sweny-ai/core/studio` for adapter functions
- Change state shape:
  - `definition: WorkflowDefinition` → `workflow: Workflow`
  - Remove `WorkflowPhase` references
  - `ExecutionEvent` → same name but from core types
  - `StepResult` → `NodeResult`
- Import `triageWorkflow` from `@sweny-ai/core/workflows` as default
- Use `workflowToFlow()` and `flowToWorkflow()` from `@sweny-ai/core/studio`
- Use `applyExecutionEvent()` from `@sweny-ai/core/studio` instead of custom event handling
- Use `getSkillCatalog()` for skill browsing

### 2. Update all type imports across 19 files
Every file that imports from `@sweny-ai/engine` needs to switch:
- `WorkflowDefinition` → `Workflow` (from `@sweny-ai/core/browser` or `@sweny-ai/core`)
- `StepDefinition` → `Node`
- `WorkflowPhase` → removed (nodes have `skills[]` not `phase`)
- `StepResult` → `NodeResult`
- `ExecutionEvent` → `ExecutionEvent` (same name, from core)
- `validateWorkflow` → `validateWorkflow` (from `@sweny-ai/core/schema`)
- `triageDefinition` / `implementDefinition` → `triageWorkflow` / `implementWorkflow` (from `@sweny-ai/core/workflows`)

### 3. Delete old conversion code
- `packages/studio/src/lib/definition-to-flow.ts` — replaced by `workflowToFlow()` from core
- `packages/studio/src/lib/step-types.ts` — `WorkflowPhase` utilities no longer needed

## Files to modify
- `packages/studio/src/store/editor-store.ts` (REWRITE)
- `packages/studio/src/lib/definition-to-flow.ts` (DELETE)
- `packages/studio/src/lib/step-types.ts` (DELETE)
- All 19 files with `@sweny-ai/engine` imports (UPDATE imports)

## Acceptance criteria
- Zero imports from `@sweny-ai/engine` in packages/studio
- Store uses `Workflow` type from core
- TypeScript compiles (may have component errors — those are Task 03)
