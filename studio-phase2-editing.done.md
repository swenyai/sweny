# Task: Studio Phase 2 — Node/Edge Editing with Undo/Redo

## Prerequisites
All three of these must be `.done.md` before you start:
- `engine-definition-source-of-truth.done.md`
- `studio-fixes.done.md`
- `engine-json-schema.done.md`

## Goal
Add full editing capability to the studio: click to inspect, edit node properties,
add/delete nodes, draw new transitions, delete transitions, and undo/redo.
This is the core of the WYSIWYG experience.

## Repo context
- Package: `packages/studio`
- Dev server: `npm run dev` inside `packages/studio`
- Typecheck: `npm run typecheck` inside `packages/studio`

## Architecture overview

Use **Zustand** for the editor store — it's the standard for React Flow state management.
Use **Immer** middleware for immutable state updates (makes reducer logic clean).

The store holds the current `RecipeDefinition` being edited, the React Flow
nodes/edges for display, selected element, and undo/redo history.

```
packages/studio/src/
  store/
    editor-store.ts      ← Zustand store: definition, selection, history
  components/
    StateNode.tsx        ← (exists) add selected ring
    TransitionEdge.tsx   ← (exists) add selected/deleteable style
    PropertiesPanel.tsx  ← NEW: right sidebar showing selected element properties
    Toolbar.tsx          ← NEW: top bar with add-node, undo, redo, export buttons
  RecipeViewer.tsx       ← (exists) connect to store, add editing callbacks
  App.tsx                ← (exists) wire up store, add PropertiesPanel
```

## Step 1: Install dependencies

```bash
cd packages/studio
npm install zustand immer
```

## Step 2: Editor store

Create `packages/studio/src/store/editor-store.ts`:

```typescript
import { create } from "zustand";
import { temporal } from "zundo"; // for undo/redo
import { immer } from "zustand/middleware/immer";
```

Wait — use **zundo** for temporal (undo/redo) middleware with zustand. Install it:
```bash
npm install zundo
```

The store shape:

```typescript
import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import type { RecipeDefinition, StateDefinition, WorkflowPhase } from "@sweny-ai/engine";

export type Selection =
  | { type: "state"; id: string }
  | { type: "edge"; id: string; source: string; target: string; outcome: string }
  | null;

interface EditorState {
  definition: RecipeDefinition;
  selection: Selection;

  // Actions — all mutate `definition`
  setDefinition(def: RecipeDefinition): void;
  selectState(id: string): void;
  selectEdge(id: string, source: string, target: string, outcome: string): void;
  clearSelection(): void;

  updateState(id: string, patch: Partial<StateDefinition>): void;
  addState(id: string, phase: WorkflowPhase): void;
  deleteState(id: string): void;

  addTransition(sourceId: string, outcome: string, targetId: string): void;
  updateTransitionOutcome(sourceId: string, oldOutcome: string, newOutcome: string): void;
  deleteTransition(sourceId: string, outcome: string): void;

  setInitial(id: string): void;
}
```

Implement each action using Immer draft mutations on `state.definition`.

Key rules:
- `deleteState(id)`: remove the state AND remove any `on` values / `next` that point to it
  (to avoid dangling references). Also clear `initial` if the deleted state was initial.
- `addState(id, phase)`: add `{ phase }` to `states`. Validate `id` is unique.
- `deleteTransition(sourceId, outcome)`: if `outcome === "→"` (the next label), delete `state.next`.
  Otherwise delete `state.on[outcome]`.
- `updateState(id, patch)`: merge patch into the existing state definition.
- All mutations validate input (don't allow empty ids, etc.).

For undo/redo, wrap the store with `temporal` from `zundo`:
```typescript
export const useEditorStore = create<EditorState>()(
  temporal(
    immer((set) => ({
      // ... implementation
    }))
  )
);

// Expose undo/redo
export const useTemporalStore = () => useEditorStore.temporal;
```

## Step 3: Properties panel

Create `packages/studio/src/components/PropertiesPanel.tsx`:

When a **state** is selected, show:
- State id (read-only — ids are structural, changing them would break all references)
- Phase selector: dropdown with "learn" / "act" / "report"
- Critical toggle: checkbox
- Description: text input (optional)
- Next: text input showing the `next` target (or empty)
- On transitions list: each entry shows `[outcome key]` → `[target id]` with a delete button
- "Set as initial" button (disabled if already initial)
- "Delete state" button (red, confirms with a window.confirm or inline confirmation)
- "Add transition" form: outcome key input + target dropdown (list of state ids) + Add button

When an **edge** is selected, show:
- Source state id (read-only)
- Outcome key: editable input (shows current key, saves on blur/enter)
- Target state: dropdown of all state ids
- "Delete transition" button (red)

When **nothing** is selected, show:
- Recipe name (editable)
- Recipe description (editable textarea)
- Recipe version (editable)
- "Add state" button that opens an inline form: id input + phase selector + Add button

Style: fixed right sidebar, `w-72`, white background, border-l, overflow-y-auto.

## Step 4: Toolbar

Create `packages/studio/src/components/Toolbar.tsx`:

```tsx
import { useEditorStore, useTemporalStore } from "../store/editor-store.js";

export function Toolbar() {
  const { undo, redo, pastStates, futureStates } = useTemporalStore().getState();
  const definition = useEditorStore((s) => s.definition);

  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  function handleExport() {
    const json = JSON.stringify(definition, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${definition.id}.recipe.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700">
      <span className="font-bold text-white mr-2">sweny studio</span>
      <button onClick={() => undo()} disabled={!canUndo} className="...">↩ Undo</button>
      <button onClick={() => redo()} disabled={!canRedo} className="...">↪ Redo</button>
      <div className="flex-1" />
      <button onClick={handleExport} className="...">⬇ Export JSON</button>
    </div>
  );
}
```

## Step 5: Connect ReactFlow to the store

Update `packages/studio/src/RecipeViewer.tsx`:

- Read `definition` from the store instead of accepting it as a prop
- On node click: call `selectState(node.id)`
- On edge click: call `selectEdge(edge.id, edge.source, edge.target, edge.data.label)`
- On pane click (canvas background): call `clearSelection()`
- On connection (drag from handle to another node): call `addTransition(source, "success", target)` as default — user can rename in properties panel
- Keep the ELK re-layout in a `useEffect` that watches `definition`

```tsx
import { useEditorStore } from "./store/editor-store.js";

export function RecipeViewer() {
  const { definition, selection, selectState, selectEdge, clearSelection, addTransition } = useEditorStore();
  // ... rest of layout logic
}
```

Note: `RecipeViewer` no longer takes `definition` as a prop — it reads from the store.
Update `App.tsx` accordingly. The app should initialize the store with `triageDefinition` on mount.

## Step 6: Update App.tsx

```tsx
import { useEffect } from "react";
import { triageDefinition, implementDefinition } from "@sweny-ai/engine";
import { RecipeViewer } from "./RecipeViewer.js";
import { PropertiesPanel } from "./components/PropertiesPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import { useEditorStore } from "./store/editor-store.js";
import type { RecipeDefinition } from "@sweny-ai/engine";

const PRESET_RECIPES: Record<string, RecipeDefinition> = {
  triage: triageDefinition,
  implement: implementDefinition,
};

export function App() {
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const [activePreset, setActivePreset] = useState("triage");

  useEffect(() => {
    setDefinition(PRESET_RECIPES[activePreset]!);
  }, [activePreset]);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <Toolbar presets={Object.keys(PRESET_RECIPES)} activePreset={activePreset} onPresetChange={setActivePreset} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1 }}>
          <RecipeViewer />
        </div>
        <PropertiesPanel />
      </div>
    </div>
  );
}
```

## Step 7: Visual feedback for selection

Update `StateNode.tsx` to show a highlighted ring when selected:
- React Flow sets `selected: boolean` on node props — use it
- Add a `ring-2 ring-blue-500` class when selected

Update `TransitionEdge.tsx` to show a highlighted color when selected and a delete affordance on hover.

## Implementation notes

- Use `zundo`'s `partialize` option to only track `definition` in the undo history (not `selection`):
  ```typescript
  temporal(immer(...), { partialize: (state) => ({ definition: state.definition }) })
  ```
- When deleting a state, also check if it is `initial` — if so, set `initial` to the first remaining state id or empty string
- The `addTransition` from a ReactFlow connection event gives `{ source, target }` but no outcome — default to `"success"` and let the user edit it in the properties panel
- Don't re-layout on every keystroke in the properties panel — debounce or only re-layout on structural changes (add/delete node, add/delete edge)
- Apply ELK layout only when nodes are added/removed; position edits don't need re-layout

## Success criteria
1. Click a state node → properties panel shows its phase, critical, description, next, on transitions
2. Edit phase → graph node's badge updates immediately
3. Add a new state via the properties panel → node appears on canvas with ELK re-layout
4. Delete a state → node disappears, dangling `on`/`next` references are cleaned up
5. Drag from a node's source handle to another node → a new "success" transition edge is created
6. Click an edge → properties panel shows source, outcome, target; outcome is editable
7. Undo/redo buttons work for every edit operation
8. Export JSON button downloads a valid `{recipe-id}.recipe.json` file
9. `npm run typecheck` passes — no `any` types in new code
10. No console errors during normal use

## Commit when done
```
git add packages/studio/
git commit -m "feat(studio): Phase 2 — node/edge editing, properties panel, undo/redo, JSON export"
```
Then rename: `mv studio-phase2-editing.todo.md studio-phase2-editing.done.md`
