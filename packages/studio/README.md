# @sweny-ai/studio

React component library for visualizing SWEny workflow DAGs — embeddable read-only viewer and live execution monitor.

[![npm](https://img.shields.io/npm/v/@sweny-ai/studio)](https://www.npmjs.com/package/@sweny-ai/studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Install

```bash
npm install @sweny-ai/studio @sweny-ai/engine
```

Peer dependencies: `react ^18`, `react-dom ^18`

## Quick start

Import the stylesheet once in your app entry point, then render `WorkflowViewer`
with a `WorkflowDefinition`:

```tsx
import "@sweny-ai/studio/style.css";
import { WorkflowViewer } from "@sweny-ai/studio/viewer";

const workflow = {
  name: "triage",
  initial: "investigate",
  steps: {
    investigate: {
      phase: "learn",
      transitions: [{ on: "done", target: "file-issue" }],
    },
    "file-issue": {
      phase: "act",
      transitions: [{ on: "done", target: "notify" }],
    },
    notify: { phase: "report" },
  },
};

export function WorkflowPage() {
  return <WorkflowViewer definition={workflow} height={400} />;
}
```

The viewer renders a dark-themed DAG with ELK layered layout, zoom controls,
and a minimap. Steps are color-coded by phase: blue (learn), amber (act),
green (report).

## Live execution highlighting

Pass `executionState` to highlight steps as a workflow runs:

```tsx
import { useState } from "react";
import "@sweny-ai/studio/style.css";
import { WorkflowViewer } from "@sweny-ai/studio/viewer";

export function LiveMonitor({ workflow }) {
  const [execState, setExecState] = useState<
    Record<string, "current" | "success" | "failed" | "skipped">
  >({});

  // Update this as your workflow progresses — e.g. from a WebSocket or SSE stream
  // setExecState({ investigate: "success", "file-issue": "current" });

  return (
    <WorkflowViewer
      definition={workflow}
      executionState={execState}
      height={500}
      onNodeClick={(stateId) => console.log("clicked:", stateId)}
    />
  );
}
```

Status styles:
- `"current"` — pulsing blue ring (step is running)
- `"success"` — green highlight
- `"failed"` — red highlight
- `"skipped"` — dimmed (45% opacity)

## API

### `WorkflowViewer` props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `definition` | `WorkflowDefinition` | required | The workflow to render |
| `executionState` | `Record<string, "current" \| "success" \| "failed" \| "skipped">` | `{}` | Per-step execution status for live highlighting |
| `height` | `string \| number` | `"100%"` | Canvas height (CSS value or pixel number) |
| `onNodeClick` | `(stateId: string) => void` | — | Called when the user clicks a step node |

### `WorkflowDefinition` (from `@sweny-ai/engine`)

```ts
interface WorkflowDefinition {
  name: string;
  initial: string; // id of the first step to run
  steps: Record<string, StepDefinition>;
}

interface StepDefinition {
  phase: "learn" | "act" | "report";
  transitions?: Array<{ on: string; target: string }>;
  // ...additional fields (type, description, timeout, etc.)
}
```

## CSS requirement

You must import `@sweny-ai/studio/style.css` once in your application — either
in your app entry point or your root layout component:

```ts
import "@sweny-ai/studio/style.css";
```

Without this, the React Flow canvas and node styles will be missing.

## Advanced: editor store

For applications that need to drive execution state from outside the component
(e.g. connecting to a live `RunObserver`), import from `@sweny-ai/studio/editor`:

```tsx
import { useEditorStore } from "@sweny-ai/studio/editor";

// Access or update the Zustand store directly
const { currentStepId, completedSteps } = useEditorStore();
```

## Links

- [SWEny documentation](https://sweny.ai)
- [GitHub repository](https://github.com/swenyai/sweny)
- [Report a bug](https://github.com/swenyai/sweny/issues)
