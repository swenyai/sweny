import { useState } from "react";
import { useStore } from "zustand";
import type { WorkflowPhase, WorkflowDefinition } from "@sweny-ai/engine";
import { useEditorStore, useTemporalStore } from "../store/editor-store.js";
import type { StudioMode } from "../store/editor-store.js";
import { ImportModal } from "./ImportModal.js";
import { exportWorkflowYaml } from "../lib/export-yaml.js";
import { buildPermalinkUrl } from "../lib/permalink.js";
import { BUILTIN_STEP_TYPES, findStepType } from "../lib/step-types.js";

interface ToolbarProps {
  onWorkflowChange(id: string): void;
  activeWorkflowId: string;
  availableWorkflows: Array<{ id: string; name: string }>;
  showImport: boolean;
  onShowImportChange(open: boolean): void;
  onFork?(): void;
  isBuiltinWorkflow?: boolean;
}

export function Toolbar({
  onWorkflowChange,
  activeWorkflowId,
  availableWorkflows,
  showImport,
  onShowImportChange,
  onFork,
  isBuiltinWorkflow,
}: ToolbarProps) {
  const temporalStore = useTemporalStore();

  const pastStates = useStore(temporalStore, (s) => s.pastStates);
  const futureStates = useStore(temporalStore, (s) => s.futureStates);

  const definition = useEditorStore((s) => s.definition);
  const setDefinition = useEditorStore((s) => s.setDefinition);
  const addStep = useEditorStore((s) => s.addStep);
  const updateStep = useEditorStore((s) => s.updateStep);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const resetExecution = useEditorStore((s) => s.resetExecution);

  const [newStepId, setNewStepId] = useState("");
  const [newStepType, setNewStepType] = useState<string>("sweny/verify-access");
  const [showTypePicker, setShowTypePicker] = useState(false);
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

  function handleExportYaml() {
    const { definition: def } = useEditorStore.getState();
    const content = exportWorkflowYaml(def);
    const blob = new Blob([content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${def.id}.workflow.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJson() {
    const { definition: def } = useEditorStore.getState();
    const json = JSON.stringify(def, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${def.id}.workflow.json`;
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
      () => {},
    );
  }

  function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    const id = newStepId.trim();
    if (!id) return;

    const entry = findStepType(newStepType);
    const phase: WorkflowPhase = entry?.phase ?? "act";

    addStep(id, phase);
    // Apply type and uses from catalog
    if (entry && entry.type !== "custom") {
      updateStep(id, { type: entry.type, uses: entry.uses });
    }

    setNewStepId("");
    setShowTypePicker(false);
  }

  function handleTypeSelect(type: string) {
    setNewStepType(type);
    // Auto-fill step ID from the label (use last segment of type as default ID)
    const label = BUILTIN_STEP_TYPES.find((e) => e.type === type)?.label ?? "";
    const suggestedId = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!newStepId.trim()) {
      setNewStepId(suggestedId);
    }
  }

  const phases: WorkflowPhase[] = ["learn", "act", "report"];
  const typesByPhase = phases.map((phase) => ({
    phase,
    types: BUILTIN_STEP_TYPES.filter((e) => e.phase === phase),
  }));

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

      {/* Fork button (shown when viewing a built-in preset) */}
      {isBuiltinWorkflow && onFork && (
        <button
          onClick={onFork}
          title="Fork this workflow to customize it"
          className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs text-white"
        >
          Fork
        </button>
      )}

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

      {/* Add step — type picker */}
      <div className="relative">
        <form onSubmit={handleAddStep} className="flex gap-1">
          <input
            value={newStepId}
            onChange={(e) => setNewStepId(e.target.value)}
            placeholder="step-id"
            className="px-2 py-1 rounded bg-gray-700 text-white text-xs w-28 placeholder-gray-400"
          />
          <button
            type="button"
            onClick={() => setShowTypePicker((v) => !v)}
            className="px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs max-w-[120px] truncate"
            title="Select step type"
          >
            {findStepType(newStepType)?.label ?? "Custom Step"}
          </button>
          <button type="submit" className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">
            + Step
          </button>
        </form>

        {/* Step type dropdown */}
        {showTypePicker && (
          <div className="absolute right-0 top-8 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 w-72 max-h-80 overflow-y-auto">
            {typesByPhase.map(({ phase, types }) => (
              <div key={phase}>
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-800">
                  {phase}
                </div>
                {types.map((entry) => (
                  <button
                    key={entry.type}
                    type="button"
                    onClick={() => {
                      handleTypeSelect(entry.type);
                      setShowTypePicker(false);
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-700 ${newStepType === entry.type ? "bg-gray-700" : ""}`}
                  >
                    <div className="text-xs text-white font-medium">{entry.label}</div>
                    <div className="text-[10px] text-gray-400">{entry.description}</div>
                    {entry.uses && entry.uses.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {entry.uses.map((u) => (
                          <span key={u} className="text-[9px] px-1 rounded bg-gray-600 text-gray-300">
                            {u}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import */}
      <button
        onClick={() => onShowImportChange(true)}
        className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
      >
        ↑ Import
      </button>

      {/* Export YAML (primary) */}
      <button onClick={handleExportYaml} className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-xs ml-2">
        ↓ Export YAML
      </button>

      {/* Export JSON (secondary) */}
      <button onClick={handleExportJson} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs">
        ↓ JSON
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
