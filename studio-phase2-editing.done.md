# Studio Phase 2 — Editing: Properties Panel, Add/Delete, Draw Edges, Undo/Redo, Export

## Goal
Turn the read-only visualizer into a real editor. By the end of this task:
- Clicking a node opens a properties panel (right sidebar) where every field is editable
- Nodes can be added and deleted from the canvas
- Transitions can be drawn by dragging from a node's handle to another node
- Transitions can be deleted
- Every edit is undoable/redoable with Cmd+Z / Cmd+Shift+Z
- The current definition can be exported as JSON

## Repo context
- Package: `packages/studio` at `/Users/nate/src/swenyai/sweny/packages/studio`
- Dev: `npm run dev` inside `packages/studio`
- Typecheck: `npm run typecheck` inside `packages/studio`
- Build: `npm run build` inside `packages/studio`
- React 18, @xyflow/react v12, Tailwind CSS, TypeScript strict mode
- `RecipeDefinition` and `StateDefinition` types come from `@sweny-ai/engine`

## Install new dependencies first

```bash
cd packages/studio
npm install zustand immer zundo
```

- `zustand` — state management
- `immer` — immutable state updates (draft mutations)
- `zundo` — temporal middleware for undo/redo on zustand stores

## Architecture

```
src/
  store/
    editor-store.ts      ← single Zustand store with immer + zundo
  components/
    PropertiesPanel.tsx  ← right sidebar (context-sensitive)
    Toolbar.tsx          ← top bar: recipe switcher, undo/redo, export
    StateNode.tsx        ← (update) add selected ring, connectable handles
    TransitionEdge.tsx   ← (update) deleteable on click
  RecipeViewer.tsx       ← (update) connect to store, handle events
  App.tsx                ← (update) add PropertiesPanel + Toolbar layout
```

---

## Step 1: Editor store (`src/store/editor-store.ts`)

The store is the single source of truth for the current `RecipeDefinition` being edited.

```typescript
import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import type { RecipeDefinition, StateDefinition, WorkflowPhase } from "@sweny-ai/engine";

// What the user has selected on the canvas
export type Selection =
  | { kind: "state"; id: string }
  | { kind: "edge"; source: string; outcome: string }
  | null;

interface EditorState {
  definition: RecipeDefinition;
  selection: Selection;
  isLayoutStale: boolean;  // true when structure changed and ELK needs to re-run

  // Setters
  setDefinition(def: RecipeDefinition): void;
  setSelection(sel: Selection): void;

  // State mutations (all affect `definition`)
  updateRecipeMeta(patch: Partial<Pick<RecipeDefinition, "name" | "description" | "version">>): void;
  addState(id: string, phase: WorkflowPhase): void;
  deleteState(id: string): void;
  updateState(id: string, patch: Partial<StateDefinition>): void;
  setInitial(id: string): void;

  // Transition mutations
  addTransition(sourceId: string, outcome: string, targetId: string): void;
  updateTransitionOutcome(sourceId: string, oldOutcome: string, newOutcome: string): void;
  updateTransitionTarget(sourceId: string, outcome: string, newTarget: string): void;
  deleteTransition(sourceId: string, outcome: string): void;
  // "outcome === '→'" means the `next` field, not an `on` entry

  markLayoutFresh(): void;
}
```

### Implementation rules for each mutation:

**`addState(id, phase)`**:
- Validate `id` is non-empty and not already in `definition.states`
- Add `{ phase }` to `states`
- Set `isLayoutStale = true`

**`deleteState(id)`**:
- Remove the state from `states`
- Scan ALL other states' `on` map and `next`, remove any reference to `id`
- If `definition.initial === id`, set `initial` to first remaining state id (or `""` if empty)
- Set `isLayoutStale = true`
- Clear selection if the deleted state was selected

**`updateState(id, patch)`**:
- Merge `patch` into `states[id]`
- If `patch` changes `next` or `on` (structural), set `isLayoutStale = true`

**`addTransition(sourceId, outcome, targetId)`**:
- If `outcome === "→"`: set `states[sourceId].next = targetId`
- Otherwise: set `states[sourceId].on ??= {}; states[sourceId].on[outcome] = targetId`
- Set `isLayoutStale = true`

**`deleteTransition(sourceId, outcome)`**:
- If `outcome === "→"`: delete `states[sourceId].next`
- Otherwise: delete `states[sourceId].on?.[outcome]`; if `on` is now empty, delete the `on` key too
- Set `isLayoutStale = true`

**`updateTransitionOutcome(sourceId, oldOutcome, newOutcome)`**:
- Read the old target
- Delete the old key, add the new key with the same target
- If old is `"→"`, delete `next` and add `on[newOutcome] = old target`
- If new is `"→"`, delete `on[oldOutcome]` and set `next = old target`

### Undo/redo setup:

```typescript
export const useEditorStore = create<EditorState>()(
  temporal(
    immer((set) => ({
      // initial state
      definition: triageDefinition,  // import from "@sweny-ai/engine"
      selection: null,
      isLayoutStale: false,

      setDefinition: (def) => set((s) => { s.definition = def; s.isLayoutStale = true; }),
      setSelection: (sel) => set((s) => { s.selection = sel; }),
      markLayoutFresh: () => set((s) => { s.isLayoutStale = false; }),

      // ... implement all mutations using set((s) => { /* immer draft */ })
    })),
    {
      // Only track `definition` in undo history — not selection or isLayoutStale
      partialize: (state) => ({ definition: state.definition }),
    }
  )
);

// Expose the temporal API for undo/redo
export const useTemporalStore = () => useEditorStore.temporal;
```

**Important**: `selection` and `isLayoutStale` are NOT tracked in undo history (partialize excludes them).

---

## Step 2: Toolbar (`src/components/Toolbar.tsx`)

```tsx
interface ToolbarProps {
  onRecipeChange(id: string): void;
  activeRecipeId: string;
  availableRecipes: Array<{ id: string; name: string }>;
}

export function Toolbar({ onRecipeChange, activeRecipeId, availableRecipes }: ToolbarProps) {
  const { undo, redo, pastStates, futureStates } = useTemporalStore().getState();
  const definition = useEditorStore((s) => s.definition);
  const addState = useEditorStore((s) => s.addState);
  const [newStateId, setNewStateId] = useState("");
  const [newStatePhase, setNewStatePhase] = useState<WorkflowPhase>("act");

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

  function handleAddState(e: React.FormEvent) {
    e.preventDefault();
    if (!newStateId.trim()) return;
    addState(newStateId.trim(), newStatePhase);
    setNewStateId("");
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700 flex-shrink-0">
      {/* Brand */}
      <span className="font-bold text-white mr-2">sweny studio</span>

      {/* Recipe switcher */}
      <div className="flex gap-1 mr-4">
        {availableRecipes.map((r) => (
          <button
            key={r.id}
            onClick={() => onRecipeChange(r.id)}
            className={`px-3 py-1 rounded text-xs ${
              activeRecipeId === r.id
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* Undo / Redo */}
      <button
        onClick={() => undo()}
        disabled={pastStates.length === 0}
        title="Undo (Cmd+Z)"
        className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600"
      >↩</button>
      <button
        onClick={() => redo()}
        disabled={futureStates.length === 0}
        title="Redo (Cmd+Shift+Z)"
        className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600"
      >↪</button>

      <div className="flex-1" />

      {/* Add state */}
      <form onSubmit={handleAddState} className="flex gap-1">
        <input
          value={newStateId}
          onChange={(e) => setNewStateId(e.target.value)}
          placeholder="state-id"
          className="px-2 py-1 rounded bg-gray-700 text-white text-xs w-28 placeholder-gray-400"
        />
        <select
          value={newStatePhase}
          onChange={(e) => setNewStatePhase(e.target.value as WorkflowPhase)}
          className="px-1 py-1 rounded bg-gray-700 text-white text-xs"
        >
          <option value="learn">learn</option>
          <option value="act">act</option>
          <option value="report">report</option>
        </select>
        <button type="submit" className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">+ State</button>
      </form>

      {/* Export */}
      <button onClick={handleExport} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs ml-2">
        ↓ Export JSON
      </button>
    </div>
  );
}
```

---

## Step 3: Properties panel (`src/components/PropertiesPanel.tsx`)

Context-sensitive right sidebar. Shows different content depending on `selection`.

```tsx
export function PropertiesPanel() {
  const { definition, selection, setSelection, updateState, updateRecipeMeta,
          deleteState, setInitial, addTransition, updateTransitionOutcome,
          updateTransitionTarget, deleteTransition } = useEditorStore();

  // Render nothing selected → recipe-level meta
  // Render state selected → state editor
  // Render edge selected → edge editor
}
```

### Nothing selected — recipe meta:
- Name: `<input>` bound to `definition.name`
- Description: `<textarea>` bound to `definition.description`
- Version: `<input>` bound to `definition.version`
- Initial state: read-only display showing `definition.initial`
- Save on blur (not on every keystroke to avoid excessive undo entries)

### State selected — state editor:
State id is shown as a read-only `<code>` block (changing ids would break all references).

Editable fields:
- **Phase**: `<select>` with learn/act/report
- **Critical**: `<input type="checkbox">`
- **Description**: `<input type="text">`
- **Next**: `<select>` with all state ids + "(none)" + "end" options
- **Transitions (on map)**: table of rows, each row:
  - outcome key (editable `<input>`)
  - → arrow
  - target (editable `<select>` with all state ids + "end")
  - delete button (×)
- **Add transition row**: outcome input + target select + Add button

Danger zone at bottom:
- **Set as initial** button (grayed out if already initial)
- **Delete state** button (red) — confirm with `window.confirm` before calling `deleteState`

### Edge selected — edge editor:
- Source: read-only `<code>` block
- Outcome: editable `<input>` bound to the outcome key; save on blur calls `updateTransitionOutcome`
- Target: `<select>` with all state ids + "end"; calls `updateTransitionTarget` on change
- **Delete transition** button (red)

### Panel container:
```tsx
<div className="w-72 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
  {/* content */}
</div>
```

---

## Step 4: Update RecipeViewer.tsx

`RecipeViewer` reads from the store instead of accepting props. It handles all canvas events.

```tsx
export function RecipeViewer() {
  const { definition, selection, setSelection, addTransition, isLayoutStale, markLayoutFresh } = useEditorStore();
  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Re-layout whenever definition changes structurally
  useEffect(() => {
    if (!isLayoutStale && nodes.length > 0) return;  // skip if layout is fresh
    setError(null);
    layoutDefinition(definition)
      .then(({ nodes: n, edges: e }) => {
        setNodes(n.map((node) => ({
          ...node,
          selected: selection?.kind === "state" && selection.id === node.id,
        })));
        setEdges(e);
        markLayoutFresh();
      })
      .catch((err: unknown) => {
        setError(`Layout failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [definition, isLayoutStale]);

  // Keep selection highlight in sync without re-running ELK
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        selected: selection?.kind === "state" && selection.id === node.id,
      }))
    );
  }, [selection]);

  function onNodeClick(_: React.MouseEvent, node: RFNode) {
    setSelection({ kind: "state", id: node.id });
  }

  function onEdgeClick(_: React.MouseEvent, edge: Edge) {
    const data = edge.data as TransitionEdgeData;
    setSelection({ kind: "edge", source: edge.source, outcome: data.label });
  }

  function onPaneClick() {
    setSelection(null);
  }

  function onConnect(connection: Connection) {
    // New connection dragged by user — default outcome is "success"
    addTransition(connection.source!, "success", connection.target!);
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {error ? (
        <div className="flex items-center justify-center w-full h-full bg-red-50 text-red-700 p-4">
          <p className="font-mono text-sm">{error}</p>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
        >
          <Background />
          <Controls />
          <MiniMap nodeColor={nodeColor} />
        </ReactFlow>
      )}
    </div>
  );
}
```

Important: `fitView` should only fire on initial load, not on every re-render. Use `fitViewOptions` with `onlyRenderVisibleNodes` or control with a ref. The simplest approach: only call `fitView` when nodes go from 0 → N (initial layout).

---

## Step 5: Update App.tsx

```tsx
import { triageDefinition, implementDefinition } from "@sweny-ai/engine";
import { useEditorStore, useTemporalStore } from "./store/editor-store.js";
import { RecipeViewer } from "./RecipeViewer.js";
import { PropertiesPanel } from "./components/PropertiesPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import type { RecipeDefinition } from "@sweny-ai/engine";
import { useEffect, useCallback } from "react";

const PRESET_RECIPES: Array<{ id: string; name: string; definition: RecipeDefinition }> = [
  { id: "triage", name: "triage", definition: triageDefinition },
  { id: "implement", name: "implement", definition: implementDefinition },
];

export function App() {
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const { clear } = useTemporalStore().getState();  // clear undo history on recipe switch
  const [activeId, setActiveId] = useState("triage");

  const handleRecipeChange = useCallback((id: string) => {
    const recipe = PRESET_RECIPES.find((r) => r.id === id);
    if (!recipe) return;
    clear();  // reset undo history
    setDefinition(recipe.definition);
    setActiveId(id);
  }, [setDefinition, clear]);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <Toolbar
        availableRecipes={PRESET_RECIPES}
        activeRecipeId={activeId}
        onRecipeChange={handleRecipeChange}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RecipeViewer />
        </div>
        <PropertiesPanel />
      </div>
    </div>
  );
}
```

---

## Step 6: Keyboard shortcuts

Add a `useEffect` in `App.tsx` (or a dedicated `useKeyboardShortcuts` hook) that listens for:
- `Cmd+Z` / `Ctrl+Z` → `undo()`
- `Cmd+Shift+Z` / `Ctrl+Shift+Z` → `redo()`
- `Backspace` or `Delete` when a state is selected → `deleteState(selection.id)` with confirm
- `Escape` → `setSelection(null)`

```typescript
useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    const { undo, redo } = useEditorStore.temporal.getState();
    const { selection, deleteState, setSelection } = useEditorStore.getState();

    if (meta && e.shiftKey && e.key === "z") { e.preventDefault(); redo(); return; }
    if (meta && e.key === "z") { e.preventDefault(); undo(); return; }
    if (e.key === "Escape") { setSelection(null); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && selection?.kind === "state") {
      if (window.confirm(`Delete state "${selection.id}"?`)) {
        deleteState(selection.id);
      }
    }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, []);
```

---

## Step 7: Update StateNode to show connection handles

For drag-to-connect to work, React Flow needs handles on each node. The current `StateNode.tsx`
already has `Handle type="source"` and `Handle type="target"`. Verify they are `isConnectable`
(the default is true in RF v12). No change needed unless they're missing.

Make the source handle more visible on hover:
```tsx
<Handle
  type="source"
  position={Position.Right}
  className="w-3 h-3 bg-blue-500 border-2 border-white opacity-0 hover:opacity-100 transition-opacity"
/>
```

---

## Step 8: Code splitting (performance)

The current bundle is 1.78 MB uncompressed. Add manual chunks to `vite.config.ts`:

```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        react: ["react", "react-dom"],
        xyflow: ["@xyflow/react"],
        elk: ["elkjs"],
        zustand: ["zustand", "immer", "zundo"],
      },
    },
  },
},
```

---

## Success criteria

1. Clicking a state node opens the properties panel showing all its fields
2. Editing phase in the properties panel immediately updates the node's phase badge on canvas
3. Editing description updates without re-running ELK layout
4. Clicking "+ State" in the toolbar adds a new node and re-runs ELK layout
5. Clicking "Delete state" removes the node and cleans up all dangling transitions
6. Dragging from a node's right handle to another node creates a "success" transition
7. Clicking an edge selects it and shows source/outcome/target in the panel; outcome is editable
8. Clicking × on an edge in the panel deletes it
9. Cmd+Z undoes any edit; Cmd+Shift+Z redoes it
10. Switching recipes clears undo history
11. Export JSON button downloads a valid `{id}.recipe.json`
12. `npm run typecheck` passes — no `any` types
13. `npm run build` produces chunks: react, xyflow, elk, zustand are separate
14. No console errors during normal use

## Commit when done
```
git add packages/studio/
git commit -m "feat(studio): Phase 2 — editing, properties panel, undo/redo, draw edges, JSON export"
```
Then rename: `mv studio-phase2-editing.todo.md studio-phase2-editing.done.md`
