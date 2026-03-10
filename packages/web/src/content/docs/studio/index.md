---
title: Studio
description: Visual editor and execution monitor for SWEny recipes — design, simulate, and observe recipe DAGs in real time.
---

Studio is the visual editor and execution monitor for SWEny recipes. It renders any `RecipeDefinition` as an interactive DAG — nodes are colour-coded by phase, edges show transition outcomes, and execution state is overlaid in real time.

Studio is available as part of [SWEny Cloud](https://cloud.sweny.ai). See the [Live Recipe Explorer](/studio/explorer/) to interact with the built-in recipes directly in these docs.

## Three modes

### Design

The default mode. Edit the recipe graph directly:

- **Add states** — click the + button in the toolbar, enter an id and choose a phase (`learn`, `act`, `report`)
- **Add transitions** — drag from the handle on a node to another node; label the outcome or leave it as the default `→` (unconditional next)
- **Edit properties** — select any node or edge to open the Properties panel; set `critical`, `description`, and outcome-based routing
- **Undo / redo** — `Cmd+Z` / `Cmd+Shift+Z`; history is scoped to the definition (selection and layout changes are excluded)
- **Import / Export** — load any JSON `RecipeDefinition`; export the current graph as JSON or generated TypeScript

### Simulate

Run the recipe in the browser using mock providers to watch execution flow without connecting to real services. States highlight as they execute: blue ring = current, green = success, red = failed, grey = skipped.

### Live

Connect to a running engine instance over WebSocket or SSE and stream real `ExecutionEvent` objects. The graph overlays execution state as events arrive — useful for monitoring long-running recipes in staging or production.

## Transition routing

Studio faithfully represents the engine's priority order when multiple routing rules exist on a state:

1. **Outcome match** — `on: { <outcome>: targetId }` checked first
2. **Status match** — `on: { success: ..., failure: ... }` fallback
3. **Wildcard** — `on: { "*": ... }` catch-all
4. **Next** — unconditional default transition
5. **Terminate** — no outbound edge; execution ends

## Import and export

**Import** accepts any valid JSON `RecipeDefinition`. Drag-and-drop a `.json` file onto the canvas or click **Import** in the toolbar.

**Export JSON** writes the definition as minified JSON — paste directly into your recipe config or check it into version control.

**Export TypeScript** generates a `createRecipe()` call with the full definition inlined, ready to drop into a `packages/engine` consumer.

## Permalink

The toolbar's share button encodes the current `RecipeDefinition` into the URL as a base64 query parameter. Share the link and the recipient opens the same graph without any server involved — useful for code review or async collaboration.

## Validation overlay

Studio validates the definition continuously and shows inline errors on nodes and edges:

- Missing `initial` state
- `initial` references a state that does not exist
- Transition targets that reference unknown state ids
- Unreachable states (no inbound edges and not `initial`)

## Embedding the viewer

The `RecipeViewer` component is available as `@sweny-ai/studio/viewer` for embedding read-only graphs in dashboards or documentation:

```ts
import { RecipeViewer } from "@sweny-ai/studio/viewer";
import "@sweny-ai/studio/style.css";

<RecipeViewer
  definition={myDefinition}
  executionState={{ "verify-access": "success", "fetch-issue": "current" }}
  height={480}
/>
```

Peer dependencies: `react`, `react-dom`, `@sweny-ai/engine`. See the [Live Recipe Explorer](/studio/explorer/) for an interactive demo.

## Embedding the editor store

The full editor store is available as `@sweny-ai/studio/editor` for building custom tooling on top of the same state management Studio uses:

```ts
import { useEditorStore } from "@sweny-ai/studio/editor";

const { definition, addState, addTransition, applyEvent } = useEditorStore();
```

See [Recipe Authoring](/studio/recipe-authoring/) for the complete `createRecipe` / `runRecipe` API.
