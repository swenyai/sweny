---
title: Studio
description: Visual editor and execution monitor for SWEny workflows — design, simulate, and observe workflow DAGs in real time.
---

Studio is the visual editor and execution monitor for SWEny workflows. It renders any `WorkflowDefinition` as an interactive DAG — nodes are colour-coded by phase, edges show transition outcomes, and execution state is overlaid in real time.

Studio is available as part of [SWEny Cloud](https://cloud.sweny.ai). See the [Live Workflow Explorer](/studio/explorer/) to interact with the built-in workflows directly in these docs.

## Three modes

### Design

The default mode. Edit the workflow graph directly:

- **Add steps** — click the + button in the toolbar, enter an id and choose a phase (`learn`, `act`, `report`)
- **Add transitions** — drag from the handle on a node to another node; label the outcome or leave it as the default `→` (unconditional next)
- **Edit properties** — select any node or edge to open the Properties panel; set `critical`, `description`, and outcome-based routing
- **Undo / redo** — `Cmd+Z` / `Cmd+Shift+Z`; history is scoped to the definition (selection and layout changes are excluded)
- **Import / Export** — load any JSON `WorkflowDefinition`; export the current graph as JSON, YAML, GitHub Actions workflow, or generated TypeScript

### Simulate

Run the workflow in the browser using mock providers to watch execution flow without connecting to real services. Steps highlight as they execute: blue ring = current, green = success, red = failed, grey = skipped.

### Live

Connect to a running engine instance over WebSocket or SSE and stream real `ExecutionEvent` objects. The graph overlays execution state as events arrive — useful for monitoring long-running workflows in staging or production.

## Transition routing

Studio faithfully represents the engine's priority order when multiple routing rules exist on a step:

1. **Outcome match** — `on: <outcome>` checked first
2. **Status match** — `on: success`, `on: failed` fallback
3. **Wildcard** — `on: "*"` catch-all
4. **Terminate** — no outbound edge; execution ends

## Import and export

**Import** accepts any valid JSON or YAML `WorkflowDefinition`. Drag-and-drop a file onto the canvas or click **Import** in the toolbar.

**Export JSON / YAML** writes the definition — paste directly into your workflow config or check it into version control.

**Export TypeScript** generates a `createWorkflow()` call with the full definition inlined, ready to drop into a `packages/engine` consumer.

**Export GitHub Actions** generates a complete `.github/workflows/sweny-triage.yml` with all required secrets documented.

## Permalink

The toolbar's share button encodes the current `WorkflowDefinition` into the URL as a base64 query parameter. Share the link and the recipient opens the same workflow without any server involved — useful for code review or async collaboration.

## Validation overlay

Studio validates the definition continuously and shows inline errors on nodes and edges:

- Missing `initial` step
- `initial` references a step that does not exist
- Transition targets that reference unknown step ids
- Unreachable steps (no inbound edges and not `initial`)

Unreachable steps are highlighted with a dashed orange border and a ⚠ badge. Clicking a validation error in the banner selects the affected step. The Properties panel shows an actionable warning when an unreachable step is selected.

## Embedding the viewer

The `WorkflowViewer` component is available as `@sweny-ai/studio/viewer` for embedding read-only graphs in dashboards or documentation:

```ts
import { WorkflowViewer } from "@sweny-ai/studio/viewer";
import "@sweny-ai/studio/style.css";

<WorkflowViewer
  definition={myDefinition}
  executionState={{ "verify-access": "success", "fetch-issue": "current" }}
  height={480}
/>
```

Peer dependencies: `react`, `react-dom`, `@sweny-ai/engine`. See the [Live Workflow Explorer](/studio/explorer/) for an interactive demo, and the [`@sweny-ai/studio` README](https://github.com/swenyai/sweny/blob/main/packages/studio/README.md) for the full component API.

## Embedding the editor store

The full editor store is available as `@sweny-ai/studio/editor` for building custom tooling on top of the same state management Studio uses:

```ts
import { useEditorStore } from "@sweny-ai/studio/editor";

const { definition, setDefinition, currentStepId, completedSteps } = useEditorStore();
```

See [Workflow Authoring](/studio/recipe-authoring/) for the complete `createWorkflow` / `runWorkflow` API.
