# @sweny-ai/studio

## 3.2.1

### Patch Changes

- c4d709a: Fix schema publication, semver validation, and shared schema header constant.
  - `schema/` directory now included in engine package `files` so `@sweny-ai/engine/schema`
    actually ships to npm consumers (was silently missing before)
  - JSON Schema semver regex now anchored with `$` — previously allowed trailing
    garbage like `"1.0.0-junk!!!"` to pass validation
  - `WORKFLOW_YAML_SCHEMA_HEADER` exported from `@sweny-ai/engine` so CLI and Studio
    import a single source of truth instead of duplicating the URL string
  - Added schema tests: pre-release labels, build metadata, `type` field acceptance,
    unknown extra property rejection, end-anchor semver check

- Updated dependencies [c4d709a]
  - @sweny-ai/engine@3.0.2

## 3.2.0

### Minor Changes

- 3375a00: PropertiesPanel now shows an execution result card in simulate/live mode.
  Clicking a completed step displays status icon, outcome badge, reason, and
  optionally the full output data (expandable). Running steps show a pulsing
  indicator; pending steps show "pending". All design controls become read-only
  (disabled, not hidden) during execution so the workflow definition stays visible.

### Patch Changes

- 7f284ff: JSON Schema for workflow YAML updated and renamed to `workflow-definition.schema.json`.
  Added the `type` field for built-in step types with known values as examples.
  CLI `sweny workflow export` and Studio's Export YAML button now include a
  `# yaml-language-server: $schema=...` header — VS Code auto-completes and
  validates workflow YAML files with no extra setup.
- Updated dependencies [dc62460]
- Updated dependencies [7f284ff]
  - @sweny-ai/engine@3.0.1

## 3.1.0

### Minor Changes

- 7b823fb: Simulation and Live modes now show a step-by-step execution trace panel with
  icons (✓/✗/⊘), step IDs, `data.outcome` badges, and `reason` text — so
  debugging a workflow no longer requires reading server logs.

  Internal: `RecipeViewer` component renamed to `WorkflowViewer` for
  consistency with the rest of the workflow terminology.

## 3.0.0

### Major Changes

- 815d361: **Breaking**: Studio public exports renamed to workflow terminology.
  - `RecipeViewer` → `WorkflowViewer`
  - `RecipeViewerProps` → `WorkflowViewerProps`
  - Studio now listens for `workflow:start`, `step:enter`, `step:exit`, `workflow:end` events (matching engine v2)
  - Internal store fields: `currentStepId`, `completedSteps`, `updateWorkflowMeta`

  CLI: updated to use `runWorkflow`, `triageWorkflow`, `implementWorkflow` from engine (no user-facing change).

### Minor Changes

- e36f470: Studio is now the GUI for declarative YAML workflows.
  - **Step type picker**: select built-in step types (sweny/investigate, sweny/create-pr, etc.) when adding nodes — pre-populates phase, uses, and type fields
  - **YAML export**: primary export is now workflow YAML (compatible with `sweny workflow run`); JSON export kept as secondary
  - **YAML import**: Import modal accepts YAML or JSON paste
  - **Fork UX**: one-click fork of built-in workflows (triage, implement) into editable custom workflow
  - **Step type display**: nodes show their type label as subtitle

### Patch Changes

- Updated dependencies [1204f4f]
- Updated dependencies [93e7710]
  - @sweny-ai/engine@3.0.0

## 2.0.0

### Minor Changes

- 79fd3dd: Redesign StateNode as compact 40px cards so the full recipe DAG is visible at once — state ID, provider icon, and phase badge only; description and transitions shown in the click-to-open side panel. Reduce ELK node dimensions (200×40) and layer spacing for a dense readable layout. Lower fitView minZoom to 0.4. Make edges more prominent with semantic coloring and better opacity.
- fbcae71: Major UX overhaul for the RecipeViewer and node components:
  - **StateNode**: Fully redesigned cards — provider category icons (◉ ◈ ⎇ ⬡ ◎), semantic exec-status borders/glows, upgraded typography, more generous sizing (252–278px wide, 10px radius)
  - **TransitionEdge**: Semantic edge coloring by outcome type — indigo for action outcomes, cyan for `local`/`dispatched`, amber for `duplicate`, red dashed for `failed`, muted slate for default `→`
  - **AutoFitView**: Added `minZoom: 0.65` to prevent unreadable zoom levels on tall vertical DAGs
  - **ELK layout**: Increased node dimensions (264×130) and spacing for better readability
  - **Canvas**: Deeper dark background, refined dot grid, polished MiniMap and Controls styling
  - **Pulse animation**: CSS keyframe injected for `current` execution state

### Patch Changes

- 353b5e0: Fix invisible DAG edges: increase stroke width from 1.5-2px to 3px, brighten default edge color from #3b5070 to #4d7aaa, and raise opacity so connections are visible at low zoom levels.
- 8cef981: Fix infinite render loop in RecipeViewer when no executionState is passed. The `executionState = {}` default was creating a new object reference on every render, causing the executionState effect to fire continuously and trigger maximum update depth exceeded.
- a714adc: Convert StateNode and TransitionEdge from Tailwind CSS classes to inline styles so the RecipeViewer renders correctly in non-Tailwind environments (e.g. the docs site). Adds a dark-theme color palette — phase-colored borders, exec-status rings, dark canvas background, and styled MiniMap.
- Updated dependencies [0a59479]
- Updated dependencies [556a53d]
- Updated dependencies [4465923]
- Updated dependencies [130138e]
- Updated dependencies [42f6e95]
- Updated dependencies [010b6d7]
- Updated dependencies [4b4b29f]
  - @sweny-ai/engine@2.0.0

## 1.0.1

### Patch Changes

- 9940c68: Library build: add sideEffects declaration and source maps.
  - `"sideEffects": ["dist-lib/style.css"]` prevents bundlers from incorrectly
    tree-shaking the CSS import
  - `sourcemap: true` in vite.lib.config.ts makes the bundled output debuggable

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
