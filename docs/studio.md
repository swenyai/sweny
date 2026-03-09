# SWEny Studio

Studio is the visual editor and execution monitor for SWEny recipes. It lets you inspect, edit, simulate, and monitor recipe DAGs in a browser — with no backend required for design and simulation.

---

## Overview

Studio consumes `RecipeDefinition` (the same pure-data type the engine executes) and renders it as an interactive graph. Nodes are color-coded by phase, edges show transition outcomes, and execution state is overlaid in real time.

Three modes:

| Mode | Description |
|------|-------------|
| **Design** | Edit the recipe graph — add/remove states, configure transitions and properties |
| **Simulate** | Run the recipe locally in the browser with mock providers |
| **Live** | Connect to a running engine instance and watch execution in real time |

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
type ExecutionEvent =
  | { type: "recipe:start";  recipeId: string; recipeName: string; timestamp: number }
  | { type: "state:enter";   stateId: string;  phase: string;  timestamp: number }
  | { type: "state:exit";    stateId: string;  phase: string;  result: StepResult; cached: boolean; timestamp: number }
  | { type: "recipe:end";    status: string;   duration: number; timestamp: number };
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

Studio exports a read-only `RecipeViewer` component for embedding in dashboards or documentation sites.

```ts
// Install from the monorepo or your own registry
import { RecipeViewer } from "@sweny-ai/studio/viewer";
import type { RecipeDefinition } from "@sweny-ai/engine";
import type { ExecutionState } from "@sweny-ai/studio/viewer";

const executionState: ExecutionState = {
  "verify-access": { status: "success" },
  "investigate":   { status: "running" },
};

<RecipeViewer
  definition={myDefinition}
  executionState={executionState}
  height={500}
/>
```

`RecipeViewer` has no external dependencies beyond React and ReactFlow — safe to embed in any React app.

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
