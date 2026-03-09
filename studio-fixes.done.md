# Task: Studio — Fix ELK Typing, Tailwind Setup, and Dev UX

## Goal
Fix three concrete issues in `packages/studio` before Phase 2 (editing) begins:
1. ELK type cast is a hack — fix with a proper Vite alias
2. Verify Tailwind is actually working (styles render in dev server)
3. Improve the dev harness to show both recipes and a toggle between them
4. Remove redundant `proOptions` prop

## Repo context
- Package: `packages/studio`
- Dev server: `npm run dev` inside `packages/studio`
- Typecheck: `npm run typecheck` inside `packages/studio`
- Build: `npm run build` inside `packages/studio`
- This task depends on `engine-definition-source-of-truth.done.md` existing first (needs `implementDefinition` to be exported)

## Fix 1: ELK typing — use Vite alias

**Current hack in `packages/studio/src/layout/elk.ts`:**
```typescript
const elk = new (ELK as new () => { layout: (graph: unknown) => Promise<unknown> })();
```
This is fragile — it discards all ELK type information.

**Fix:**
In `packages/studio/vite.config.ts`, add an alias so that `import ELK from "elkjs"` resolves
to the browser-safe bundled version at runtime, while TypeScript gets proper types from the
main `elkjs` package entry:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["elkjs/lib/elk.bundled.js"],
  },
  resolve: {
    alias: {
      // In the browser, redirect "elkjs" to the bundled (no-worker) version
      "elkjs": resolve(__dirname, "node_modules/elkjs/lib/elk.bundled.js"),
      // In the browser, redirect @sweny-ai/engine to the browser-safe entry
      "@sweny-ai/engine": resolve(__dirname, "../../packages/engine/dist/browser.js"),
    },
  },
});
```

Then rewrite `packages/studio/src/layout/elk.ts` to use clean types:

```typescript
import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs";
import type { Edge } from "@xyflow/react";
import type { RecipeDefinition } from "@sweny-ai/engine";
import type { StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";
import { definitionToFlow, extractTransitions } from "../lib/definition-to-flow.js";

const elk = new ELK();

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

export async function layoutDefinition(def: RecipeDefinition): Promise<{
  nodes: StateNodeType[];
  edges: Edge<TransitionEdgeData>[];
}> {
  const { nodes: rfNodes, edges: rfEdges } = definitionToFlow(def);
  const transitions = extractTransitions(def);

  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.edgeNodeBetweenLayers": "40",
    },
    children: rfNodes.map((node): ElkNode => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: transitions.map(({ source, target, label }): ElkExtendedEdge => ({
      id: `${source}--${label}--${target}`,
      sources: [source],
      targets: [target],
    })),
  };

  const layout = await elk.layout(elkGraph);

  const positionedNodes: StateNodeType[] = rfNodes.map((node) => {
    const elkNode = layout.children?.find((c) => c.id === node.id);
    return {
      ...node,
      position: {
        x: elkNode?.x ?? 0,
        y: elkNode?.y ?? 0,
      },
    };
  });

  return { nodes: positionedNodes, edges: rfEdges };
}
```

Note: `ElkNode` and `ElkExtendedEdge` are the proper elkjs types. No casting needed.

## Fix 2: Verify Tailwind is configured

Read `packages/studio/src/index.css`. It should contain Tailwind directives:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Check if `packages/studio/tailwind.config.js` (or `.ts`) exists and has `content` paths.
If missing, create it:

```javascript
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
```

Check if `packages/studio/postcss.config.js` exists. If missing, create it:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Verify `packages/studio/package.json` has `tailwindcss`, `autoprefixer`, and `postcss` as devDependencies.
If missing, run: `npm install --save-dev tailwindcss autoprefixer postcss` inside `packages/studio`.

Check `packages/studio/src/main.tsx` imports `./index.css`.

## Fix 3: Remove redundant proOptions prop

In `packages/studio/src/RecipeViewer.tsx`, remove the line:
```tsx
proOptions={{ hideAttribution: false }}
```
This is the default — the prop is noise. ReactFlow attribution will still show.

## Fix 4: Improve dev harness to show both recipes

Update `packages/studio/src/App.tsx` to show a toggle between triage and implement recipes:

```tsx
import { useState } from "react";
import { triageDefinition, implementDefinition } from "@sweny-ai/engine";
import { RecipeViewer } from "./RecipeViewer.js";
import type { RecipeDefinition } from "@sweny-ai/engine";

const recipes: Record<string, RecipeDefinition> = {
  triage: triageDefinition,
  implement: implementDefinition,
};

export function App() {
  const [active, setActive] = useState<string>("triage");

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700">
        <span className="font-bold text-white mr-2">sweny studio</span>
        {Object.keys(recipes).map((key) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={`px-3 py-1 rounded text-sm ${
              active === key
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {key}
          </button>
        ))}
      </div>
      {/* Canvas */}
      <div style={{ flex: 1 }}>
        <RecipeViewer definition={recipes[active]!} />
      </div>
    </div>
  );
}
```

## Success criteria
1. `npm run typecheck` passes in `packages/studio` — no ELK type errors
2. `npm run build` passes
3. Tailwind classes render visibly in the dev server (phase badges are colored, not unstyled)
4. Both triage and implement recipe graphs render when toggling in the dev harness
5. No TypeScript `any` or unsafe casts remaining in `elk.ts`

## Commit when done
```
git add packages/studio/
git commit -m "fix(studio): proper ELK typing via Vite alias, Tailwind setup, dual-recipe dev harness"
```
Then rename: `mv studio-fixes.todo.md studio-fixes.done.md`
