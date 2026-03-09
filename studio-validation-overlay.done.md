# Task: Studio — Validation Overlay (inline error highlighting)

## Goal
Surface `validateDefinition()` errors inline during design mode:
- Broken edges (transitions to non-existent states) render as red dashed strokes
- A warning banner appears below the toolbar listing all errors when the recipe is invalid
- No changes needed when recipe is valid

## Context
- `validateDefinition` is already in `packages/engine/src/validate.ts`, exported from the browser entry
- It returns `DefinitionError[]` with `code`, `message`, `stateId?`, `targetId?`
- `UNKNOWN_TARGET` errors have `stateId` (source state) and `targetId` (the bad target)
- The studio uses ReactFlow edges — each edge has `source` (stateId) and `data.label` (outcome)

## Implementation

### 1. Extend `TransitionEdgeData` in `TransitionEdge.tsx`

Add `isError?: boolean` to the data type:
```typescript
export interface TransitionEdgeData extends Record<string, unknown> {
  label: string;  // existing
  isError?: boolean;  // NEW: true when the target state doesn't exist
}
```

In `TransitionEdge`, when `data.isError` is true:
- Make the edge path stroke `stroke="#ef4444"` (red-500) with `strokeDasharray="6 3"`
- Make the label background `bg-red-100` and text `text-red-700`
- Add a small ⚠ prefix to the label text

### 2. Annotate edges in `RecipeViewer.tsx`

After `layoutDefinition` resolves nodes and edges, annotate each edge with `isError`:

```typescript
import { validateDefinition } from "@sweny-ai/engine";

// Inside the layout useEffect, after getting edges from layoutDefinition:
const errors = validateDefinition(definition);
const unknownTargets = new Set(
  errors
    .filter((e) => e.code === "UNKNOWN_TARGET" && e.stateId && e.targetId)
    .map((e) => `${e.stateId}::${e.targetId}`)
);

// When building edges, mark broken ones:
// An edge is broken when its target (from definition.states[source].on[outcome] or .next)
// points to a state that doesn't exist and isn't "end"
// The edge key is source::target — check the definition directly:
const annotatedEdges = e.map((edge) => {
  const sourceState = definition.states[edge.source];
  const target = edge.data?.label === "→"
    ? sourceState?.next
    : sourceState?.on?.[edge.data?.label ?? ""];
  const isError = !!target && target !== "end" && !definition.states[target];
  return { ...edge, data: { ...edge.data, isError } };
});
setEdges(annotatedEdges);
```

Also re-annotate errors when definition changes WITHOUT re-running ELK, by adding a separate effect:
```typescript
useEffect(() => {
  const errors = validateDefinition(definition);
  // rebuild isError on existing edges
  setEdges(prev => prev.map(edge => {
    // same isError logic as above
  }));
}, [definition]);
```

### 3. Add validation warning banner in `App.tsx`

```tsx
import { validateDefinition } from "@sweny-ai/engine";

// In App component body:
const definition = useEditorStore((s) => s.definition);
const mode = useEditorStore((s) => s.mode);
const errors = useMemo(() => validateDefinition(definition), [definition]);

// In JSX, between <Toolbar> and the canvas area:
{mode === "design" && errors.length > 0 && (
  <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
    <span className="text-amber-600 text-xs font-medium">⚠ {errors.length} validation {errors.length === 1 ? "error" : "errors"}:</span>
    <span className="text-amber-700 text-xs">{errors.map(e => e.message).join(" · ")}</span>
  </div>
)}
```

### 4. Also disable the Simulate button when there are errors

In `Toolbar.tsx`, pass error count or read it:
```tsx
const validationErrors = useMemo(
  () => validateDefinition(definition),
  [definition]
);
// Disable mode switch to simulate if there are errors
// Or show a tooltip explaining why
```

## Files to change
- `packages/studio/src/components/TransitionEdge.tsx` — add isError to type + conditional styles
- `packages/studio/src/RecipeViewer.tsx` — annotate edges with isError after layout
- `packages/studio/src/App.tsx` — add warning banner

## Typecheck & build
Run `npm run typecheck` and `npm run build` in `packages/studio` before committing.

## Commit when done
```
git add packages/studio/src/
git commit -m "feat(studio): inline validation overlay — red edges and warning banner for broken transitions"
```
Then rename: `mv studio-validation-overlay.todo.md studio-validation-overlay.done.md`
