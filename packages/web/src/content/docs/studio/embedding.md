---
title: Embedding Studio Components
description: Use WorkflowViewer and the editor store as React components in your own application.
---

The `@sweny-ai/studio` package exports two entry points for embedding Studio components in your own React application: a read-only viewer and the full editor store.

## Installation

```bash
npm install @sweny-ai/studio @sweny-ai/core react react-dom
```

:::note[Peer dependencies]
`@sweny-ai/studio` requires React 18.3+ and `@sweny-ai/core` as peer dependencies. The `@xyflow/react` v12, `elkjs`, `zustand`, and `zundo` dependencies are bundled.
:::

## WorkflowViewer (read-only)

Import from `@sweny-ai/studio/viewer` for a read-only DAG visualization. This is the lighter export -- it includes only the viewer component without the editor store or editing UI.

```tsx
import { WorkflowViewer } from "@sweny-ai/studio/viewer";
import "@sweny-ai/studio/style.css";
import type { Workflow } from "@sweny-ai/core";

const workflow: Workflow = {
  id: "triage",
  name: "Triage",
  description: "Investigate and triage production errors",
  entry: "gather",
  nodes: {
    gather: {
      name: "Gather Context",
      instruction: "Collect logs, errors, and metrics from all sources.",
      skills: ["github", "sentry", "datadog"],
    },
    investigate: {
      name: "Root Cause Analysis",
      instruction: "Analyze the gathered data and identify the root cause.",
      skills: ["github"],
    },
    notify: {
      name: "Notify Team",
      instruction: "Send a summary to the team channel.",
      skills: ["slack", "notification"],
    },
  },
  edges: [
    { from: "gather", to: "investigate" },
    { from: "investigate", to: "notify" },
  ],
};

function Dashboard() {
  return (
    <WorkflowViewer
      workflow={workflow}
      height="500px"
      onNodeClick={(nodeId) => console.log("Clicked:", nodeId)}
    />
  );
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `workflow` | `Workflow` | (required) | The workflow definition to render |
| `executionState` | `Record<string, NodeExecStatus>` | `{}` | Map of node IDs to execution status for live overlays |
| `height` | `string \| number` | `"100%"` | CSS height of the canvas container |
| `onNodeClick` | `(nodeId: string) => void` | -- | Callback when the user clicks a node |

The `NodeExecStatus` type is one of `"current"`, `"success"`, `"failed"`, `"skipped"`, or `"pending"`.

### Execution state overlay

Pass an `executionState` map to overlay execution status on the viewer. This is how Live Mode works internally -- you can use the same mechanism in your own dashboards.

```tsx
const [execState, setExecState] = useState<Record<string, NodeExecStatus>>({});

// Update as events arrive
function onEvent(event: ExecutionEvent) {
  if (event.type === "node:enter") {
    setExecState((prev) => ({ ...prev, [event.node]: "current" }));
  }
  if (event.type === "node:exit") {
    const status = event.result.status === "success" ? "success" : "failed";
    setExecState((prev) => ({ ...prev, [event.node]: status }));
  }
}

<WorkflowViewer
  workflow={workflow}
  executionState={execState}
  height="600px"
/>
```

Status colors on the canvas:

| Status | Visual |
|--------|--------|
| `pending` | Dark background, subtle shadow |
| `current` | Blue border with pulsing glow animation |
| `success` | Green border |
| `failed` | Red border |
| `skipped` | Dimmed, muted border |

### Style import

You must import `@sweny-ai/studio/style.css` once in your application. This stylesheet includes the React Flow base styles and Studio's custom node/edge styles. Import it in your root layout or alongside the component:

```tsx
import "@sweny-ai/studio/style.css";
```

## Editor store (full)

Import from `@sweny-ai/studio/editor` for the complete Zustand store that powers the Studio editor. This gives you programmatic access to all workflow mutations, undo/redo, execution state, and mode switching.

```ts
import { useEditorStore } from "@sweny-ai/studio/editor";
import type { EditorState, Selection } from "@sweny-ai/studio/editor";
```

### Reading state

```tsx
function WorkflowInfo() {
  const workflow = useEditorStore((s) => s.workflow);
  const mode = useEditorStore((s) => s.mode);
  const selection = useEditorStore((s) => s.selection);
  const currentNodeId = useEditorStore((s) => s.currentNodeId);
  const completedNodes = useEditorStore((s) => s.completedNodes);
  const executionStatus = useEditorStore((s) => s.executionStatus);

  return (
    <div>
      <p>Workflow: {workflow.name} ({Object.keys(workflow.nodes).length} nodes)</p>
      <p>Mode: {mode}</p>
      <p>Status: {executionStatus}</p>
      {selection?.kind === "node" && <p>Selected: {selection.id}</p>}
    </div>
  );
}
```

### Mutating the workflow

The store exposes granular mutation methods. All mutations are tracked by the undo/redo system.

```ts
const {
  // Workflow-level
  setWorkflow,
  updateWorkflowMeta,
  setEntry,

  // Node mutations
  addNode,
  deleteNode,
  updateNode,
  renameNode,
  duplicateNode,
  disconnectNode,

  // Edge mutations
  addEdge,
  updateEdge,
  deleteEdge,
} = useEditorStore();

// Add a node
addNode("my_node");

// Update its properties
updateNode("my_node", {
  name: "My Node",
  instruction: "Do something useful.",
  skills: ["github", "slack"],
});

// Connect it
addEdge("gather", "my_node");
addEdge("my_node", "notify", "severity is high");

// Rename (cascades to edges and entry)
const error = renameNode("my_node", "analyze");
if (error) console.error(error); // null on success, string on failure

// Clone a node
const newId = duplicateNode("analyze"); // returns "analyze_copy"

// Delete
deleteNode("analyze");
```

### Undo and redo

The temporal store is exposed separately:

```ts
import { useEditorStore } from "@sweny-ai/studio/editor";
import { useStore } from "zustand";

// Access the temporal API
const temporalStore = useEditorStore.temporal;
const pastStates = useStore(temporalStore, (s) => s.pastStates);
const futureStates = useStore(temporalStore, (s) => s.futureStates);

// Undo / redo
temporalStore.getState().undo();
temporalStore.getState().redo();

// Clear history (e.g., after importing a new workflow)
temporalStore.getState().clear();
```

Only the `workflow` object is tracked in undo history. Selection, layout state, and execution state are excluded.

### Execution state

The store tracks execution progress for Simulate and Live modes:

```ts
const {
  mode,
  setMode,
  applyEvent,
  resetExecution,
  currentNodeId,
  completedNodes,
  executionStatus,
} = useEditorStore();

// Switch to live mode
setMode("live");

// Apply execution events as they arrive
applyEvent({ type: "workflow:start", workflow: "triage" });
applyEvent({ type: "node:enter", node: "gather", instruction: "..." });
applyEvent({ type: "node:exit", node: "gather", result: { status: "success", data: {}, toolCalls: [] } });

// Reset when done
resetExecution();
```

The `applyEvent` method handles the key `ExecutionEvent` types: `workflow:start`, `node:enter`, `node:exit`, and `workflow:end`. Other events (`tool:call`, `tool:result`, `route`) are available for logging but don't affect the visual state. See [Live Mode](/studio/live/) for a complete integration example.

### StandaloneViewer

The editor export also re-exports the viewer component as `StandaloneViewer`:

```tsx
import { StandaloneViewer } from "@sweny-ai/studio/editor";
```

This is the same component as `WorkflowViewer` from the viewer export, re-exported for convenience when you already have the editor import.

## TypeScript types

Both exports include full type declarations. Key types:

```ts
import type { WorkflowViewerProps } from "@sweny-ai/studio/viewer";
import type { EditorState, Selection } from "@sweny-ai/studio/editor";
import type { Workflow, Node, Edge, ExecutionEvent, NodeResult } from "@sweny-ai/core";
```

The `Selection` type is a discriminated union:

```ts
type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string; from: string; to: string }
  | null;
```
