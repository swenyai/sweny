---
"@sweny-ai/studio": minor
---

Studio Phase 2 features and library mode with embeddable entry points.

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
