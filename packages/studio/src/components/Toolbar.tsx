import { useState, useEffect } from "react";
import { useStore } from "zustand";
import type { Workflow } from "@sweny-ai/core";
import { useEditorStore, useTemporalStore } from "../store/editor-store.js";
import type { StudioMode } from "../store/editor-store.js";
import { ImportModal } from "./ImportModal.js";
import { HelpPanel } from "./HelpPanel.js";
import { exportWorkflowYaml } from "../lib/export-yaml.js";
import { exportAsTypescript } from "../lib/export-typescript.js";
import { exportAsGitHubActions } from "../lib/export-github-actions.js";
import { buildPermalinkUrl } from "../lib/permalink.js";

interface ToolbarProps {
  onWorkflowChange(id: string): void;
  activeWorkflowId: string;
  availableWorkflows: Array<{ id: string; name: string }>;
  showImport: boolean;
  onShowImportChange(open: boolean): void;
  showHelp: boolean;
  onShowHelpChange(open: boolean): void;
  onFork?(): void;
  isBuiltinWorkflow?: boolean;
}

export function Toolbar({
  onWorkflowChange,
  activeWorkflowId,
  availableWorkflows,
  showImport,
  onShowImportChange,
  showHelp,
  onShowHelpChange,
  onFork,
  isBuiltinWorkflow,
}: ToolbarProps) {
  const temporalStore = useTemporalStore();

  const pastStates = useStore(temporalStore, (s) => s.pastStates);
  const futureStates = useStore(temporalStore, (s) => s.futureStates);

  const setWorkflow = useEditorStore((s) => s.setWorkflow);
  const addNode = useEditorStore((s) => s.addNode);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const resetExecution = useEditorStore((s) => s.resetExecution);

  const [newNodeId, setNewNodeId] = useState("");
  const [copied, setCopied] = useState(false);

  function switchMode(newMode: StudioMode) {
    if (newMode !== mode) {
      resetExecution();
      setMode(newMode);
    }
  }

  function handleImport(wf: Workflow) {
    temporalStore.getState().clear();
    setWorkflow(wf);
  }

  function handleExportYaml() {
    const { workflow } = useEditorStore.getState();
    const content = exportWorkflowYaml(workflow);
    const blob = new Blob([content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.id}.workflow.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJson() {
    const { workflow } = useEditorStore.getState();
    const json = JSON.stringify(workflow, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.id}.workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportTypescript() {
    const { workflow } = useEditorStore.getState();
    const content = exportAsTypescript(workflow);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.id}.workflow.ts`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportGitHubActions() {
    const { workflow } = useEditorStore.getState();
    const content = exportAsGitHubActions(workflow);
    const blob = new Blob([content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sweny-${workflow.id}.yml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyLink() {
    const { workflow } = useEditorStore.getState();
    const url = buildPermalinkUrl(workflow);
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      (err) => {
        console.error("Failed to copy share link:", err);
      },
    );
  }

  function handleAddNode(e: React.FormEvent) {
    e.preventDefault();
    const id = newNodeId.trim();
    if (!id) return;
    addNode(id);
    setNewNodeId("");
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700 flex-shrink-0">
      {/* Brand */}
      <span className="font-bold text-white mr-2">sweny studio</span>

      {/* Workflow switcher */}
      <div className="flex gap-1 mr-2">
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

      {/* Fork button */}
      {isBuiltinWorkflow && onFork && (
        <button
          onClick={onFork}
          title="Fork this workflow to customize it"
          className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs text-white"
        >
          Fork
        </button>
      )}

      {/* Mode toggle */}
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

      {/* Add node */}
      <form onSubmit={handleAddNode} className="flex gap-1">
        <input
          value={newNodeId}
          onChange={(e) => setNewNodeId(e.target.value)}
          placeholder="node-id"
          className="px-2 py-1 rounded bg-gray-700 text-white text-xs w-28 placeholder-gray-400"
        />
        <button type="submit" className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">
          + Node
        </button>
      </form>

      {/* Import */}
      <button
        onClick={() => onShowImportChange(true)}
        className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
      >
        Import
      </button>

      {/* Export buttons */}
      <button onClick={handleExportYaml} className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-xs ml-2">
        YAML
      </button>
      <button onClick={handleExportJson} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs">
        JSON
      </button>
      <button onClick={handleExportTypescript} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs">
        TypeScript
      </button>
      <button
        onClick={handleExportGitHubActions}
        title="Export as GitHub Actions workflow YAML"
        className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
      >
        GH Actions
      </button>

      {/* Share link */}
      <button
        onClick={handleCopyLink}
        className="px-3 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
      >
        {copied ? "Copied!" : "Share link"}
      </button>

      {/* Help */}
      <button
        onClick={() => onShowHelpChange(true)}
        title="Keyboard shortcuts (?)"
        className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300"
      >
        ?
      </button>

      {showImport && <ImportModal onImport={handleImport} onClose={() => onShowImportChange(false)} />}
      {showHelp && <HelpPanel onClose={() => onShowHelpChange(false)} />}
    </div>
  );
}
