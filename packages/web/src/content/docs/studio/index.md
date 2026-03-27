---
title: Studio
description: Visual editor and execution monitor for SWEny workflows -- design, simulate, and observe workflow DAGs in real time.
---

Studio is the visual workflow editor and real-time execution monitor for SWEny. It renders any `Workflow` as an interactive directed acyclic graph (DAG) where nodes represent steps, edges represent transitions, and execution state is overlaid live as events stream in.

Studio is available in three forms:

- **Standalone app** -- run `npm run dev:studio` to launch the full editor locally
- **Embeddable viewer** -- `@sweny-ai/studio/viewer` exports a read-only `WorkflowViewer` React component for dashboards and docs
- **Embeddable editor** -- `@sweny-ai/studio/editor` exports the full editor store (`useEditorStore`) for building custom tooling

Built on [@xyflow/react](https://reactflow.dev/) v12 with [ELK](https://www.eclipse.org/elk/) for automatic layered layout, [Zustand](https://zustand-demo.pmnd.rs/) for state management, and [zundo](https://github.com/charkour/zundo) for undo/redo history.

## Three modes

### Design

The default mode. Build and edit the workflow graph directly:

- **Add nodes** -- drag templates from the left toolbox onto the canvas, or click **+ new** in the toolbar
- **Connect nodes** -- drag from a node's bottom handle to another node's top handle to create an edge
- **Edit properties** -- select any node to edit its name, instruction, skills, and output schema in the right panel; select an edge to edit its `when` condition
- **Undo / redo** -- `Cmd+Z` / `Cmd+Shift+Z` (history tracks only structural workflow changes, not selection or layout)
- **Import / export** -- load JSON or YAML workflows; export as YAML, JSON, TypeScript, or GitHub Actions

### Simulate

Run the workflow in the browser using a mock Claude backend to watch execution flow without connecting to real services or spending API credits. Nodes highlight as they execute: blue pulsing glow for the current node, green border for success, red border for failure, dimmed for skipped, and dark for pending.

### Live

Connect to a running executor instance and stream real `ExecutionEvent` objects. The graph overlays execution state as events arrive -- useful for monitoring long-running workflows in staging or production. See [Live Mode](/studio/live/) for setup details.

## Node anatomy

Each node on the canvas displays:

1. **Name** -- the human-readable label (falls back to the node ID if no name is set)
2. **Node ID** -- the machine identifier in monospace below the name
3. **Skill badges** -- colored pills showing which skills are available at this node (e.g., `github`, `sentry`, `slack`)
4. **Entry badge** -- a small "entry" tag on the workflow's entry node
5. **Accent bar** -- a left-side color bar derived from the node's primary skill

Terminal nodes (no outgoing edges) display with a dashed border. Unreachable nodes show a dashed orange border with a warning badge.

## Edge conditions

Edges can be unconditional (always taken) or conditional (Claude evaluates a natural-language `when` clause at runtime). When a node has multiple outbound edges:

1. Claude evaluates all `when` conditions against the node's output
2. The best matching conditional edge is taken
3. If no conditional edge matches, an unconditional edge is taken as fallback
4. If nothing matches, the workflow terminates at that node

Conditional edges render in indigo with a label pill showing the condition text. Unconditional edges render in a muted blue.

## Import and export

**Import** accepts any valid JSON or YAML `Workflow`. Drag-and-drop a file onto the canvas or click **Import** in the toolbar.

**Export YAML** writes the workflow definition with a header comment and link to the schema docs -- paste directly into your config or check it into version control.

**Export JSON** writes the raw `Workflow` object.

**Export TypeScript** generates the workflow as a typed `Workflow` constant with the `@sweny-ai/core` import, ready to use with `execute()`.

**Export GitHub Actions** generates a complete `.github/workflows/sweny-<id>.yml` that installs the SWEny CLI and runs the workflow. It auto-detects which skills the workflow uses and adds the corresponding secrets (`GITHUB_TOKEN`, `SENTRY_AUTH_TOKEN`, `DD_API_KEY`, `LINEAR_API_KEY`, `SLACK_BOT_TOKEN`, etc.) to the env block.

## Permalink

The toolbar's **Share** button encodes the current `Workflow` into the URL as a base64 query parameter. Share the link and the recipient opens the same workflow without any server involved -- useful for code review or async collaboration.

## Validation overlay

Studio validates the workflow continuously and shows inline errors on nodes and edges:

- Missing `entry` node
- `entry` references a node that does not exist
- Edge targets that reference unknown node ids
- Unreachable nodes (no inbound edges and not `entry`)
- Unknown skill ids

Unreachable nodes are highlighted with a dashed orange border and a warning badge. Clicking a validation error in the banner selects the affected node or edge.

## What is next

- [Editor Guide](/studio/editor/) -- walkthrough of the toolbox, canvas, and properties panel
- [Embedding Studio](/studio/embedding/) -- use `WorkflowViewer` and `useEditorStore` in your own React app
- [Live Mode](/studio/live/) -- connect Studio to a running workflow execution
