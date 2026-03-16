# Task 11 — PropertiesPanel: EdgePanel and WorkflowMetaPanel readOnly enforcement

## Goal

`PropertiesPanel` already disables `StepPanel` inputs in simulate/live mode, but
two other sub-panels — `EdgePanel` and `WorkflowMetaPanel` — have no `readOnly`
guard at all. During a simulation a user can click an edge or de-select a step
and freely edit transitions or workflow metadata, mutating the definition that
is actively being observed. This is a data integrity bug.

## Background

**Where `readOnly` is computed**: `PropertiesPanel()` at line ~23:
```typescript
const readOnly = mode !== "design";
```

**What already works**: `StepPanel` receives `readOnly` and disables all inputs.

**What is broken**:
- `EdgePanel` (selected when `selection?.kind === "edge"`) — no `readOnly` prop;
  outcome input, target select, and "Delete transition" button are always editable.
- `WorkflowMetaPanel` (shown when nothing is selected) — no `readOnly` prop;
  name input, description textarea, and version input are always editable.

## What to build

### 1. `EdgePanel` — add `readOnly` prop

**In `EdgePanelProps` interface** (`packages/studio/src/components/PropertiesPanel.tsx`):
```typescript
interface EdgePanelProps {
  // ... existing ...
  readOnly: boolean;
}
```

**In `EdgePanel` function signature**:
```typescript
function EdgePanel({
  source,
  outcome,
  currentTarget,
  stepIds,
  updateTransitionOutcome,
  updateTransitionTarget,
  deleteTransition,
  readOnly,
}: EdgePanelProps) {
```

**Outcome input** — add `disabled` + styling:
```tsx
<input
  className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
  value={editOutcome}
  onChange={(e) => setEditOutcome(e.target.value)}
  onBlur={() => { ... }}
  disabled={readOnly}
/>
```

**Target select** — add `disabled` + styling:
```tsx
<select
  className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
  value={currentTarget}
  onChange={(e) => updateTransitionTarget(source, outcome, e.target.value)}
  disabled={readOnly}
>
```

**Delete transition button** — hide when `readOnly`:
```tsx
{!readOnly && (
  <div className="mt-4 pt-4 border-t border-gray-200">
    <button onClick={...}>Delete transition</button>
  </div>
)}
```

**Pass `readOnly` from `PropertiesPanel`** (line ~68):
```tsx
<EdgePanel
  key={`${source}--${outcome}`}
  source={source}
  outcome={outcome}
  currentTarget={currentTarget}
  stepIds={stepIds}
  readOnly={readOnly}
  updateTransitionOutcome={updateTransitionOutcome}
  updateTransitionTarget={updateTransitionTarget}
  deleteTransition={(src, out) => {
    deleteTransition(src, out);
    setSelection(null);
  }}
/>
```

### 2. `WorkflowMetaPanel` — add `readOnly` prop

**In `WorkflowMetaPanelProps` interface**:
```typescript
interface WorkflowMetaPanelProps {
  definition: ...;
  updateWorkflowMeta: ...;
  readOnly: boolean;
}
```

**In `WorkflowMetaPanel` function** — destructure `readOnly` and disable all inputs:
```tsx
function WorkflowMetaPanel({ definition, updateWorkflowMeta, readOnly }) {
  ...
  // Name input:
  <input
    className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
    ...
    disabled={readOnly}
  />
  // Description textarea:
  <textarea
    className={`w-full border border-gray-300 rounded px-2 py-1 text-sm resize-none ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
    ...
    disabled={readOnly}
  />
  // Version input:
  <input
    className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
    ...
    disabled={readOnly}
  />
}
```

**Pass `readOnly` from `PropertiesPanel`** (line ~85):
```tsx
return <WorkflowMetaPanel definition={definition} updateWorkflowMeta={updateWorkflowMeta} readOnly={readOnly} />;
```

## Files to touch

- `packages/studio/src/components/PropertiesPanel.tsx` — the only file

## Changeset

Create `.changeset/properties-panel-readonly-completeness.md`:
```md
---
"@sweny-ai/studio": patch
---

EdgePanel and WorkflowMetaPanel are now read-only in simulate/live mode.
Previously, clicking an edge or de-selecting a node in simulate/live mode
allowed editing transitions and workflow metadata while a run was in progress.
```

## Done criteria

- In simulate/live mode, clicking an edge shows the EdgePanel with disabled
  inputs and no "Delete transition" button
- In simulate/live mode, de-selecting a node shows WorkflowMetaPanel with
  disabled name/description/version inputs
- `npm run typecheck --workspace packages/studio` clean
- No regressions in design mode (all inputs still work normally)
