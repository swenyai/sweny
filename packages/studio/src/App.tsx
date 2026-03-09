import { useState, useCallback, useEffect, useMemo } from "react";
import { triageDefinition, implementDefinition, validateDefinition } from "@sweny-ai/engine";
import { useEditorStore, useTemporalStore } from "./store/editor-store.js";
import { RecipeViewer } from "./RecipeViewer.js";
import { PropertiesPanel } from "./components/PropertiesPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import { DropOverlay } from "./components/DropOverlay.js";
import { SimulationPanel } from "./components/SimulationPanel.js";
import { LiveConnectPanel } from "./components/LiveConnectPanel.js";
import type { RecipeDefinition } from "@sweny-ai/engine";
import { readPermalinkFromHash, encodeRecipe } from "./lib/permalink.js";

const PRESET_RECIPES: Array<{ id: string; name: string; definition: RecipeDefinition }> = [
  { id: "triage", name: "triage", definition: triageDefinition },
  { id: "implement", name: "implement", definition: implementDefinition },
];

export function App() {
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const definition = useEditorStore((s) => s.definition);
  const mode = useEditorStore((s) => s.mode);
  const [activeId, setActiveId] = useState("triage");
  const [showImport, setShowImport] = useState(false);
  const validationErrors = useMemo(() => validateDefinition(definition), [definition]);

  // On mount, load recipe from URL hash if present
  useEffect(() => {
    const fromLink = readPermalinkFromHash();
    if (fromLink) {
      setDefinition(fromLink);
      // Clear undo history so the user doesn't undo back to the default recipe
      useEditorStore.temporal.getState().clear();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep URL hash in sync as user edits (use replaceState to avoid polluting history)
  useEffect(() => {
    const encoded = encodeRecipe(definition);
    const newHash = `#def=${encoded}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", newHash);
    }
  }, [definition]);

  const handleRecipeChange = useCallback(
    (id: string) => {
      const recipe = PRESET_RECIPES.find((r) => r.id === id);
      if (!recipe) return;
      const { clear } = useEditorStore.temporal.getState();
      clear(); // reset undo history
      setDefinition(recipe.definition);
      setActiveId(id);
    },
    [setDefinition],
  );

  const handleDropImport = useCallback(
    (def: RecipeDefinition) => {
      useEditorStore.temporal.getState().clear();
      setDefinition(def);
    },
    [setDefinition],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const { undo, redo } = useEditorStore.temporal.getState();
      const { selection, deleteState, setSelection } = useEditorStore.getState();

      if (meta && e.key === "o") {
        e.preventDefault();
        setShowImport(true);
        return;
      }
      if (meta && e.shiftKey && e.key === "z") {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selection?.kind === "state") {
        if (window.confirm(`Delete state "${selection.id}"?`)) {
          deleteState(selection.id);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <Toolbar
        availableRecipes={PRESET_RECIPES}
        activeRecipeId={activeId}
        onRecipeChange={handleRecipeChange}
        showImport={showImport}
        onShowImportChange={setShowImport}
      />
      {mode === "design" && validationErrors.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
          <span className="text-amber-600 text-xs font-medium">
            ⚠ {validationErrors.length} validation {validationErrors.length === 1 ? "error" : "errors"}:
          </span>
          <span className="text-amber-700 text-xs">{validationErrors.map((e) => e.message).join(" · ")}</span>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1 }}>
            <RecipeViewer />
          </div>
          {/* Bottom execution panel */}
          {mode === "simulate" && <SimulationPanel />}
          {mode === "live" && <LiveConnectPanel />}
        </div>
        {/* Right sidebar — design mode only */}
        {mode === "design" && <PropertiesPanel />}
      </div>
      <DropOverlay onImport={handleDropImport} />
    </div>
  );
}

// Re-export useTemporalStore for use in Toolbar
export { useTemporalStore };
