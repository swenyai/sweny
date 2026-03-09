# Task: Studio as Embeddable Library

## Goal
Build `@sweny-ai/studio` in library mode so other apps can embed the visualizer.
This is what Stately.ai explicitly cannot provide — an embeddable, self-hostable,
open-source workflow editor component.

Two exports:
- `<RecipeViewer definition={...} />` — read-only, zero dependencies on the store, for embedding
- `<RecipeEditor definition={...} onChange={...} />` — full editor, self-contained store

Also export the underlying hooks and types for advanced integrations.

## Repo context
- Package: `packages/studio`
- Build: `npm run build` inside `packages/studio`
- Typecheck: `npm run typecheck` inside `packages/studio`
- Current vite.config.ts builds an app (index.html entry). We need to ADD a library build
  alongside the app build (not replace it — we keep `npm run dev` working).

## Step 1: Restructure entry points

Create two new library entry point files:

### `src/lib-viewer.ts` — minimal read-only embed (no store, no editing)

```typescript
// Export only what's needed for read-only embedding
export { RecipeViewer } from "./RecipeViewer.js";
export type { RecipeViewerProps } from "./RecipeViewer.js";
```

For this to work, `RecipeViewer` must accept `definition` as a prop again (currently it reads
from the store). Create a new version:

**Do NOT change the existing `RecipeViewer.tsx`** — it's used by the editor app.

Instead, create `src/components/StandaloneViewer.tsx`:

```tsx
import { useState, useEffect } from "react";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { RecipeDefinition } from "@sweny-ai/engine";
import { StateNode } from "./StateNode.js";
import { TransitionEdge } from "./TransitionEdge.js";
import { layoutDefinition } from "../layout/elk.js";
import type { StateNodeType, StateNodeData } from "./StateNode.js";
import type { Edge } from "@xyflow/react";
import type { TransitionEdgeData } from "./TransitionEdge.js";

const nodeTypes = { stateNode: StateNode };
const edgeTypes = { transitionEdge: TransitionEdge };

export interface RecipeViewerProps {
  /** The RecipeDefinition to visualize. */
  definition: RecipeDefinition;
  /**
   * Highlight these state ids (e.g. from a live execution).
   * Keys are state ids, values are the execution status.
   */
  executionState?: Record<string, "current" | "success" | "failed" | "skipped">;
  /** Canvas height. Defaults to "100%". */
  height?: string | number;
}

export function RecipeViewer({ definition, executionState = {}, height = "100%" }: RecipeViewerProps) {
  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    layoutDefinition(definition)
      .then(({ nodes: n, edges: e }) => {
        setNodes(n.map((node) => ({
          ...node,
          data: {
            ...node.data,
            execStatus: executionState[node.id] ?? "pending",
          },
        })));
        setEdges(e);
      })
      .catch((err: unknown) => {
        setError(`Layout failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [definition, executionState]);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        width: "100%", height, background: "#fef2f2", color: "#b91c1c", padding: "1rem" }}>
        <code style={{ fontSize: "0.75rem" }}>{error}</code>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
        <MiniMap nodeColor={(node) => {
          const d = node.data as StateNodeData;
          if (d?.state?.phase === "learn") return "#bfdbfe";
          if (d?.state?.phase === "act") return "#fde68a";
          if (d?.state?.phase === "report") return "#bbf7d0";
          return "#e5e7eb";
        }} />
      </ReactFlow>
    </div>
  );
}
```

Note: `RecipeViewer` from `StandaloneViewer.tsx` takes `executionState` as a prop — a plain
Record. This makes it easy to connect to any external execution source without coupling to
the studio's Zustand store.

Export from `src/lib-viewer.ts`:
```typescript
export { RecipeViewer } from "./components/StandaloneViewer.js";
export type { RecipeViewerProps } from "./components/StandaloneViewer.js";
```

### `src/lib-editor.ts` — full editor embed

```typescript
export { RecipeViewer as StandaloneViewer } from "./components/StandaloneViewer.js";
export type { RecipeViewerProps } from "./components/StandaloneViewer.js";
// Future: export RecipeEditor (full editing UI) when it's extracted into embeddable form
// For now, export the store and types for advanced integrations
export { useEditorStore } from "./store/editor-store.js";
export type { EditorState, Selection, StudioMode } from "./store/editor-store.js";
```

## Step 2: Update vite.config.ts for dual builds

The config needs to support BOTH the app build (dev server + `npm run dev`) and the
library build. Use an environment variable to switch:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isLib = process.env.BUILD_MODE === "lib";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["elkjs/lib/elk.bundled.js"],
  },
  resolve: {
    alias: {
      elkjs: resolve(__dirname, "../../node_modules/elkjs/lib/elk.bundled.js"),
      "@sweny-ai/engine": resolve(__dirname, "../../packages/engine/dist/browser.js"),
    },
  },
  ...(isLib
    ? {
        // Library build
        build: {
          lib: {
            entry: {
              viewer: resolve(__dirname, "src/lib-viewer.ts"),
              editor: resolve(__dirname, "src/lib-editor.ts"),
            },
            formats: ["es"],
          },
          rollupOptions: {
            // Don't bundle peer dependencies — consumer provides them
            external: ["react", "react-dom", "@xyflow/react", "elkjs"],
            output: {
              // Preserve directory structure in dist/lib/
              assetFileNames: "lib/[name][extname]",
              chunkFileNames: "lib/chunks/[name]-[hash].js",
              entryFileNames: "lib/[name].js",
            },
          },
          outDir: "dist/lib",
          emptyOutDir: true,
        },
      }
    : {
        // App build (existing)
        build: {
          rollupOptions: {
            output: {
              manualChunks: {
                react: ["react", "react-dom"],
                xyflow: ["@xyflow/react"],
                elk: ["elkjs"],
                zustand: ["zustand", "immer", "zundo"],
              },
            },
          },
        },
      }),
});
```

## Step 3: Add library build script to package.json

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "build:lib": "tsc --noEmit && BUILD_MODE=lib vite build",
  "typecheck": "tsc --noEmit"
}
```

## Step 4: Generate TypeScript declarations for the library

The library needs `.d.ts` files. Add to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationDir": "dist/lib/types"
  }
}
```

But this conflicts with the app build (which doesn't want declarations everywhere).
Better: create a separate `tsconfig.lib.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationDir": "dist/lib/types",
    "emitDeclarationOnly": true,
    "rootDir": "src"
  },
  "include": ["src/lib-viewer.ts", "src/lib-editor.ts", "src/components/**/*.ts",
              "src/components/**/*.tsx", "src/layout/**/*.ts", "src/lib/**/*.ts",
              "src/store/**/*.ts"]
}
```

Update `build:lib` script:
```json
"build:lib": "tsc --project tsconfig.lib.json && BUILD_MODE=lib vite build"
```

## Step 5: Update package.json exports

```json
{
  "name": "@sweny-ai/studio",
  "exports": {
    ".": {
      "import": "./dist/lib/viewer.js",
      "types": "./dist/lib/types/lib-viewer.d.ts"
    },
    "./editor": {
      "import": "./dist/lib/editor.js",
      "types": "./dist/lib/types/lib-editor.d.ts"
    }
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@xyflow/react": "^12.0.0",
    "elkjs": "^0.9.0"
  }
}
```

Also add `"files": ["dist/lib"]` so `npm pack` only includes the library output, not the app build.

## Step 6: Verify the library build works

After `npm run build:lib`:
- `dist/lib/viewer.js` should exist and be an ES module
- `dist/lib/editor.js` should exist
- `dist/lib/types/lib-viewer.d.ts` should exist with exported types
- `react`, `react-dom`, `@xyflow/react`, `elkjs` should NOT be bundled (external)

Write a quick integration test by creating `dist/lib/test-import.mjs`:
```javascript
// Verify the exports resolve correctly (Node.js module resolution check)
// This isn't a functional test — just confirms the module graph is intact
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// If this file runs without error, exports are valid
console.log("Library build OK");
```

## Example usage (for documentation)

After building, consumers would use:
```tsx
import { RecipeViewer } from "@sweny-ai/studio";
import "@sweny-ai/studio/dist/lib/viewer.css"; // styles
import { triageDefinition } from "@sweny-ai/engine/browser";

// Read-only visualization
<RecipeViewer definition={triageDefinition} height={500} />

// With live execution highlighting
<RecipeViewer
  definition={triageDefinition}
  executionState={{
    "verify-access": "success",
    "build-context": "success",
    "investigate": "current",
  }}
  height={500}
/>
```

## Success criteria
1. `npm run build:lib` produces `dist/lib/viewer.js` and `dist/lib/editor.js`
2. Neither file bundles React, ReactFlow, or ELK (they're externalized)
3. `dist/lib/types/lib-viewer.d.ts` exports `RecipeViewer` and `RecipeViewerProps`
4. `npm run build` (app build) still works — dev server unaffected
5. `npm run typecheck` passes
6. `RecipeViewer` accepts `definition` as a prop (not reading from store)
7. `RecipeViewer` accepts `executionState` prop that highlights nodes

## Commit when done
```
git add packages/studio/
git commit -m "feat(studio): library mode build — embeddable RecipeViewer and RecipeEditor exports"
```
Then rename: `mv studio-library-mode.todo.md studio-library-mode.done.md`
