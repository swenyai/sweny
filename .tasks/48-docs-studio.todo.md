# Task: Write Studio Section (4 pages)

## Goal
Write the 4 Studio pages. Studio is the visual workflow editor and execution monitor.

## Pages to write

All pages go in `packages/web/src/content/docs/studio/`.

### 1. `index.md` — Overview
- What Studio is: a React-based visual editor for building and monitoring SWEny workflows
- Three modes: Design (build workflows), Simulate (test with mocks), Live (watch real execution)
- Available as: standalone app (`npm run dev:studio`), embeddable React components (`@sweny-ai/studio/viewer` and `@sweny-ai/studio/editor`)
- Built on React Flow (@xyflow/react) with ELK layout engine
- Screenshot/description of the interface: canvas with DAG, left toolbox for dragging nodes, properties panel for editing

### 2. `editor.md` — Editor Guide
- **Toolbox** (left sidebar): drag skill-grouped nodes onto the canvas
  - Categories: General (Blank Node), Observability (Gather Context), Tasks (Create Issue), Notification (Notify Team), plus Root Cause Analysis
- **Canvas**: pan, zoom, select nodes, draw edges
- **Properties Panel** (right): edit selected node's name, instruction, skills, output schema
- **Adding nodes**: drag from toolbox, or right-click canvas
- **Connecting nodes**: drag from one node's output handle to another's input handle
- **Edge conditions**: click an edge to add a `when` condition
- **Validation**: real-time validation overlay shows errors (unreachable nodes, missing entry, cycles)
- **Undo/redo**: Ctrl+Z / Ctrl+Shift+Z (powered by zundo)
- **Export**: YAML, TypeScript, GitHub Actions workflow — from the toolbar
- **Import**: load existing YAML workflows

### 3. `embedding.md` — Embedding Studio Components
- Two npm exports:
  - `@sweny-ai/studio/viewer` — read-only `WorkflowViewer` component
  - `@sweny-ai/studio/editor` — full `StandaloneViewer` + `useEditorStore` hook
- WorkflowViewer props:
  ```tsx
  <WorkflowViewer
    workflow={workflow}           // Workflow object
    executionState={stateMap}     // Optional: Record<nodeId, "current"|"success"|"failed"|"skipped">
    height="600px"               // Optional
    onNodeClick={(id) => ...}    // Optional
  />
  ```
- Editor store (Zustand):
  ```ts
  import { useEditorStore } from '@sweny-ai/studio/editor'
  const { workflow, addNode, deleteNode, updateNode, addEdge, undo, redo } = useEditorStore()
  ```
- Installation: `npm install @sweny-ai/studio`
- Peer deps: React 18+, @xyflow/react v12

### 4. `live.md` — Live Mode
- What it does: watch a workflow execution in real-time
- Nodes update status as execution progresses: pending → current (blue glow) → success (green) / failed (red) / skipped (dimmed)
- Powered by execution events (ExecutionEvent type from @sweny-ai/core)
- Using `applyEvent()` from the editor store to update the visual state
- Connecting to a running execution (via observer callback or WebSocket)

## Source of truth
- `packages/studio/src/components/StandaloneViewer.tsx`
- `packages/studio/src/components/StateNode.tsx` — node visuals
- `packages/studio/src/components/TransitionEdge.tsx` — edge visuals
- `packages/studio/src/components/NodeToolbox.tsx` — toolbox
- `packages/studio/src/components/PropertiesPanel.tsx` — properties panel
- `packages/studio/src/store/editor-store.ts` — Zustand store
- `packages/studio/src/lib/export-yaml.ts`, `export-github-actions.ts`, `export-typescript.ts`
- `packages/core/src/studio.ts` — studio adapter (workflowToFlow, flowToWorkflow)
