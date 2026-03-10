---
"@sweny-ai/studio": patch
---

Fix `RecipeViewer` blank canvas — nodes rendered off-screen after ELK async layout.

ReactFlow's `fitView` prop runs once on mount (when nodes are empty). ELK places
nodes asynchronously; by the time layout completes the viewport never re-fits.

Fix: `AutoFitView` inner component (rendered inside `<ReactFlow>`) uses
`useReactFlow().fitView()` after nodes are set, with double-rAF to ensure
ReactFlow has measured node sizes before fitting.

Also separates the `executionState` effect from the layout effect so toggling
execution highlights no longer re-runs ELK, and exposes an `onNodeClick` prop.
