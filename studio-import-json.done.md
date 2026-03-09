# Task: Studio — Import JSON (Drag-and-Drop & Paste)

## Goal
Let users load a `RecipeDefinition` from JSON into the studio editor. Two entry points:
1. Drag and drop a `.recipe.json` file onto the canvas
2. "Import" button in the toolbar that opens a modal with a paste-able textarea

Both validate the JSON against the engine's JSON schema before loading.

## Repo context
- Package: `packages/studio`
- Typecheck: `npm run typecheck` inside `packages/studio`
- `@sweny-ai/engine` → `dist/browser.js` (browser alias in vite.config.ts)
- `validateDefinition` is exported from `@sweny-ai/engine` (via browser entry)
- JSON schema is available at `@sweny-ai/engine/schema` — but that's a file path, not importable in browser via the alias. Use `validateDefinition` from the engine for structural validation instead of AJV.

## Step 1: Import modal component (`src/components/ImportModal.tsx`)

```tsx
import { useState } from "react";
import { validateDefinition } from "@sweny-ai/engine";
import type { RecipeDefinition } from "@sweny-ai/engine";

interface ImportModalProps {
  onImport(def: RecipeDefinition): void;
  onClose(): void;
}

export function ImportModal({ onImport, onClose }: ImportModalProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleImport() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // Structural validation: must have required fields
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).id !== "string" ||
      typeof (parsed as Record<string, unknown>).version !== "string" ||
      typeof (parsed as Record<string, unknown>).name !== "string" ||
      typeof (parsed as Record<string, unknown>).initial !== "string" ||
      typeof (parsed as Record<string, unknown>).states !== "object"
    ) {
      setError("JSON does not match RecipeDefinition shape: missing required fields (id, version, name, initial, states)");
      return;
    }

    const def = parsed as RecipeDefinition;

    // Use the engine's validateDefinition for graph integrity
    const errors = validateDefinition(def);
    if (errors.length > 0) {
      setError(
        "Recipe definition has errors:\n" +
          errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
      );
      return;
    }

    onImport(def);
    onClose();
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-800 text-sm">Import Recipe JSON</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 p-4 overflow-auto">
          <p className="text-xs text-gray-500 mb-2">
            Paste a <code>RecipeDefinition</code> JSON object. Must have{" "}
            <code>id</code>, <code>version</code>, <code>name</code>, <code>initial</code>, and <code>states</code>.
          </p>
          <textarea
            className="w-full h-64 font-mono text-xs border border-gray-300 rounded p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            placeholder='{ "id": "my-recipe", "version": "1.0.0", ... }'
            spellCheck={false}
          />
          {error && (
            <pre className="mt-2 text-xs text-red-600 bg-red-50 rounded p-2 whitespace-pre-wrap overflow-auto max-h-32">
              {error}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleImport} disabled={!text.trim()}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40">
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Step 2: Drag-and-drop overlay

Create `src/components/DropOverlay.tsx`:

```tsx
import { useState, useEffect, useCallback } from "react";
import { validateDefinition } from "@sweny-ai/engine";
import type { RecipeDefinition } from "@sweny-ai/engine";

interface DropOverlayProps {
  onImport(def: RecipeDefinition): void;
}

export function DropOverlay({ onImport }: DropOverlayProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDragOver = useCallback((e: DragEvent) => {
    // Only activate for file drops
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);

    const file = e.dataTransfer?.files[0];
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      setError("Only .json files are supported");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        const errors = validateDefinition(parsed);
        if (errors.length > 0) {
          setError(errors.map((e) => `[${e.code}] ${e.message}`).join("\n"));
          return;
        }
        onImport(parsed as RecipeDefinition);
      } catch (e) {
        setError(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    reader.readAsText(file);
  }, [onImport]);

  useEffect(() => {
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onDragOver, onDragLeave, onDrop]);

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <>
      {/* Drop indicator overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-blue-500/20 border-4 border-dashed border-blue-500 z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-lg px-8 py-6 shadow-xl text-center">
            <p className="text-2xl mb-1">📂</p>
            <p className="font-semibold text-gray-800">Drop .recipe.json to import</p>
          </div>
        </div>
      )}
      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs px-4 py-2 rounded shadow-lg z-50 max-w-sm text-center">
          {error}
        </div>
      )}
    </>
  );
}
```

## Step 3: Add "Import" button to Toolbar

In `Toolbar.tsx`, add a state for the modal and an Import button:

```tsx
const [showImport, setShowImport] = useState(false);
const { setDefinition, clear } = ...; // existing

function handleImport(def: RecipeDefinition) {
  clear(); // reset undo history
  setDefinition(def);
}

// In JSX toolbar, near the Export button:
<button onClick={() => setShowImport(true)}
  className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs">
  ↑ Import
</button>

{showImport && (
  <ImportModal
    onImport={handleImport}
    onClose={() => setShowImport(false)}
  />
)}
```

## Step 4: Wire DropOverlay into App.tsx

```tsx
import { DropOverlay } from "./components/DropOverlay.js";

// In App render, add inside the outermost div:
<DropOverlay onImport={(def) => {
  useTemporalStore().getState().clear();
  useEditorStore.getState().setDefinition(def);
}} />
```

Or cleaner — use the store action directly in the callback:
```tsx
const setDefinition = useEditorStore((s) => s.setDefinition);
const clear = useTemporalStore().getState().clear;

<DropOverlay onImport={(def) => { clear(); setDefinition(def); }} />
```

## Step 5: Keyboard shortcut for import

Add to the keyboard shortcut `useEffect` in `App.tsx`:
```typescript
if (meta && e.key === "o") { // Cmd+O
  e.preventDefault();
  setShowImport(true);  // lift state to App if needed
}
```

Actually, since `showImport` is in Toolbar, pass a prop or use a simple ref/event.
Simplest: lift `showImport` state to `App.tsx` and pass `onImportOpen` to `Toolbar`.

## Success criteria
1. "↑ Import" button in toolbar opens modal
2. Pasting valid JSON and clicking Import loads the recipe — canvas re-renders with ELK layout
3. Pasting invalid JSON shows a clear error message (parse error or schema error)
4. Pasting a definition where `initial` points to a non-existent state shows validation error
5. Drag a `.recipe.json` file over the canvas — drop indicator appears
6. Dropping a valid file loads the recipe
7. Dropping an invalid file shows an error toast that auto-dismisses after 5 seconds
8. Importing clears undo history (can't undo to the previous recipe)
9. Cmd+O opens the import modal
10. `npm run typecheck` passes

## Commit when done
```
git add packages/studio/
git commit -m "feat(studio): import JSON via modal paste and drag-and-drop"
```
Then rename: `mv studio-import-json.todo.md studio-import-json.done.md`
