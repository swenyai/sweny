---
title: Studio
description: Visual editor and execution monitor for SWEny workflows — design, simulate, and observe workflow DAGs in real time.
---

Studio is the visual editor and execution monitor for SWEny workflows. It renders any `Workflow` as an interactive DAG — nodes show their skills as colored badges, edges display natural-language conditions, and execution state is overlaid in real time.

Studio is available as part of [SWEny Cloud](https://cloud.sweny.ai). See the [Live Workflow Explorer](/studio/explorer/) to interact with the built-in workflows directly in these docs.

## Three modes

### Design

The default mode. Edit the workflow graph directly:

- **Add nodes** — click the + button in the toolbar, enter an id
- **Add edges** — drag from the handle on a node to another node; optionally add a `when` condition for conditional routing
- **Edit properties** — select any node to edit its instruction, skills, and output schema; select an edge to edit its condition
- **Undo / redo** — `Cmd+Z` / `Cmd+Shift+Z`; history is scoped to the workflow (selection and layout changes are excluded)
- **Import / Export** — load any JSON or YAML `Workflow`; export the current graph as JSON, YAML, GitHub Actions workflow, or TypeScript

### Simulate

Run the workflow in the browser using `MockClaude` to watch execution flow without connecting to real services or using API credits. Nodes highlight as they execute: blue ring = current, green = success, red = failed, grey = pending.

### Live

Connect to a running executor instance over WebSocket or SSE and stream real `ExecutionEvent` objects. The graph overlays execution state as events arrive — useful for monitoring long-running workflows in staging or production.

## Edge conditions

Edges can be unconditional (always taken) or conditional (Claude evaluates a natural-language `when` clause). When a node has multiple outbound edges:

1. Claude evaluates all `when` conditions against the node's output
2. The best matching conditional edge is taken
3. If no conditional edge matches, an unconditional edge is taken as fallback
4. If nothing matches, the workflow terminates at that node

## Import and export

**Import** accepts any valid JSON or YAML `Workflow`. Drag-and-drop a file onto the canvas or click **Import** in the toolbar.

**Export JSON / YAML** writes the workflow definition — paste directly into your config or check it into version control.

**Export TypeScript** generates the workflow as a typed constant, ready to use with `execute()`.

**Export GitHub Actions** generates a complete `.github/workflows/sweny.yml` pinned to `swenyai/sweny@v3`, with all required secrets documented.

## Permalink

The toolbar's share button encodes the current `Workflow` into the URL as a base64 query parameter. Share the link and the recipient opens the same workflow without any server involved — useful for code review or async collaboration.

## Validation overlay

Studio validates the workflow continuously and shows inline errors on nodes and edges:

- Missing `entry` node
- `entry` references a node that does not exist
- Edge targets that reference unknown node ids
- Unreachable nodes (no inbound edges and not `entry`)
- Unknown skill ids

Unreachable nodes are highlighted with a dashed orange border and a warning badge. Clicking a validation error in the banner selects the affected node.

## Embedding the viewer

The `WorkflowViewer` component is available as `@sweny-ai/studio/viewer` for embedding read-only graphs in dashboards or documentation:

```tsx
import { WorkflowViewer } from "@sweny-ai/studio/viewer";
import "@sweny-ai/studio/style.css";

<WorkflowViewer
  workflow={myWorkflow}
  executionState={{ "gather": "success", "investigate": "running" }}
  height={480}
/>
```

Peer dependencies: `react`, `react-dom`, `@sweny-ai/core`. See the [Live Workflow Explorer](/studio/explorer/) for an interactive demo.

## Embedding the editor store

The full editor store is available as `@sweny-ai/studio/editor` for building custom tooling on top of the same state management Studio uses:

```ts
import { useEditorStore } from "@sweny-ai/studio/editor";

const { workflow, setWorkflow, currentNodeId, completedNodes } = useEditorStore();
```

See [Workflow Authoring](/studio/recipe-authoring/) for the complete `execute()` API.
