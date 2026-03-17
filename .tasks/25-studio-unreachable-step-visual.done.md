# Task 25 — Studio: visual indicator for unreachable steps

## Goal

`validateWorkflow()` now detects unreachable steps (`UNREACHABLE_STEP` error
code), but the Studio only shows a count of validation errors in the top banner
without making it clear WHICH nodes are unreachable. Add visual feedback:
- Unreachable nodes should display with a distinct style (dashed border, warning icon)
- Clicking the banner error should scroll to / select the affected step
- The PropertiesPanel should show a warning when the selected step is unreachable

This is a **product quality** feature: users need to know why a step is
disconnected when building custom workflows.

## Context

- **`packages/engine/src/validate.ts`** — Already emits `{ code: "UNREACHABLE_STEP", stateId: stepId }` errors
- **`packages/studio/src/components/StateNode.tsx`** — The node component; `StateNodeData` should include an `isUnreachable?: boolean` flag
- **`packages/studio/src/WorkflowViewer.tsx`** — Where nodes are built from the definition; `annotateEdgesWithErrors` pattern already exists for edges. Add similar annotation for nodes.
- **`packages/studio/src/App.tsx`** — The validation error banner. Make errors clickable.

## What to implement

### 1. Add `isUnreachable` to `StateNodeData`

In `packages/studio/src/components/StateNode.tsx`, add to `StateNodeData`:

```typescript
export interface StateNodeData {
  state: StepDefinition;
  execStatus?: NodeExecStatus;
  isUnreachable?: boolean;  // ← add this
}
```

In the node's JSX, when `isUnreachable` is true:
- Apply a dashed border: `border-dashed border-orange-400`
- Show a small warning badge (⚠) in the top-right corner of the node

### 2. Annotate nodes in WorkflowViewer.tsx

After layout completes and after the definition changes, compute which steps
are unreachable and set `isUnreachable` in each node's data.

Add a helper function:

```typescript
function getUnreachableStepIds(definition: WorkflowDefinition): Set<string> {
  const errors = validateWorkflow(definition);
  return new Set(
    errors
      .filter((e) => e.code === "UNREACHABLE_STEP" && e.stateId)
      .map((e) => e.stateId!),
  );
}
```

Then in the node mapping (where `execStatus` is set), also set:
```typescript
data: {
  ...node.data,
  execStatus: ...,
  isUnreachable: unreachableIds.has(node.id),
}
```

Apply this in both the layout effect and the selection/exec sync effect.

### 3. Clickable errors in App.tsx

In the validation errors banner, make each error message clickable to select the
relevant step:

```tsx
{validationErrors.map((e) => (
  <button
    key={e.message}
    onClick={() => e.stateId ? setSelection({ kind: "step", id: e.stateId }) : undefined}
    className={`text-amber-700 text-xs ${e.stateId ? "hover:underline cursor-pointer" : ""}`}
  >
    {e.message}
  </button>
))}
```

Note: `setSelection` is in the editor store. Use `useEditorStore((s) => s.setSelection)`.

### 4. Warning in PropertiesPanel

In the `StepPanel` component in `PropertiesPanel.tsx`, check if the current step
is unreachable and show a warning near the top:

```tsx
const unreachable = useMemo(
  () => validateWorkflow(definition).some((e) => e.code === "UNREACHABLE_STEP" && e.stateId === id),
  [definition, id],
);
// ...
{unreachable && (
  <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs text-orange-700 mb-2">
    ⚠ This step is unreachable from the initial step. Add a transition pointing to it.
  </div>
)}
```

## Changeset

```md
---
"@sweny-ai/studio": minor
---
Unreachable steps are now visually highlighted in the workflow graph with a
dashed orange border and warning badge. Clicking a validation error in the
banner selects the affected step. The properties panel shows an actionable
warning for unreachable steps.
```

## Done when

- [ ] `isUnreachable?: boolean` in `StateNodeData`
- [ ] Unreachable node visual (dashed border + ⚠ badge) in `StateNode.tsx`
- [ ] Node annotation in `WorkflowViewer.tsx`
- [ ] Clickable errors in `App.tsx` banner
- [ ] Warning in `PropertiesPanel.tsx` when step is unreachable
- [ ] `npx tsc --noEmit` passes in `packages/studio`
- [ ] Changeset created
