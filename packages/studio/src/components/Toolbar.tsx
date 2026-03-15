import { useState } from "react";
import { useStore } from "zustand";
import type { WorkflowPhase, WorkflowDefinition } from "@sweny-ai/engine";
import { useEditorStore, useTemporalStore } from "../store/editor-store.js";
import type { StudioMode } from "../store/editor-store.js";
import { ImportModal } from "./ImportModal.js";
import { exportAsTypescript } from "../lib/export-typescript.js";
import { buildPermalinkUrl } from "../lib/permalink.js";

interface ToolbarProps {
  onWorkflowChange(id: string): void;
  activeWorkflowId: string;
  availableWorkflows: Array<{ id: string; name: string }>;
  showImport: boolean;
  onShowImportChange(open: boolean): void;
}

export function Toolbar({
  onWorkflowChange,
  activeWorkflowId,
  availableWorkflows,
  showImport,
  onShowImportChange,
}: ToolbarProps) {
  const temporalStore = useTemporalStore();

  // Subscribe reactively to pastStates/futureStates
  const pastStates = useStore(temporalStore, (s) => s.pastStates);
  const futureStates = useStore(temporalStore, (s) => s.futureStates);

  const definition = useEditorStore((s) => s.definition);
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const addStep = useEditorStore((s) => s.addStep);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const resetExecution = useEditorStore((s) => s.resetExecution);
  const [newStepId, setNewStepId] = useState("");
  const [newStepPhase, setNewStepPhase] = useState<WorkflowPhase>("act");
  const [copied, setCopied] = useState(false);

  function switchMode(newMode: StudioMode) {
    if (newMode !== mode) {
      resetExecution();
      setMode(newMode);
    }
  }

  function handleImport(def: WorkflowDefinition) {
    temporalStore.getState().clear();
    setDefinition(def);
  }

  function handleExport() {
    const json = JSON.stringify(definition, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${definition.id}.workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportTs() {
    const { definition: def } = useEditorStore.getState();
    const content = exportAsTypescript(def);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${def.id}.ts`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyLink() {
    const { definition: def } = useEditorStore.getState();
    const url = buildPermalinkUrl(def);
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Clipboard write failed (non-HTTPS or browser security policy).
        // The URL bar already reflects the current workflow via the hash sync in App.tsx,
        // so the user can still copy it manually.
      },
    );
  }

  function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    if (!newStepId.trim()) return;
    addStep(newStepId.trim(), newStepPhase);
    setNewStepId("");
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700 flex-shrink-0">
      {/* Brand */}
      <span className="font-bold text-white mr-2">sweny studio</span>

      {/* Workflow switcher */}
      <div className="flex gap-1 mr-4">
        {availableWorkflows.map((w) => (
          <button
            key={w.id}
            onClick={() => onWorkflowChange(w.id)}
            className={`px-3 py-1 rounded text-xs ${
              activeWorkflowId === w.id ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {w.name}
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

      {/* Add step */}
      <form onSubmit={handleAddStep} className="flex gap-1">
        <input
          value={newStepId}
          onChange={(e) => setNewStepId(e.target.value)}
          placeholder="step-id"
          className="px-2 py-1 rounded bg-gray-700 text-white text-xs w-28 placeholder-gray-400"
        />
        <select
          value={newStepPhase}
          onChange={(e) => setNewStepPhase(e.target.value as WorkflowPhase)}
          className="px-1 py-1 rounded bg-gray-700 text-white text-xs"
        >
          <option value="learn">learn</option>
          <option value="act">act</option>
          <option value="report">report</option>
        </select>
        <button type="submit" className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">
          + Step
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

      {/* Export TS */}
      <button onClick={handleExportTs} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs">
        ↓ Export TS
      </button>

      {/* Share link */}
      <button
        onClick={handleCopyLink}
        className="px-3 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
      >
        {copied ? "Copied!" : "Share link"}
      </button>

      {showImport && <ImportModal onImport={handleImport} onClose={() => onShowImportChange(false)} />}
    </div>
  );
}
