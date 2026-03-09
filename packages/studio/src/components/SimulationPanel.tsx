import { useRef, useState } from "react";
import { useEditorStore } from "../store/editor-store.js";
import { createRecipe, runRecipe, createProviderRegistry } from "@sweny-ai/engine";
import type { StepResult, RunObserver } from "@sweny-ai/engine";

// A deferred promise that the UI resolves
class StepLatch {
  private resolve!: (result: StepResult) => void;
  readonly promise: Promise<StepResult> = new Promise((r) => {
    this.resolve = r;
  });
  complete(result: StepResult) {
    this.resolve(result);
  }
}

function createMockImplementations(
  stateIds: string[],
  latchRef: React.MutableRefObject<StepLatch | null>,
): Record<string, () => Promise<StepResult>> {
  return Object.fromEntries(
    stateIds.map((id) => [
      id,
      async (): Promise<StepResult> => {
        const latch = new StepLatch();
        latchRef.current = latch;
        return latch.promise;
      },
    ]),
  );
}

export function SimulationPanel() {
  const { currentStateId, completedStates, executionStatus, definition, resetExecution } = useEditorStore();
  const [outcome, setOutcome] = useState<StepResult["status"]>("success");
  const [customOutcome, setCustomOutcome] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const activeLatchRef = useRef<StepLatch | null>(null);

  const currentState = currentStateId ? definition.states[currentStateId] : null;
  const completedList = Object.entries(completedStates);

  function handleStart() {
    setSimError(null);
    setIsRunning(true);
    activeLatchRef.current = null;

    const { definition: def, applyEvent } = useEditorStore.getState();
    resetExecution();

    let recipe;
    try {
      const mockImpls = createMockImplementations(Object.keys(def.states), activeLatchRef);
      recipe = createRecipe(def, mockImpls);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : String(err));
      setIsRunning(false);
      return;
    }

    const providers = createProviderRegistry();
    const observer: RunObserver = { onEvent: applyEvent };

    runRecipe(recipe, {}, providers, { observer })
      .catch((err: unknown) => {
        setSimError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setIsRunning(false);
        activeLatchRef.current = null;
      });
  }

  function handleStep() {
    activeLatchRef.current?.complete({
      status: outcome,
      data: customOutcome.trim() ? { outcome: customOutcome.trim() } : undefined,
    });
    setCustomOutcome("");
  }

  function handleReset() {
    // Resolve any waiting latch so the async loop can exit cleanly
    activeLatchRef.current?.complete({ status: "failed", reason: "Simulation reset" });
    activeLatchRef.current = null;
    resetExecution();
    setIsRunning(false);
    setSimError(null);
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex-shrink-0">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-semibold text-gray-700">
          {executionStatus === "idle" ? "Simulation" : `Simulating: ${definition.name}`}
        </span>
        {executionStatus !== "idle" && (
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              executionStatus === "running"
                ? "bg-blue-100 text-blue-700"
                : executionStatus === "completed"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
            }`}
          >
            {executionStatus}
          </span>
        )}
        <div className="flex-1" />
        {executionStatus === "idle" ? (
          <button
            onClick={handleStart}
            disabled={isRunning}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40"
          >
            ▶ Start
          </button>
        ) : (
          <button onClick={handleReset} className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-500">
            ↺ Reset
          </button>
        )}
      </div>

      {/* Error display */}
      {simError && <p className="text-xs text-red-600 mb-2">{simError}</p>}

      {/* Current state + step controls */}
      {currentState && currentStateId && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">
            Current: <code className="bg-gray-100 px-1 rounded">{currentStateId}</code>
            <span className="ml-1 text-gray-400">({currentState.phase})</span>
          </span>
          <div className="flex-1" />
          <input
            value={customOutcome}
            onChange={(e) => setCustomOutcome(e.target.value)}
            placeholder="outcome (optional)"
            className="px-2 py-1 text-xs border border-gray-300 rounded w-36"
          />
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as StepResult["status"])}
            className="px-2 py-1 text-xs border border-gray-300 rounded"
          >
            <option value="success">success</option>
            <option value="skipped">skipped</option>
            <option value="failed">failed</option>
          </select>
          <button onClick={handleStep} className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500">
            → Step
          </button>
        </div>
      )}

      {/* Completed list */}
      {completedList.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {completedList.map(([id, result]) => (
            <span
              key={id}
              className={`text-xs px-1.5 py-0.5 rounded ${
                result.status === "success"
                  ? "bg-green-100 text-green-700"
                  : result.status === "failed"
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {id} {result.status === "success" ? "✓" : result.status === "failed" ? "✗" : "−"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
