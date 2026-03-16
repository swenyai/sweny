import { useState } from "react";
import type { WorkflowPhase, StepDefinition, StepResult } from "@sweny-ai/engine";
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
    mode,
    completedSteps,
    currentStepId,
  } = useEditorStore();

  const readOnly = mode !== "design";

  const stepIds = Object.keys(definition.steps);

  if (selection?.kind === "step") {
    const { id } = selection;
    const step = definition.steps[id];
    if (!step) return <EmptyPanel />;
    const execResult = completedSteps[id] as StepResult | undefined;
    const isRunning = id === currentStepId;
    return (
      <StepPanel
        key={id}
        id={id}
        step={step}
        stepIds={stepIds}
        isInitial={definition.initial === id}
        readOnly={readOnly}
        execResult={execResult}
        isRunning={isRunning}
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
        readOnly={readOnly}
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
  return <WorkflowMetaPanel definition={definition} updateWorkflowMeta={updateWorkflowMeta} readOnly={readOnly} />;
}

// ─────────────────────────────────────────────
// Workflow meta panel
// ─────────────────────────────────────────────

interface WorkflowMetaPanelProps {
  definition: ReturnType<typeof useEditorStore.getState>["definition"];
  updateWorkflowMeta: ReturnType<typeof useEditorStore.getState>["updateWorkflowMeta"];
  readOnly: boolean;
}

function WorkflowMetaPanel({ definition, updateWorkflowMeta, readOnly }: WorkflowMetaPanelProps) {
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
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => updateWorkflowMeta({ name })}
          disabled={readOnly}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <textarea
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm resize-none ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => updateWorkflowMeta({ description })}
          disabled={readOnly}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Version</label>
        <input
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          onBlur={() => updateWorkflowMeta({ version })}
          disabled={readOnly}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Initial step</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{definition.initial}</code>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        {readOnly ? "Read-only during execution." : "Click a node or edge to edit it."}
      </p>
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
  readOnly: boolean;
  execResult?: StepResult;
  isRunning: boolean;
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
  readOnly,
  execResult,
  isRunning,
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

      {/* Execution result card — shown in simulate/live mode */}
      {readOnly && <ExecutionResultCard result={execResult} isRunning={isRunning} />}

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">ID</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{id}</code>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Phase</label>
        <select
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={step.phase}
          disabled={readOnly}
          onChange={(e) => updateStep(id, { phase: e.target.value as WorkflowPhase })}
        >
          <option value="learn">learn</option>
          <option value="act">act</option>
          <option value="report">report</option>
        </select>
      </div>

      <div className="mb-3">
        <label className={`flex items-center gap-2 text-xs font-medium text-gray-600 ${readOnly ? "opacity-60" : ""}`}>
          <input
            type="checkbox"
            checked={step.critical ?? false}
            disabled={readOnly}
            onChange={(e) => updateStep(id, { critical: e.target.checked })}
          />
          Critical
        </label>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <input
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={description}
          disabled={readOnly}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => updateStep(id, { description })}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Next (default)</label>
        <select
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={step.next ?? ""}
          disabled={readOnly}
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
            readOnly={readOnly}
            updateTransitionOutcome={updateTransitionOutcome}
            updateTransitionTarget={updateTransitionTarget}
            deleteTransition={deleteTransition}
          />
        ))}

        {/* Add transition row — hidden in read-only mode */}
        {!readOnly && (
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
        )}
      </div>

      {/* Danger zone — hidden in read-only mode */}
      {!readOnly && (
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
      )}
    </div>
  );
}

interface TransitionRowProps {
  sourceId: string;
  outcome: string;
  target: string;
  targetOptions: string[];
  readOnly: boolean;
  updateTransitionOutcome: (sourceId: string, oldOutcome: string, newOutcome: string) => void;
  updateTransitionTarget: (sourceId: string, outcome: string, newTarget: string) => void;
  deleteTransition: (sourceId: string, outcome: string) => void;
}

function TransitionRow({
  sourceId,
  outcome,
  target,
  targetOptions,
  readOnly,
  updateTransitionOutcome,
  updateTransitionTarget,
  deleteTransition,
}: TransitionRowProps) {
  const [editOutcome, setEditOutcome] = useState(outcome);

  return (
    <div className="flex items-center gap-1 mb-1">
      <input
        className={`flex-1 border border-gray-300 rounded px-1 py-0.5 text-xs min-w-0 ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
        value={editOutcome}
        disabled={readOnly}
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
        className={`border border-gray-300 rounded px-1 py-0.5 text-xs ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
        value={target}
        disabled={readOnly}
        onChange={(e) => updateTransitionTarget(sourceId, outcome, e.target.value)}
      >
        {targetOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {!readOnly && (
        <button
          onClick={() => deleteTransition(sourceId, outcome)}
          className="text-red-500 hover:text-red-700 text-xs px-1"
          title="Delete transition"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Execution result card
// ─────────────────────────────────────────────

interface ExecutionResultCardProps {
  result?: StepResult;
  isRunning: boolean;
}

function ExecutionResultCard({ result, isRunning }: ExecutionResultCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (isRunning) {
    return (
      <div className="mb-3 p-2 rounded bg-blue-50 border border-blue-200 text-xs animate-pulse">
        <span className="text-blue-600 font-medium">● running…</span>
      </div>
    );
  }

  if (!result) {
    return <div className="mb-3 p-2 rounded bg-gray-50 border border-gray-200 text-xs text-gray-400">pending</div>;
  }

  const statusColor =
    result.status === "success"
      ? "text-green-700 bg-green-50 border-green-200"
      : result.status === "failed"
        ? "text-red-700 bg-red-50 border-red-200"
        : "text-gray-600 bg-gray-50 border-gray-200";

  const icon = result.status === "success" ? "✓" : result.status === "failed" ? "✗" : "⊘";
  const dataOutcome = result.data?.outcome != null ? String(result.data.outcome) : null;
  const extraKeys = Object.keys(result.data ?? {}).filter((k) => k !== "outcome");
  const hasExtraData = extraKeys.length > 0;
  const extraJson = hasExtraData ? JSON.stringify(result.data, null, 2) : null;

  return (
    <div className={`mb-3 p-2 rounded border text-xs ${statusColor}`}>
      <div className="flex items-center gap-1.5 font-medium">
        <span>{icon}</span>
        <span>{result.status}</span>
        {result.cached && <span className="px-1 rounded bg-yellow-100 text-yellow-700 text-[10px]">cached</span>}
        {dataOutcome && (
          <span className="px-1 rounded bg-white/60 text-[10px] border border-current/20">{dataOutcome}</span>
        )}
      </div>
      {result.reason && <p className="mt-1 text-[11px] opacity-80">{result.reason}</p>}
      {hasExtraData && (
        <div className="mt-1">
          <button onClick={() => setExpanded((v) => !v)} className="text-[10px] underline opacity-70 hover:opacity-100">
            {expanded ? "▾ Hide data" : "▸ Show data"}
          </button>
          {expanded && (
            <pre className="mt-1 text-[10px] bg-white/60 rounded p-1 overflow-auto max-h-32 whitespace-pre-wrap">
              {extraJson!.length > 800 ? extraJson!.slice(0, 800) + "…" : extraJson}
            </pre>
          )}
        </div>
      )}
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
  readOnly: boolean;
  updateTransitionOutcome: (sourceId: string, oldOutcome: string, newOutcome: string) => void;
  updateTransitionTarget: (sourceId: string, outcome: string, newTarget: string) => void;
  deleteTransition: (sourceId: string, outcome: string) => void;
}

function EdgePanel({
  source,
  outcome,
  currentTarget,
  stepIds,
  readOnly,
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
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={editOutcome}
          onChange={(e) => setEditOutcome(e.target.value)}
          onBlur={() => {
            const trimmed = editOutcome.trim();
            if (trimmed && trimmed !== outcome) {
              updateTransitionOutcome(source, outcome, trimmed);
            }
          }}
          disabled={readOnly}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Target</label>
        <select
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={currentTarget}
          onChange={(e) => updateTransitionTarget(source, outcome, e.target.value)}
          disabled={readOnly}
        >
          {targetOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {!readOnly && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={() => deleteTransition(source, outcome)}
            className="w-full px-3 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500"
          >
            Delete transition
          </button>
        </div>
      )}
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
