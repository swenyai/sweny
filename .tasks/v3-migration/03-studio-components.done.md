# Task 03: Migrate Studio Components for New Core Model

## Why
With the store migrated (Task 02), components need to render the new data model. The biggest changes: StateNode shows skills instead of phases, PropertiesPanel edits instructions + skill toggles instead of phase/uses, SimulationPanel calls `execute()` instead of `runWorkflow()`.

## What to do

### StateNode.tsx
- Remove phase-based accent colors (learn=blue, act=yellow, report=green)
- Replace with skill-based rendering: show skill badges (e.g., "GitHub", "Sentry")
- Node title = `node.name`, subtitle = truncated `node.instruction`
- Entry node gets a distinct marker (e.g., play icon or "Entry" badge)
- Terminal nodes get an end marker
- Execution status styling stays the same (running=blue glow, success=green, failed=red)
- Use `SkillNodeData` from `@sweny-ai/core/studio` instead of old node data type

### PropertiesPanel.tsx
- Step editing → Node editing:
  - Name field (editable)
  - Instruction field (multiline textarea, this is the key new field)
  - Skills toggle list (from `getSkillCatalog()`)
  - Output schema editor (optional JSON schema)
  - Remove: phase selector, type field, uses field, critical flag
- Edge editing:
  - `when` condition (free text) instead of outcome/target dropdowns
  - Source/target display
- Workflow meta: id, name, description, entry node selector

### SimulationPanel.tsx
- Replace `createWorkflow()` + `runWorkflow()` + `createProviderRegistry()` with `execute()` from core
- Pass `observer` callback that calls `applyExecutionEvent()` on the store
- For simulation without real Claude: use `MockClaude` from `@sweny-ai/core/testing`
- Remove StepLatch manual-step logic (execute() handles flow automatically)

### WorkflowViewer.tsx
- Use `workflowToFlow()` from `@sweny-ai/core/studio` instead of `definitionToFlow()`
- Use `validateWorkflow()` from `@sweny-ai/core/schema`
- Update node/edge type registrations for new `skillNode` / `conditionEdge` types

### Other components
- `DropOverlay.tsx` → update `validateWorkflow` import
- `ImportModal.tsx` → update `validateWorkflow` import, parse as `Workflow` not `WorkflowDefinition`
- `Toolbar.tsx` → remove `WorkflowPhase` references
- `LiveConnectPanel.tsx` → update event types
- `StandaloneViewer.tsx` → update `WorkflowDefinition` → `Workflow`

## Files to modify
- `packages/studio/src/components/StateNode.tsx` (REWRITE)
- `packages/studio/src/components/PropertiesPanel.tsx` (REWRITE)
- `packages/studio/src/components/SimulationPanel.tsx` (REWRITE)
- `packages/studio/src/WorkflowViewer.tsx` (UPDATE)
- `packages/studio/src/components/DropOverlay.tsx` (UPDATE)
- `packages/studio/src/components/ImportModal.tsx` (UPDATE)
- `packages/studio/src/components/Toolbar.tsx` (UPDATE)
- `packages/studio/src/components/LiveConnectPanel.tsx` (UPDATE)
- `packages/studio/src/components/StandaloneViewer.tsx` (UPDATE)
- `packages/studio/src/App.tsx` (UPDATE)

## Acceptance criteria
- All components render the new Workflow model
- No references to phases, uses, next, on, StepDefinition
- `npx tsc --noEmit` passes in packages/studio
