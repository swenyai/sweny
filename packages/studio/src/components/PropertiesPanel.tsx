import { useState } from "react";
import type { WorkflowPhase, StepDefinition } from "@sweny-ai/engine";
import { useEditorStore } from "../store/editor-store.js";

export function PropertiesPanel() {
  const {
    definition,
    selection,
    setSelection,
    updateStep,
    updateWorkflowMeta,
    deleteStep,
    setInitial,
    addTransition,
    updateTransitionOutcome,
    updateTransitionTarget,
    deleteTransition,
  } = useEditorStore();

  const stepIds = Object.keys(definition.steps);

  if (selection?.kind === "step") {
    const { id } = selection;
    const step = definition.steps[id];
    if (!step) return <EmptyPanel />;
    return (
      <StepPanel
        key={id}
        id={id}
        step={step}
        stepIds={stepIds}
        isInitial={definition.initial === id}
        updateStep={updateStep}
        setInitial={setInitial}
        deleteStep={(sid) => {
          if (window.confirm(`Delete step "${sid}"?`)) {
            deleteStep(sid);
          }
        }}
        addTransition={addTransition}
        updateTransitionOutcome={updateTransitionOutcome}
        updateTransitionTarget={updateTransitionTarget}
        deleteTransition={deleteTransition}
      />
    );
  }

  if (selection?.kind === "edge") {
    const { source, outcome } = selection;
    const sourceStep = definition.steps[source];
    let currentTarget = "";
    if (outcome === "→") {
      currentTarget = sourceStep?.next ?? "";
    } else {
      currentTarget = sourceStep?.on?.[outcome] ?? "";
    }
    return (
      <EdgePanel
        key={`${source}--${outcome}`}
        source={source}
        outcome={outcome}
        currentTarget={currentTarget}
        stepIds={stepIds}
        updateTransitionOutcome={updateTransitionOutcome}
        updateTransitionTarget={updateTransitionTarget}
        deleteTransition={(src, out) => {
          deleteTransition(src, out);
          setSelection(null);
        }}
      />
    );
  }

  // Nothing selected — workflow meta
  return <WorkflowMetaPanel definition={definition} updateWorkflowMeta={updateWorkflowMeta} />;
}

// ─────────────────────────────────────────────
// Workflow meta panel
// ─────────────────────────────────────────────

interface WorkflowMetaPanelProps {
  definition: ReturnType<typeof useEditorStore.getState>["definition"];
  updateWorkflowMeta: ReturnType<typeof useEditorStore.getState>["updateWorkflowMeta"];
}

function WorkflowMetaPanel({ definition, updateWorkflowMeta }: WorkflowMetaPanelProps) {
  const [name, setName] = useState(definition.name ?? "");
  const [description, setDescription] = useState(definition.description ?? "");
  const [version, setVersion] = useState(definition.version ?? "");

  return (
    <div className="w-72 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <h2 className="font-semibold text-gray-800 mb-3 text-sm">Workflow</h2>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">ID</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{definition.id}</code>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => updateWorkflowMeta({ name })}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <textarea
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm resize-none"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => updateWorkflowMeta({ description })}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Version</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          onBlur={() => updateWorkflowMeta({ version })}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Initial step</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{definition.initial}</code>
      </div>

      <p className="text-xs text-gray-400 mt-4">Click a node or edge to edit it.</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Step panel
// ─────────────────────────────────────────────

interface StepPanelProps {
  id: string;
  step: StepDefinition;
  stepIds: string[];
  isInitial: boolean;
  updateStep: (id: string, patch: Partial<StepDefinition>) => void;
  setInitial: (id: string) => void;
  deleteStep: (id: string) => void;
  addTransition: (sourceId: string, outcome: string, targetId: string) => void;
  updateTransitionOutcome: (sourceId: string, oldOutcome: string, newOutcome: string) => void;
  updateTransitionTarget: (sourceId: string, outcome: string, newTarget: string) => void;
  deleteTransition: (sourceId: string, outcome: string) => void;
}

function StepPanel({
  id,
  step,
  stepIds,
  isInitial,
  updateStep,
  setInitial,
  deleteStep,
  addTransition,
  updateTransitionOutcome,
  updateTransitionTarget,
  deleteTransition,
}: StepPanelProps) {
  const [newOutcome, setNewOutcome] = useState("");
  const [newTarget, setNewTarget] = useState(stepIds[0] ?? "");
  const [description, setDescription] = useState(step.description ?? "");

  const targetOptions = [...stepIds, "end"];
  const onEntries = Object.entries(step.on ?? {});

  function handleAddTransition(e: React.FormEvent) {
    e.preventDefault();
    if (!newOutcome.trim() || !newTarget) return;
    addTransition(id, newOutcome.trim(), newTarget);
    setNewOutcome("");
  }

  return (
    <div className="w-72 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <h2 className="font-semibold text-gray-800 mb-3 text-sm">Step</h2>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">ID</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{id}</code>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Phase</label>
        <select
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={step.phase}
          onChange={(e) => updateStep(id, { phase: e.target.value as WorkflowPhase })}
        >
          <option value="learn">learn</option>
          <option value="act">act</option>
          <option value="report">report</option>
        </select>
      </div>

      <div className="mb-3">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
          <input
            type="checkbox"
            checked={step.critical ?? false}
            onChange={(e) => updateStep(id, { critical: e.target.checked })}
          />
          Critical
        </label>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => updateStep(id, { description })}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Next (default)</label>
        <select
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={step.next ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            updateStep(id, { next: val === "" ? undefined : val });
          }}
        >
          <option value="">(none)</option>
          {targetOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-2">Transitions (on)</label>
        {onEntries.length === 0 && <p className="text-xs text-gray-400">No transitions.</p>}
        {onEntries.map(([outcome, target]) => (
          <TransitionRow
            key={outcome}
            sourceId={id}
            outcome={outcome}
            target={target}
            targetOptions={targetOptions}
            updateTransitionOutcome={updateTransitionOutcome}
            updateTransitionTarget={updateTransitionTarget}
            deleteTransition={deleteTransition}
          />
        ))}

        {/* Add transition row */}
        <form onSubmit={handleAddTransition} className="flex gap-1 mt-2">
          <input
            value={newOutcome}
            onChange={(e) => setNewOutcome(e.target.value)}
            placeholder="outcome"
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs min-w-0"
          />
          <select
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            className="border border-gray-300 rounded px-1 py-1 text-xs"
          >
            {targetOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit" className="px-2 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-500">
            Add
          </button>
        </form>
      </div>

      {/* Danger zone */}
      <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col gap-2">
        <button
          onClick={() => setInitial(id)}
          disabled={isInitial}
          className="px-3 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isInitial ? "Initial step" : "Set as initial"}
        </button>
        <button
          onClick={() => deleteStep(id)}
          className="px-3 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500"
        >
          Delete step
        </button>
      </div>
    </div>
  );
}

interface TransitionRowProps {
  sourceId: string;
  outcome: string;
  target: string;
  targetOptions: string[];
  updateTransitionOutcome: (sourceId: string, oldOutcome: string, newOutcome: string) => void;
  updateTransitionTarget: (sourceId: string, outcome: string, newTarget: string) => void;
  deleteTransition: (sourceId: string, outcome: string) => void;
}

function TransitionRow({
  sourceId,
  outcome,
  target,
  targetOptions,
  updateTransitionOutcome,
  updateTransitionTarget,
  deleteTransition,
}: TransitionRowProps) {
  const [editOutcome, setEditOutcome] = useState(outcome);

  return (
    <div className="flex items-center gap-1 mb-1">
      <input
        className="flex-1 border border-gray-300 rounded px-1 py-0.5 text-xs min-w-0"
        value={editOutcome}
        onChange={(e) => setEditOutcome(e.target.value)}
        onBlur={() => {
          const trimmed = editOutcome.trim();
          if (trimmed && trimmed !== outcome) {
            updateTransitionOutcome(sourceId, outcome, trimmed);
          }
        }}
      />
      <span className="text-gray-400 text-xs">→</span>
      <select
        className="border border-gray-300 rounded px-1 py-0.5 text-xs"
        value={target}
        onChange={(e) => updateTransitionTarget(sourceId, outcome, e.target.value)}
      >
        {targetOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        onClick={() => deleteTransition(sourceId, outcome)}
        className="text-red-500 hover:text-red-700 text-xs px-1"
        title="Delete transition"
      >
        ×
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Edge panel
// ─────────────────────────────────────────────

interface EdgePanelProps {
  source: string;
  outcome: string;
  currentTarget: string;
  stepIds: string[];
  updateTransitionOutcome: (sourceId: string, oldOutcome: string, newOutcome: string) => void;
  updateTransitionTarget: (sourceId: string, outcome: string, newTarget: string) => void;
  deleteTransition: (sourceId: string, outcome: string) => void;
}

function EdgePanel({
  source,
  outcome,
  currentTarget,
  stepIds,
  updateTransitionOutcome,
  updateTransitionTarget,
  deleteTransition,
}: EdgePanelProps) {
  const [editOutcome, setEditOutcome] = useState(outcome);
  const targetOptions = [...stepIds, "end"];

  return (
    <div className="w-72 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <h2 className="font-semibold text-gray-800 mb-3 text-sm">Transition</h2>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{source}</code>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={editOutcome}
          onChange={(e) => setEditOutcome(e.target.value)}
          onBlur={() => {
            const trimmed = editOutcome.trim();
            if (trimmed && trimmed !== outcome) {
              updateTransitionOutcome(source, outcome, trimmed);
            }
          }}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Target</label>
        <select
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={currentTarget}
          onChange={(e) => updateTransitionTarget(source, outcome, e.target.value)}
        >
          {targetOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <button
          onClick={() => deleteTransition(source, outcome)}
          className="w-full px-3 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500"
        >
          Delete transition
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Empty panel
// ─────────────────────────────────────────────

function EmptyPanel() {
  return (
    <div className="w-72 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <p className="text-xs text-gray-400">Step not found.</p>
    </div>
  );
}
