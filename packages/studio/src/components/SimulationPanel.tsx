import { useRef, useState } from "react";
import { useEditorStore } from "../store/editor-store.js";
import { createWorkflow, runWorkflow, createProviderRegistry } from "@sweny-ai/engine";
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
  stepIds: string[],
  latchRef: React.MutableRefObject<StepLatch | null>,
): Record<string, () => Promise<StepResult>> {
  return Object.fromEntries(
    stepIds.map((id) => [
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
  const { currentStepId, completedSteps, executionStatus, definition, resetExecution } = useEditorStore();
  const [outcome, setOutcome] = useState<StepResult["status"]>("success");
  const [customOutcome, setCustomOutcome] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const activeLatchRef = useRef<StepLatch | null>(null);

  const currentStep = currentStepId ? definition.steps[currentStepId] : null;
  const completedList = Object.entries(completedSteps);

  function handleStart() {
    setSimError(null);
    setIsRunning(true);
    activeLatchRef.current = null;

    const { definition: def, applyEvent } = useEditorStore.getState();
    resetExecution();

    let workflow;
    try {
      const mockImpls = createMockImplementations(Object.keys(def.steps), activeLatchRef);
      workflow = createWorkflow(def, mockImpls);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : String(err));
      setIsRunning(false);
      return;
    }

    const providers = createProviderRegistry();
    const observer: RunObserver = { onEvent: applyEvent };

    runWorkflow(workflow, {}, providers, { observer })
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

  const statusColor = {
    idle: "text-gray-400",
    running: "text-blue-400",
    completed: "text-green-400",
    failed: "text-red-400",
    partial: "text-yellow-400",
  }[executionStatus];

  return (
    <div className="border-t border-gray-200 bg-gray-50 p-3 flex gap-4 items-start text-sm flex-shrink-0">
      {/* Controls */}
      <div className="flex flex-col gap-2 min-w-40">
        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={isRunning}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 disabled:opacity-50"
          >
            {isRunning ? "Running…" : "▶ Start"}
          </button>
        </div>

        {currentStepId && (
          <div className="flex flex-col gap-1">
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as StepResult["status"])}
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            >
              <option value="success">success</option>
              <option value="skipped">skipped</option>
              <option value="failed">failed</option>
            </select>
            <input
              value={customOutcome}
              onChange={(e) => setCustomOutcome(e.target.value)}
              placeholder="custom outcome (optional)"
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            />
            <button
              onClick={handleStep}
              className="px-3 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-500"
            >
              → Step
            </button>
          </div>
        )}
      </div>

      {/* Current step */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium mb-1 ${statusColor}`}>Status: {executionStatus}</div>

        {currentStepId && (
          <div className="text-xs text-blue-600 font-medium mb-1 animate-pulse">
            ● Waiting at: <code>{currentStepId}</code>
            {currentStep && <span className="text-gray-400 ml-1">({currentStep.phase})</span>}
          </div>
        )}

        {simError && <div className="text-xs text-red-600 bg-red-50 rounded p-2 mb-1">{simError}</div>}

        {/* Completed steps */}
        {completedList.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {completedList.map(([id, result]) => (
              <span
                key={id}
                className={`px-2 py-0.5 rounded text-xs ${
                  result.status === "success"
                    ? "bg-green-100 text-green-700"
                    : result.status === "failed"
                      ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-600"
                }`}
              >
                {id}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
