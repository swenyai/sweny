---
"@sweny-ai/studio": major
---

Migrate from @sweny-ai/engine to @sweny-ai/core skills+DAG architecture.

Breaking changes:
- Peer dependency changed: `@sweny-ai/engine` → `@sweny-ai/core`
- WorkflowViewer prop: `definition` → `workflow`
- Editor store: `definition` → `workflow`, `currentStepId` → `currentNodeId`, `completedSteps` → `completedNodes`
- Node types: `stateNode` → `skillNode`, edges: `transitionEdge` → `conditionEdge`
- Removed: phase-based step types, outcome-based routing
- Added: skill badges, instruction editor, natural-language edge conditions
