import { useState, useCallback, useEffect, useMemo } from "react";
import { validateWorkflow } from "@sweny-ai/core/schema";
import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows";
import type { Workflow } from "@sweny-ai/core";
import { useEditorStore, useTemporalStore } from "./store/editor-store.js";
import { WorkflowViewer } from "./WorkflowViewer.js";
import { PropertiesPanel } from "./components/PropertiesPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import { AiChat } from "./components/AiChat.js";
import { DropOverlay } from "./components/DropOverlay.js";
import { SimulationPanel } from "./components/SimulationPanel.js";
import { LiveConnectPanel } from "./components/LiveConnectPanel.js";
import { readPermalinkFromHash, encodeWorkflow } from "./lib/permalink.js";

const PRESET_WORKFLOWS: Array<{ id: string; name: string; workflow: Workflow }> = [
  { id: "triage", name: "triage", workflow: triageWorkflow },
  { id: "implement", name: "implement", workflow: implementWorkflow },
];

export function App() {
  const setWorkflow = useEditorStore((s) => s.setWorkflow);
  const workflow = useEditorStore((s) => s.workflow);
  const mode = useEditorStore((s) => s.mode);
  const setSelection = useEditorStore((s) => s.setSelection);
  const [activeId, setActiveId] = useState("triage");
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [forkToast, setForkToast] = useState<string | null>(null);
  const [aiGenerated, setAiGenerated] = useState(false);
  const validationErrors = useMemo(() => validateWorkflow(workflow), [workflow]);

  const isBuiltinWorkflow = PRESET_WORKFLOWS.some((p) => p.id === activeId);

  // On mount, load workflow from URL hash if present
  useEffect(() => {
    const fromLink = readPermalinkFromHash();
    if (fromLink) {
      setWorkflow(fromLink);
      useEditorStore.temporal.getState().clear();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep URL hash in sync as user edits
  useEffect(() => {
    const encoded = encodeWorkflow(workflow);
    const newHash = `#def=${encoded}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", newHash);
    }
  }, [workflow]);

  const handleWorkflowChange = useCallback(
    (id: string) => {
      const preset = PRESET_WORKFLOWS.find((w) => w.id === id);
      if (!preset) return;
      const { clear } = useEditorStore.temporal.getState();
      clear();
      setWorkflow(preset.workflow);
      setActiveId(id);
      setAiGenerated(false);
    },
    [setWorkflow],
  );

  const handleNew = useCallback(() => {
    const { clear } = useEditorStore.temporal.getState();
    clear();
    const blank: Workflow = {
      id: "my-workflow",
      name: "My Workflow",
      description: "Describe what this workflow does",
      entry: "start",
      nodes: {
        start: {
          name: "Start",
          instruction: "",
          skills: [],
        },
      },
      edges: [],
    };
    setWorkflow(blank);
    setActiveId("custom");
    setAiGenerated(false);
  }, [setWorkflow]);

  const handleFork = useCallback(() => {
    const { clear } = useEditorStore.temporal.getState();
    clear();
    const forked = {
      ...workflow,
      id: `${workflow.id}-fork`,
      name: `${workflow.name} (Fork)`,
    };
    setWorkflow(forked);
    setActiveId("custom");
    setAiGenerated(false);
    setForkToast(`Forked! Customize your workflow then export.`);
    setTimeout(() => setForkToast(null), 4000);
  }, [workflow, setWorkflow]);

  const handleDropImport = useCallback(
    (wf: Workflow) => {
      useEditorStore.temporal.getState().clear();
      setWorkflow(wf);
      setAiGenerated(false);
    },
    [setWorkflow],
  );

  const handleAiGenerated = useCallback(
    (wf: Workflow) => {
      useEditorStore.temporal.getState().clear();
      setWorkflow(wf);
      setActiveId("custom");
      setAiGenerated(true);
    },
    [setWorkflow],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) {
        return;
      }

      const meta = e.metaKey || e.ctrlKey;
      const { undo, redo } = useEditorStore.temporal.getState();
      const { selection, deleteNode, setSelection } = useEditorStore.getState();

      if (e.key === "?") {
        setShowHelp(true);
        return;
      }
      if (meta && e.key === "n") {
        e.preventDefault();
        handleNew();
        return;
      }
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
      if ((e.key === "Backspace" || e.key === "Delete") && selection?.kind === "node") {
        if (window.confirm(`Delete node "${selection.id}"?`)) {
          deleteNode(selection.id);
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
        showHelp={showHelp}
        onShowHelpChange={setShowHelp}
        isBuiltinWorkflow={isBuiltinWorkflow}
        onFork={handleFork}
        onNew={handleNew}
      />
      {forkToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-amber-700 text-white text-xs px-4 py-2 rounded shadow-xl z-50">
          {forkToast}
        </div>
      )}
      {mode === "design" && validationErrors.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-2 flex-shrink-0 flex-wrap">
          <span className="text-amber-600 text-xs font-medium">
            {validationErrors.length} validation {validationErrors.length === 1 ? "error" : "errors"}:
          </span>
          {validationErrors.map((e) => (
            <button
              key={e.message}
              onClick={() => (e.nodeId ? setSelection({ kind: "node", id: e.nodeId }) : undefined)}
              className={`text-amber-700 text-xs ${e.nodeId ? "hover:underline cursor-pointer" : "cursor-default"}`}
            >
              {e.message}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {mode === "design" && import.meta.env.DEV && (
          <AiChat onWorkflowGenerated={handleAiGenerated} currentWorkflow={workflow} hasGenerated={aiGenerated} />
        )}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1 }}>
            <WorkflowViewer />
          </div>
          {mode === "simulate" && <SimulationPanel />}
          {mode === "live" && <LiveConnectPanel />}
        </div>
        <PropertiesPanel />
      </div>
      <DropOverlay onImport={handleDropImport} />
    </div>
  );
}

export { useTemporalStore };
