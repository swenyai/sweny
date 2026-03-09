# Task: DAG Studio — React Flow Visualizer (Read-Only, Phase 1)

## Prerequisite
This task depends on ALL THREE of the following being done:
- `dag-spec-v2-types-and-runner.done.md`
- `dag-spec-v2-runner-tests.done.md`
- `dag-spec-v2-recipe-migration.done.md`

## Goal
Create a new `packages/studio` React app that renders a `RecipeDefinition` as an
interactive visual graph. Phase 1 is **read-only** (pan, zoom, hover tooltips).
Phase 2 (editing, drag-and-drop) comes later.

This is the foundation of our Stately.ai competitor — an open-source, embeddable,
self-hostable visual workflow editor for agentic recipes.

## Repo context
- Monorepo at `/Users/nate/src/swenyai/sweny`
- npm workspaces — add `packages/studio` to `package.json` workspaces if not there
- npm scope: `@sweny-ai/studio`
- Use React + Vite (not Next.js, not Astro)
- Use React Flow v12 (`@xyflow/react`) for the canvas
- Use Tailwind CSS for styling
- Use `elkjs` + `web-worker` for auto-layout

## What to build

### Package setup

Create `packages/studio/` with:
```
packages/studio/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx           — app entry point, renders <App />
    App.tsx            — renders <RecipeViewer> with hardcoded triageDefinition for dev
    RecipeViewer.tsx   — main component: takes RecipeDefinition prop, renders the graph
    components/
      StateNode.tsx    — custom React Flow node for a single state
      TransitionEdge.tsx — custom React Flow edge for transitions
    layout/
      elk.ts           — converts RecipeDefinition → ELK graph → React Flow nodes+edges
    lib/
      definition-to-flow.ts  — converts RecipeDefinition to React Flow nodes+edges (pre-layout)
```

### package.json
```json
{
  "name": "@sweny-ai/studio",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@sweny-ai/engine": "*",
    "@xyflow/react": "^12.0.0",
    "elkjs": "^0.9.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### Data model: RecipeDefinition → React Flow

Import `RecipeDefinition` and `StateDefinition` from `@sweny-ai/engine`.

Each state becomes a React Flow node:
```typescript
type StateNodeData = {
  stateId: string;
  state: StateDefinition;
  // visual
  isInitial: boolean;
  isTerminal: boolean;  // no next and no on entries, or all on targets are "end"
};
```

Each transition (from `on` values and `next`) becomes a React Flow edge:
```typescript
// Edge id: `${sourceId}--${outcome}--${targetId}`
// Edge label: the outcome key (e.g. "implement", "failed", "*", "→" for next)
```

For the `next` field, create an edge with label "→" (default path).
For each `on` entry, create an edge with label = the key string.
Skip edges where target is "end" — instead mark the node as terminal.

### ELK auto-layout

Use ELK to compute positions. ELK algorithm: `"layered"` with direction `"RIGHT"`.

```typescript
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

async function layoutDefinition(def: RecipeDefinition): Promise<{ nodes: Node[], edges: Edge[] }> {
  // 1. Convert def to ELK graph
  // 2. Run elk.layout()
  // 3. Map ELK positions back to React Flow nodes
  // 4. Return { nodes, edges }
}
```

ELK graph structure:
```javascript
{
  id: "root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.edgeNodeBetweenLayers": "40",
  },
  children: states.map(([id, state]) => ({
    id,
    width: 200,
    height: 80,
  })),
  edges: allTransitions.map(({ source, target, label }) => ({
    id: `${source}--${label}--${target}`,
    sources: [source],
    targets: [target],
  })),
}
```

### StateNode component

A custom React Flow node showing:
- State id (bold)
- Phase badge (color coded: learn=blue, act=amber, report=green)
- `critical` badge if true
- Description if present
- Border: initial state gets a double border; terminal state gets a dashed border

```tsx
// packages/studio/src/components/StateNode.tsx
import { Handle, Position } from "@xyflow/react";

export function StateNode({ data }: { data: StateNodeData }) {
  const phaseColors = {
    learn:  "bg-blue-100 text-blue-800",
    act:    "bg-amber-100 text-amber-800",
    report: "bg-green-100 text-green-800",
  };
  // render handles on left (target) and right (source)
  // render state id, phase badge, critical badge, description
}
```

### TransitionEdge component

A custom React Flow edge showing:
- Label with the outcome key ("implement", "failed", "skipped", "→", "*")
- Color: "failed" edges = red label; "→" = gray; others = default

### RecipeViewer component

```tsx
// packages/studio/src/RecipeViewer.tsx
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

interface RecipeViewerProps {
  definition: RecipeDefinition;
  /** Optional: highlight these state ids (e.g. for simulation) */
  activeStateIds?: string[];
}

export function RecipeViewer({ definition, activeStateIds = [] }: RecipeViewerProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    layoutDefinition(definition).then(({ nodes, edges }) => {
      setNodes(nodes);
      setEdges(edges);
    });
  }, [definition]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ stateNode: StateNode }}
        edgeTypes={{ transitionEdge: TransitionEdge }}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
```

### App.tsx (dev harness)

Import `triageDefinition` from `@sweny-ai/engine` and render it:
```tsx
import { triageDefinition } from "@sweny-ai/engine";
import { RecipeViewer } from "./RecipeViewer";

export function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <RecipeViewer definition={triageDefinition} />
    </div>
  );
}
```

### Swimlane visualization (stretch goal)

If time permits, group states by phase into horizontal swimlanes:
- Top lane: "learn" states (blue tint)
- Middle lane: "act" states (amber tint)
- Bottom lane: "report" states (green tint)

Use ELK's `"elk.partitioning.activate": "true"` and assign partition IDs by phase.

## Success criteria
1. `npm run dev` in `packages/studio` starts a Vite dev server
2. The triage recipe DAG renders correctly with all 8 states visible
3. All transitions (edges) are visible and labeled with their outcome keys
4. ELK auto-layout produces a clean left-to-right graph with no overlapping nodes
5. Phase badges are color-coded correctly
6. `critical` badge is visible on `verify-access`, `build-context`, `investigate`
7. Pan, zoom, and minimap all work
8. No TypeScript errors: `npm run typecheck` passes

## Notes
- Do NOT implement editing yet — read-only only in this phase
- Do NOT add any backend/persistence — just a local React app
- Do NOT add authentication — open, no login
- `elkjs` is synchronous in bundled mode (`elk.bundled.js`) — no worker needed for phase 1

## Commit when done
```
git add packages/studio/
git commit -m "feat(studio): Phase 1 — read-only React Flow DAG visualizer for RecipeDefinition"
```
Then rename: `mv dag-studio-viz.todo.md dag-studio-viz.done.md`
