---
"@sweny-ai/studio": major
"@sweny-ai/cli": patch
---

**Breaking**: Studio public exports renamed to workflow terminology.

- `RecipeViewer` → `WorkflowViewer`
- `RecipeViewerProps` → `WorkflowViewerProps`
- Studio now listens for `workflow:start`, `step:enter`, `step:exit`, `workflow:end` events (matching engine v2)
- Internal store fields: `currentStepId`, `completedSteps`, `updateWorkflowMeta`

CLI: updated to use `runWorkflow`, `triageWorkflow`, `implementWorkflow` from engine (no user-facing change).
