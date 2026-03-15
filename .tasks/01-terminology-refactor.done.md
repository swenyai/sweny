# Task 01: Finish Terminology Refactor — Studio + Action

## Context

The engine (`@sweny-ai/engine`) is already fully renamed to workflow terminology:
- Public API: `runWorkflow`, `createWorkflow`, `WorkflowDefinition`, `StepDefinition`, `Workflow<T>`
- Event strings: `workflow:start`, `step:enter`, `step:exit`, `workflow:end`
- `StepDefinition.uses?: string[]` — already exists
- `WorkflowConfigError` — already exported

**What's still broken:**
- Studio still imports `RecipeDefinition`, `StateDefinition` and listens for `recipe:start`, `state:enter` etc.
- Action config still has `recipe: "triage" | "implement"` field

The existing `.tasks/workflow-refactor.md` documents the full original plan — reference it for details.

---

## Part 1 — Studio

### `packages/studio/src/store/editor-store.ts`

**Type imports (line 4):** Change:
```ts
import type { RecipeDefinition, StateDefinition, WorkflowPhase, ExecutionEvent, StepResult } from "@sweny-ai/engine";
```
To:
```ts
import type { WorkflowDefinition, StepDefinition, WorkflowPhase, ExecutionEvent, StepResult } from "@sweny-ai/engine";
```

**Event strings in `applyEvent()` (~line 84):** Change:
- `"recipe:start"` → `"workflow:start"`
- `"state:enter"` → `"step:enter"`
- `"state:exit"` → `"step:exit"`
- `"recipe:end"` → `"workflow:end"`

**Event field access:** When handling `step:enter`/`step:exit`, the field is `stepId` (not `stateId`).

**Internal state names:** Rename throughout the store:
- `currentStateId` → `currentStepId`
- `completedStates` → `completedSteps`
- `updateRecipeMeta` → `updateWorkflowMeta`

**Type annotations:**
- `definition: RecipeDefinition` → `WorkflowDefinition`
- `updateState(id, patch: Partial<StateDefinition>)` → `Partial<StepDefinition>`
- `Selection.kind: "state"` → `"step"` (the UI selection type)
- `setDefinition(def: RecipeDefinition)` → `WorkflowDefinition`

### `packages/studio/src/components/SimulationPanel.tsx`

Imports `createRecipe`, `runRecipe` from `@sweny-ai/engine` (or similar) — change to `createWorkflow`, `runWorkflow`.
Event strings in simulation: `recipe:start`, `state:enter`, etc. — update to match new engine strings.

### `packages/studio/src/components/PropertiesPanel.tsx`

Look for "recipe meta" label/comment → change to "workflow meta". Any `RecipeDefinition` type usage → `WorkflowDefinition`.

### `packages/studio/src/components/Toolbar.tsx`

File naming: `.recipe.json` → `.workflow.json` (used when exporting/downloading a recipe file).

### `packages/studio/src/components/DropOverlay.tsx`

Drop hint text: "Drop `.recipe.json` to import" → "Drop `.workflow.json` to import".

### `packages/studio/src/components/ImportModal.tsx`

Placeholder text "Paste recipe JSON" → "Paste workflow JSON".

### `packages/studio/src/lib/permalink.ts`

Comments referencing "recipe" → "workflow".

### `packages/studio/src/lib/export-typescript.ts`

Any generated code that references `RecipeDefinition` type or "recipe" in comments/strings → update.

### `packages/studio/src/App.tsx`

Any "recipe" references in variable names or comments → update.

### `packages/studio/src/lib-viewer.ts` and `lib-editor.ts`

Rename exports:
- `RecipeViewer` → `WorkflowViewer`
- `RecipeViewerProps` → `WorkflowViewerProps`

### `packages/studio/src/components/StandaloneViewer.tsx`

Component is exported as `RecipeViewer` — rename component and exported types to `WorkflowViewer` / `WorkflowViewerProps`.

---

## Part 2 — CLI

### `packages/cli/src/main.ts`

**Line 10 import:** Change:
```ts
import { runRecipe, triageRecipe, implementRecipe, createProviderRegistry } from "@sweny-ai/engine";
```
To:
```ts
import { runWorkflow, triageWorkflow, implementWorkflow, createProviderRegistry } from "@sweny-ai/engine";
```

**Line 108:** Change:
```ts
const totalSteps = Object.keys(triageRecipe.definition.states).length;
```
To:
```ts
const totalSteps = Object.keys(triageWorkflow.definition.steps).length;
```

**Line 200:** `runRecipe(triageRecipe, ...)` → `runWorkflow(triageWorkflow, ...)`

**Line 303:** `runRecipe(implementRecipe, ...)` → `runWorkflow(implementWorkflow, ...)`

Search for any other occurrences of `triageRecipe`, `implementRecipe`, `runRecipe` in cli tests and update.

---

## Part 4 — Action Config

### `packages/action/src/config.ts`

Change interface field:
```ts
// Before:
recipe: "triage" | "implement";

// After:
workflow: "triage" | "implement";
```

Update `parseInputs()`: reads from `recipe` action input → `workflow` input.
Update `validateInputs()`: any references to `config.recipe` → `config.workflow`.

### `packages/action/action.yml`

Rename input:
```yaml
# Before:
recipe:
  description: "Which recipe to run"

# After:
workflow:
  description: "Which workflow to run"
```

### `packages/action/src/main.ts`

Change `config.recipe === "implement"` → `config.workflow === "implement"`.

### `packages/action/tests/config.test.ts` and `tests/main.test.ts`

Replace all `recipe: "triage"` → `workflow: "triage"` and `recipe: "implement"` → `workflow: "implement"`.

---

## Part 3 — Changeset

Create `.changeset/finish-terminology-rename.md`:

```md
---
"@sweny-ai/studio": major
"@sweny-ai/action": patch
---

**Breaking**: Studio public exports renamed to workflow terminology.

- `RecipeViewer` → `WorkflowViewer`
- `RecipeViewerProps` → `WorkflowViewerProps`
- Studio now listens for `workflow:start`, `step:enter`, `step:exit`, `workflow:end` events (matching engine v2)
- Internal store fields: `currentStepId`, `completedSteps`, `updateWorkflowMeta`

Action: `recipe` input renamed to `workflow` (update your workflow YAML files accordingly).
```

---

## Done Criteria

- [ ] `npm run typecheck` passes in `packages/studio`, `packages/action`
- [ ] `npm test` passes in `packages/studio`, `packages/action`
- [ ] No occurrence of `RecipeDefinition`, `StateDefinition`, `recipe:start`, `state:enter`, `state:exit`, `recipe:end` in studio source files
- [ ] No occurrence of `config.recipe` or `recipe: "triage"` in action source files
- [ ] Changeset created
