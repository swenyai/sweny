import { useState } from "react";
import { useStore } from "zustand";
import type { WorkflowPhase } from "@sweny-ai/engine";
import type { RecipeDefinition } from "@sweny-ai/engine";
import { useEditorStore, useTemporalStore } from "../store/editor-store.js";
import type { StudioMode } from "../store/editor-store.js";
import { ImportModal } from "./ImportModal.js";

interface ToolbarProps {
  onRecipeChange(id: string): void;
  activeRecipeId: string;
  availableRecipes: Array<{ id: string; name: string }>;
  showImport: boolean;
  onShowImportChange(open: boolean): void;
}

export function Toolbar({
  onRecipeChange,
  activeRecipeId,
  availableRecipes,
  showImport,
  onShowImportChange,
}: ToolbarProps) {
  const temporalStore = useTemporalStore();

  // Subscribe reactively to pastStates/futureStates
  const pastStates = useStore(temporalStore, (s) => s.pastStates);
  const futureStates = useStore(temporalStore, (s) => s.futureStates);

  const definition = useEditorStore((s) => s.definition);
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const addState = useEditorStore((s) => s.addState);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const resetExecution = useEditorStore((s) => s.resetExecution);
  const [newStateId, setNewStateId] = useState("");
  const [newStatePhase, setNewStatePhase] = useState<WorkflowPhase>("act");

  function switchMode(newMode: StudioMode) {
    if (newMode !== mode) {
      resetExecution();
      setMode(newMode);
    }
  }

  function handleImport(def: RecipeDefinition) {
    temporalStore.getState().clear();
    setDefinition(def);
  }

  function handleExport() {
    const json = JSON.stringify(definition, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${definition.id}.recipe.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleAddState(e: React.FormEvent) {
    e.preventDefault();
    if (!newStateId.trim()) return;
    addState(newStateId.trim(), newStatePhase);
    setNewStateId("");
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700 flex-shrink-0">
      {/* Brand */}
      <span className="font-bold text-white mr-2">sweny studio</span>

      {/* Recipe switcher */}
      <div className="flex gap-1 mr-4">
        {availableRecipes.map((r) => (
          <button
            key={r.id}
            onClick={() => onRecipeChange(r.id)}
            className={`px-3 py-1 rounded text-xs ${
              activeRecipeId === r.id ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* Mode toggle: Design | Simulate | Live */}
      <div className="flex rounded overflow-hidden border border-gray-600 mr-2">
        {(["design", "simulate", "live"] as StudioMode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`px-3 py-1 text-xs ${mode === m ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Undo / Redo */}
      <button
        onClick={() => temporalStore.getState().undo()}
        disabled={pastStates.length === 0}
        title="Undo (Cmd+Z)"
        className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600"
      >
        ↩
      </button>
      <button
        onClick={() => temporalStore.getState().redo()}
        disabled={futureStates.length === 0}
        title="Redo (Cmd+Shift+Z)"
        className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600"
      >
        ↪
      </button>

      <div className="flex-1" />

      {/* Add state */}
      <form onSubmit={handleAddState} className="flex gap-1">
        <input
          value={newStateId}
          onChange={(e) => setNewStateId(e.target.value)}
          placeholder="state-id"
          className="px-2 py-1 rounded bg-gray-700 text-white text-xs w-28 placeholder-gray-400"
        />
        <select
          value={newStatePhase}
          onChange={(e) => setNewStatePhase(e.target.value as WorkflowPhase)}
          className="px-1 py-1 rounded bg-gray-700 text-white text-xs"
        >
          <option value="learn">learn</option>
          <option value="act">act</option>
          <option value="report">report</option>
        </select>
        <button type="submit" className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">
          + State
        </button>
      </form>

      {/* Import */}
      <button
        onClick={() => onShowImportChange(true)}
        className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
      >
        ↑ Import
      </button>

      {/* Export */}
      <button onClick={handleExport} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs ml-2">
        ↓ Export JSON
      </button>

      {showImport && <ImportModal onImport={handleImport} onClose={() => onShowImportChange(false)} />}
    </div>
  );
}
