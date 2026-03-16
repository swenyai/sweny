import { useState, useCallback, useEffect, useMemo } from "react";
import { triageDefinition, implementDefinition, validateWorkflow } from "@sweny-ai/engine";
import { useEditorStore, useTemporalStore } from "./store/editor-store.js";
import { WorkflowViewer } from "./WorkflowViewer.js";
import { PropertiesPanel } from "./components/PropertiesPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import { DropOverlay } from "./components/DropOverlay.js";
import { SimulationPanel } from "./components/SimulationPanel.js";
import { LiveConnectPanel } from "./components/LiveConnectPanel.js";
import type { WorkflowDefinition } from "@sweny-ai/engine";
import { readPermalinkFromHash, encodeWorkflow } from "./lib/permalink.js";

const PRESET_WORKFLOWS: Array<{ id: string; name: string; definition: WorkflowDefinition }> = [
  { id: "triage", name: "triage", definition: triageDefinition },
  { id: "implement", name: "implement", definition: implementDefinition },
];

export function App() {
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const definition = useEditorStore((s) => s.definition);
  const mode = useEditorStore((s) => s.mode);
  const [activeId, setActiveId] = useState("triage");
  const [showImport, setShowImport] = useState(false);
  const [forkToast, setForkToast] = useState<string | null>(null);
  const validationErrors = useMemo(() => validateWorkflow(definition), [definition]);

  // Whether the currently displayed workflow is an unmodified preset
  const isBuiltinWorkflow = PRESET_WORKFLOWS.some((p) => p.id === activeId);

  // On mount, load workflow from URL hash if present
  useEffect(() => {
    const fromLink = readPermalinkFromHash();
    if (fromLink) {
      setDefinition(fromLink);
      // Clear undo history so the user doesn't undo back to the default workflow
      useEditorStore.temporal.getState().clear();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep URL hash in sync as user edits (use replaceState to avoid polluting history)
  useEffect(() => {
    const encoded = encodeWorkflow(definition);
    const newHash = `#def=${encoded}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", newHash);
    }
  }, [definition]);

  const handleWorkflowChange = useCallback(
    (id: string) => {
      const workflow = PRESET_WORKFLOWS.find((w) => w.id === id);
      if (!workflow) return;
      const { clear } = useEditorStore.temporal.getState();
      clear(); // reset undo history
      setDefinition(workflow.definition);
      setActiveId(id);
    },
    [setDefinition],
  );

  const handleFork = useCallback(() => {
    const { clear } = useEditorStore.temporal.getState();
    clear();
    const forked = {
      ...definition,
      id: `${definition.id}-fork`,
      name: `${definition.name} (Fork)`,
    };
    setDefinition(forked);
    setActiveId("custom");
    setForkToast(`Forked! Customize your workflow then export as YAML.`);
    setTimeout(() => setForkToast(null), 4000);
  }, [definition, setDefinition]);

  const handleDropImport = useCallback(
    (def: WorkflowDefinition) => {
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
      const { selection, deleteStep, setSelection } = useEditorStore.getState();

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
      if ((e.key === "Backspace" || e.key === "Delete") && selection?.kind === "step") {
        if (window.confirm(`Delete step "${selection.id}"?`)) {
          deleteStep(selection.id);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <Toolbar
        availableWorkflows={PRESET_WORKFLOWS}
        activeWorkflowId={activeId}
        onWorkflowChange={handleWorkflowChange}
        showImport={showImport}
        onShowImportChange={setShowImport}
        isBuiltinWorkflow={isBuiltinWorkflow}
        onFork={handleFork}
      />
      {forkToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-amber-700 text-white text-xs px-4 py-2 rounded shadow-xl z-50">
          {forkToast}
        </div>
      )}
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
            <WorkflowViewer />
          </div>
          {/* Bottom execution panel */}
          {mode === "simulate" && <SimulationPanel />}
          {mode === "live" && <LiveConnectPanel />}
        </div>
        {/* Right sidebar — always visible; shows execution results in simulate/live */}
        <PropertiesPanel />
      </div>
      <DropOverlay onImport={handleDropImport} />
    </div>
  );
}

// Re-export useTemporalStore for use in Toolbar
export { useTemporalStore };
