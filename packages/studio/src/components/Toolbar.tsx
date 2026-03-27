import { useState } from "react";
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
import { getStoredApiKey, setStoredApiKey } from "../lib/generate-instruction.js";

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
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const resetExecution = useEditorStore((s) => s.resetExecution);

  const [copied, setCopied] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());

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

  function download(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowExport(false);
  }

  function handleExportYaml() {
    const { workflow } = useEditorStore.getState();
    download(exportWorkflowYaml(workflow), `${workflow.id}.workflow.yaml`, "text/yaml");
  }

  function handleExportJson() {
    const { workflow } = useEditorStore.getState();
    download(JSON.stringify(workflow, null, 2), `${workflow.id}.workflow.json`, "application/json");
  }

  function handleExportTypescript() {
    const { workflow } = useEditorStore.getState();
    download(exportAsTypescript(workflow), `${workflow.id}.workflow.ts`, "text/plain");
  }

  function handleExportGitHubActions() {
    const { workflow } = useEditorStore.getState();
    download(exportAsGitHubActions(workflow), `sweny-${workflow.id}.yml`, "text/yaml");
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

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700 flex-shrink-0">
      {/* Brand */}
      <span className="font-bold text-white mr-1">sweny studio</span>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-600 mx-1" />

      {/* Workflow switcher */}
      <div className="flex gap-1">
        {availableWorkflows.map((w) => (
          <button
            key={w.id}
            onClick={() => onWorkflowChange(w.id)}
            className={`px-2.5 py-1 rounded text-xs ${
              activeWorkflowId === w.id ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {w.name}
          </button>
        ))}
        {isBuiltinWorkflow && onFork && (
          <button
            onClick={onFork}
            title="Fork this workflow to customize it"
            className="px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-amber-300"
          >
            fork
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-600 mx-1" />

      {/* Mode toggle */}
      <div className="flex rounded overflow-hidden border border-gray-600">
        {(["design", "simulate", "live"] as StudioMode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`px-2.5 py-1 text-xs ${mode === m ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
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
        className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600 text-xs"
      >
        undo
      </button>
      <button
        onClick={() => temporalStore.getState().redo()}
        disabled={futureStates.length === 0}
        title="Redo (Cmd+Shift+Z)"
        className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600 text-xs"
      >
        redo
      </button>

      <div className="flex-1" />

      {/* Import */}
      <button
        onClick={() => onShowImportChange(true)}
        className="px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
      >
        Import
      </button>

      {/* Export dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowExport((v) => !v)}
          onBlur={() => setTimeout(() => setShowExport(false), 150)}
          className="px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
        >
          Export
        </button>
        {showExport && (
          <div className="absolute top-full right-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-[140px] z-50">
            <button onClick={handleExportYaml} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700">
              YAML
            </button>
            <button onClick={handleExportJson} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700">
              JSON
            </button>
            <button
              onClick={handleExportTypescript}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700"
            >
              TypeScript
            </button>
            <button
              onClick={handleExportGitHubActions}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700"
            >
              GitHub Actions
            </button>
          </div>
        )}
      </div>

      {/* Share link */}
      <button onClick={handleCopyLink} className="px-2.5 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600">
        {copied ? "Copied!" : "Share"}
      </button>

      {/* Settings (API key) */}
      <div className="relative">
        <button
          onClick={() => setShowSettings((v) => !v)}
          title="Settings"
          className={`px-2 py-1 rounded text-xs ${apiKey ? "bg-gray-700 hover:bg-gray-600 text-green-400" : "bg-gray-700 hover:bg-gray-600 text-gray-300"}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 10a2 2 0 100-4 2 2 0 000 4zM6.5 1.2l-.3 1.7a5.5 5.5 0 00-1.4.8L3.2 3 1.8 5.4l1.3 1.1a5.6 5.6 0 000 1.6l-1.3 1.1 1.4 2.4 1.6-.7c.4.3.9.6 1.4.8l.3 1.7h2.9l.3-1.7c.5-.2 1-.5 1.4-.8l1.6.7 1.4-2.4-1.3-1.1a5.6 5.6 0 000-1.6l1.3-1.1-1.4-2.4-1.6.7a5.5 5.5 0 00-1.4-.8L9.4 1.2H6.5z" />
          </svg>
        </button>
        {showSettings && (
          <div className="absolute top-full right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-3 min-w-[260px] z-50">
            <label className="block text-[10px] font-medium text-gray-400 mb-1">Anthropic API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400"
            />
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={() => {
                  setStoredApiKey(apiKey);
                  setShowSettings(false);
                }}
                className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-500"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setApiKey("");
                  setStoredApiKey("");
                }}
                className="px-3 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600"
              >
                Clear
              </button>
            </div>
            <p className="text-[9px] text-gray-500 mt-2 leading-snug">
              Used for AI-assisted features. Stored locally, sent only to api.anthropic.com.
            </p>
          </div>
        )}
      </div>

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
