# Task 27 — Studio: add README.md to the published npm package

## Goal

`@sweny-ai/studio` is a published npm package with an embeddable React component
for visualizing SWEny workflow DAGs. It has zero documentation — no README, no
usage examples. Anyone landing on the npm page has no idea what it does or how
to use it.

Write `packages/studio/README.md` with installation, quick-start, and API docs
so it shows up on the npm package page.

## Context

### What the package actually exports

The package has two entry points (see `packages/studio/package.json` `exports`):

**`@sweny-ai/studio/viewer`** — read-only embed (most common use case):
- `WorkflowViewer` component — renders a DAG with ELK layout, dark background, animated execution highlights
- `WorkflowViewerProps` type

**`@sweny-ai/studio/editor`** — advanced integrations:
- `StandaloneViewer` (alias for `WorkflowViewer`)
- `useEditorStore` — Zustand store (for apps that want to drive execution state externally)
- `EditorState`, `Selection` types

**`@sweny-ai/studio/style.css`** — required stylesheet (must be imported once)

### WorkflowViewerProps (from `packages/studio/src/components/StandaloneViewer.tsx`):
```ts
interface WorkflowViewerProps {
  definition: WorkflowDefinition;           // required — the workflow to render
  executionState?: Record<string, "current" | "success" | "failed" | "skipped">;
  height?: string | number;                 // default "100%"
  onNodeClick?: (stateId: string) => void;  // optional click handler
}
```

### Peer dependencies
```json
"peerDependencies": {
  "@sweny-ai/engine": "*",
  "react": "^18.3.0",
  "react-dom": "^18.3.0"
}
```

### What `WorkflowDefinition` looks like (from `@sweny-ai/engine`):
```ts
interface WorkflowDefinition {
  name: string;
  initial: string;
  steps: Record<string, StepDefinition>;
}
interface StepDefinition {
  phase: "learn" | "act" | "report";
  transitions?: Array<{ on: string; target: string }>;
  // ...other fields
}
```

### Visual behavior
- Dark background (`#060d1a`) with animated loading spinner
- Steps colored by phase: blue (learn), amber (act), green (report)
- MiniMap in bottom-right, zoom controls in bottom-left
- Execution highlights: current step pulses, success/failed/skipped styled differently
- ELK layered layout, auto-fits on load

### Where it's used in the web docs package
See `packages/web` — it imports `@sweny-ai/studio/viewer` for embedded workflow
diagrams in the documentation site. That's a real usage example you can reference.

## What to write

Create `packages/studio/README.md` with these sections:

### 1. Title + one-liner
`@sweny-ai/studio` — React component library for visualizing SWEny workflow DAGs

### 2. Install section
```bash
npm install @sweny-ai/studio @sweny-ai/engine
```
Peer deps: react ^18, react-dom ^18

### 3. Quick start (WorkflowViewer)
Show a minimal working example:
```tsx
import "@sweny-ai/studio/style.css";
import { WorkflowViewer } from "@sweny-ai/studio/viewer";

const workflow = {
  name: "triage",
  initial: "investigate",
  steps: {
    investigate: { phase: "learn", transitions: [{ on: "done", target: "file-issue" }] },
    "file-issue":  { phase: "act",  transitions: [{ on: "done", target: "notify" }] },
    notify:        { phase: "report" },
  },
};

export function MyPage() {
  return <WorkflowViewer definition={workflow} height={400} />;
}
```

### 4. Live execution highlighting
Show how to pass `executionState` to highlight running steps:
```tsx
const [execState, setExecState] = useState({});
// update as steps run:
setExecState({ investigate: "success", "file-issue": "current" });

<WorkflowViewer definition={workflow} executionState={execState} height={400} />
```

### 5. Props table (WorkflowViewerProps)
Markdown table with all 4 props, their types, defaults, and descriptions.

### 6. CSS note
One sentence: must import `@sweny-ai/studio/style.css` once in your app entry point.

### 7. Links
- [SWEny docs](https://sweny.ai)
- [GitHub](https://github.com/swenyai/sweny)

## Changeset

```md
---
"@sweny-ai/studio": patch
---

Add README with installation, quick-start example, and API docs for the
WorkflowViewer component.
```

## Done when

- [ ] `packages/studio/README.md` exists and covers all sections above
- [ ] Install snippet is correct (includes @sweny-ai/engine peer dep)
- [ ] CSS import note is present
- [ ] Props table is accurate against actual `WorkflowViewerProps`
- [ ] Changeset created at `.changeset/studio-readme.md`
- [ ] No new source files modified (docs only)
