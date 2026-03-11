# @sweny-ai/studio

## 1.0.0

### Minor Changes

- 474589e: Studio Phase 2 features and library mode with embeddable entry points.

  **New features**
  - Design mode: add/remove states, draw edges, edit properties panel, undo/redo with Zundo
  - Simulation mode: run recipes locally in the browser with live state highlighting
  - Live mode: connect to a running engine over WebSocket or SSE and stream `ExecutionEvent` objects
  - Recipe permalink: shareable URL with base64-encoded `RecipeDefinition`
  - Export as TypeScript: generates a typed `createRecipe()` call with implementation stubs
  - Import JSON: drag-and-drop or paste any `RecipeDefinition`
  - Validation overlay: inline errors for missing `initial`, unknown transition targets, unreachable states
  - Minimap with phase-accurate execution status colours

  **Library mode** (`@sweny-ai/studio/viewer` and `@sweny-ai/studio/editor`)
  - `RecipeViewer` — embeddable read-only DAG component; accepts `definition`, `executionState`, `height`
  - `useEditorStore`, `EditorState`, `Selection` — full editor store for custom integrations
  - Peer dependencies: `react`, `react-dom`, `@sweny-ai/engine`; everything else bundled

### Patch Changes

- 2f8a675: Fix `RecipeViewer` blank canvas — nodes rendered off-screen after ELK async layout.

  ReactFlow's `fitView` prop runs once on mount (when nodes are empty). ELK places
  nodes asynchronously; by the time layout completes the viewport never re-fits.

  Fix: `AutoFitView` inner component (rendered inside `<ReactFlow>`) uses
  `useReactFlow().fitView()` after nodes are set, with double-rAF to ensure
  ReactFlow has measured node sizes before fitting.

  Also separates the `executionState` effect from the layout effect so toggling
  execution highlights no longer re-runs ELK, and exposes an `onNodeClick` prop.

- 6a71f2a: Library build quality improvements: source maps, correct sideEffects declaration.
  - `vite.lib.config.ts`: enable `sourcemap: true` so bundled code is debuggable
  - `package.json`: declare `"sideEffects": ["dist-lib/style.css"]` so bundlers do not
    tree-shake the CSS import away

- Updated dependencies [474589e]
  - @sweny-ai/engine@1.0.0
