import { useState, useCallback, useEffect } from "react";
import { triageDefinition, implementDefinition } from "@sweny-ai/engine";
import { useEditorStore, useTemporalStore } from "./store/editor-store.js";
import { RecipeViewer } from "./RecipeViewer.js";
import { PropertiesPanel } from "./components/PropertiesPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import type { RecipeDefinition } from "@sweny-ai/engine";

const PRESET_RECIPES: Array<{ id: string; name: string; definition: RecipeDefinition }> = [
  { id: "triage", name: "triage", definition: triageDefinition },
  { id: "implement", name: "implement", definition: implementDefinition },
];

export function App() {
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const [activeId, setActiveId] = useState("triage");

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

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const { undo, redo } = useEditorStore.temporal.getState();
      const { selection, deleteState, setSelection } = useEditorStore.getState();

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
      <Toolbar availableRecipes={PRESET_RECIPES} activeRecipeId={activeId} onRecipeChange={handleRecipeChange} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RecipeViewer />
        </div>
        <PropertiesPanel />
      </div>
    </div>
  );
}

// Re-export useTemporalStore for use in Toolbar
export { useTemporalStore };
