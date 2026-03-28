# SWEny Studio

> **Current documentation lives at [docs.sweny.ai/studio/](https://docs.sweny.ai/studio/).** This file is kept for developer reference but the docs site is the canonical source.

Studio is the visual editor and execution monitor for SWEny workflows. It lets you inspect, edit, simulate, and monitor workflow DAGs in a browser — with no backend required for design and simulation.

---

## Overview

Studio consumes `Workflow` (the same pure-data type the executor runs) and renders it as an interactive graph. Nodes show their skills and status, edges show routing conditions, and execution state is overlaid in real time.

Three modes:

| Mode | Description |
|------|-------------|
| **Design** | Edit the workflow graph — add/remove nodes, configure edges and properties |
| **Simulate** | Run the workflow locally in the browser with mock skills |
| **Live** | Connect to a running executor instance and watch execution in real time |

---

## Launching Studio

```bash
# From the monorepo root
npm run dev --workspace=packages/studio
```

Studio opens at `http://localhost:5173`. The built-in presets (Triage and Implement recipes) load automatically on first open.

---

## Design Mode

### Navigation

- **Pan**: drag the canvas background
- **Zoom**: scroll wheel or pinch
- **Select**: click a node or edge
- **Multi-select**: Shift+click

### Editing states

Click a state to select it, then use the **Properties Panel** (right sidebar) to edit:

- **Phase** — `learn`, `act`, or `report`
- **Description** — shown in the node, used as documentation
- **Critical** — if enabled, failure of this state aborts the entire recipe
- **Add transition** — connect this state to another with an outcome label

To add a new state: click **+ Add State** in the toolbar.

To delete: select a state and press `Delete` (or `Backspace`).

### Editing transitions

Click an edge to select it. In the Properties Panel you can change:

- **Outcome** — the key in `on:` that triggers this transition (e.g. `failed`, `skip`, `needs-review`)
- **Target** — the destination state, or `end` to terminate the recipe

To delete a transition: select it and press `Delete`.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + O` | Import recipe from JSON |
| `Delete` / `Backspace` | Delete selected state or transition |
| `Escape` | Deselect all |

### Import / Export

**Import:** drag-and-drop a `RecipeDefinition` JSON file onto the canvas, or use `Ctrl/Cmd + O`. The definition is validated before loading — invalid files are rejected with an error message.

**Export:** click **Export JSON** in the toolbar to download the current definition as a JSON file. This file can be imported back into Studio, checked into source control, or passed to `createRecipe()` at runtime.

---

## Simulate Mode

Simulate runs the recipe entirely in the browser using mock providers. No real API calls, no real infrastructure.

1. Switch to **Simulate** using the mode tabs.
2. Click **Run** in the simulation panel.
3. Watch states light up as they execute — green for success, red for failed, gray for skipped.
4. Expand each state in the results panel to see its `StepResult` (status, data, reason).

The simulation uses a `CollectingObserver` — all `ExecutionEvent` values are captured and displayed after the run.

> **Note:** Simulate uses mock implementations. It validates graph structure and routing logic but does not test provider integration. Use the e2e test pattern (see [recipe-authoring.md](./recipe-authoring.md)) for full integration tests.

---

## Live Mode

Live Mode connects Studio to a real engine instance and streams execution events as they happen.

### Connecting

1. Switch to **Live** using the mode tabs.
2. Enter the engine endpoint URL in the Live Connect panel.
3. Choose transport: **WebSocket** or **SSE** (Server-Sent Events).
4. Click **Connect**.

Once connected, execution events from the engine are forwarded to Studio via the observer protocol. States light up in real time as they enter and exit.

### Event protocol

The engine emits `ExecutionEvent` values over the transport:

```ts
type WorkflowPhase = "learn" | "act" | "report";

type ExecutionEvent =
  | { type: "recipe:start";  recipeId: string; recipeName: string; timestamp: number }
  | { type: "state:enter";   stateId: string;  phase: WorkflowPhase; timestamp: number }
  | { type: "state:exit";    stateId: string;  phase: WorkflowPhase; result: StepResult; cached: boolean; timestamp: number }
  | { type: "recipe:end";    status: "completed" | "failed" | "partial"; duration: number; timestamp: number };
```

Wire your engine to forward these events using `CallbackObserver`:

```ts
import { CallbackObserver } from "@sweny-ai/engine";

const observer = new CallbackObserver((event) => {
  ws.send(JSON.stringify(event)); // or sse.write(...)
});

await runRecipe(myRecipe, config, registry, { observer });
```

---

## Visual reference

### Node colors

| Color | Phase |
|-------|-------|
| Blue | `learn` |
| Amber | `act` |
| Green | `report` |

### Node ring (execution state)

| Ring | Meaning |
|------|---------|
| Spinning blue | Currently executing |
| Solid green | Completed — success |
| Solid amber | Completed — skipped |
| Solid red | Completed — failed |

### Edge labels

Edges show the outcome key that triggers them. A plain `→` arrow with no label indicates the `next` default (success/skipped fallback).

### Initial and terminal states

- **Initial state**: rendered with a double border
- **Terminal transition** (`on: { ...: "end" }`): rendered with a dashed edge pointing to a terminal marker

---

## Embedding the viewer

`@sweny-ai/studio` ships two library entry points built via `npm run build:lib`:

| Entry | Import path | Contents |
|-------|-------------|----------|
| **viewer** | `@sweny-ai/studio/viewer` | `RecipeViewer` component — read-only graph display |
| **editor** | `@sweny-ai/studio/editor` | `StandaloneViewer`, `useEditorStore`, `EditorState`, `Selection` — for full editing integration |

Import the CSS once in your app (`dist/lib/style.css`) to get the ReactFlow base styles.

### `RecipeViewer`

```ts
import { RecipeViewer } from "@sweny-ai/studio/viewer";
import "@sweny-ai/studio/dist/lib/style.css";
import type { RecipeDefinition } from "@sweny-ai/engine";

// executionState maps state ids to their current execution status
const executionState: Record<string, "current" | "success" | "failed" | "skipped"> = {
  "verify-access": "success",
  "investigate":   "current",  // currently executing
};

<RecipeViewer
  definition={myDefinition}
  executionState={executionState}
  height={500}
/>
```

`RecipeViewer` accepts:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `definition` | `RecipeDefinition` | required | Recipe to display |
| `executionState` | `Record<string, "current" \| "success" \| "failed" \| "skipped">` | `{}` | Live execution highlights |
| `height` | `string \| number` | `"100%"` | Canvas height |

### `useEditorStore` (advanced)

For embedding the full editor store in a custom UI:

```ts
import { useEditorStore } from "@sweny-ai/studio/editor";

const { definition, addState, deleteState, applyEvent } = useEditorStore();
```

**Peer dependencies:** `react`, `react-dom`, `@sweny-ai/engine`. Everything else (`@xyflow/react`, `elkjs`, `zustand`, `immer`, `zundo`) is bundled.

---

## Architecture

```
RecipeDefinition (JSON)
       │
       ▼
definition-to-flow.ts          ← converts states/transitions to ReactFlow graph
       │
       ▼
layout/elk.ts                  ← ELK layered layout, phase swimlanes
       │
       ▼
RecipeViewer (ReactFlow canvas) ← renders nodes + edges
       │
  StateNode.tsx                 ← phase-colored node, execution ring
  TransitionEdge.tsx            ← outcome-labeled edge
       │
       ▼
editor-store.ts (Zustand + Zundo) ← design-time mutations + undo/redo
                                   + execution state from ExecutionEvents
```

The store tracks only `RecipeDefinition` in the undo history — UI state (selection, mode, layout) is not undoable.
