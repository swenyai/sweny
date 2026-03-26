import { useState } from "react";
import { useEditorStore } from "../store/editor-store.js";
import { execute, createSkillMap } from "@sweny-ai/core";
import { MockClaude } from "@sweny-ai/core/testing";
import type { NodeResult } from "@sweny-ai/core";

export function SimulationPanel() {
  const { currentNodeId, completedNodes, executionStatus, workflow, resetExecution } = useEditorStore();
  const [isRunning, setIsRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const currentNode = currentNodeId ? workflow.nodes[currentNodeId] : null;
  const completedList = Object.entries(completedNodes);

  function handleAutoRun() {
    setSimError(null);
    setIsRunning(true);

    const { workflow: wf, applyEvent } = useEditorStore.getState();
    resetExecution();

    // Build mock responses — every node succeeds
    const responses: Record<string, { status: "success" }> = {};
    for (const id of Object.keys(wf.nodes)) {
      responses[id] = { status: "success" };
    }

    const claude = new MockClaude({ responses, workflow: wf });
    const skills = createSkillMap([]);

    execute(wf, {}, { skills, claude, observer: applyEvent })
      .catch((err: unknown) => {
        setSimError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setIsRunning(false);
      });
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
            onClick={handleAutoRun}
            disabled={isRunning}
            title="Run all nodes automatically (mock — always success)"
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 disabled:opacity-50"
          >
            {isRunning ? "Running..." : "Simulate"}
          </button>
        </div>
        <p className="text-[10px] text-gray-400">Mock execution — all nodes succeed</p>
      </div>

      {/* Current node */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium mb-1 ${statusColor}`}>Status: {executionStatus}</div>

        {currentNodeId && (
          <div className="text-xs text-blue-600 font-medium mb-1 animate-pulse">
            Running: <code>{currentNodeId}</code>
            {currentNode && <span className="text-gray-400 ml-1">({currentNode.name})</span>}
          </div>
        )}

        {simError && <div className="text-xs text-red-600 bg-red-50 rounded p-2 mb-1">{simError}</div>}

        {/* Completed nodes trace */}
        {completedList.length > 0 && (
          <div className="mt-1 max-h-36 overflow-y-auto flex flex-col gap-0.5">
            {completedList.map(([id, result]) => {
              const icon = result.status === "success" ? "ok" : result.status === "failed" ? "fail" : "skip";
              const iconColor =
                result.status === "success"
                  ? "text-green-600"
                  : result.status === "failed"
                    ? "text-red-600"
                    : "text-gray-400";
              return (
                <div key={id} className="flex items-baseline gap-1.5 text-xs leading-tight">
                  <span className={`font-bold flex-shrink-0 ${iconColor}`}>{icon}</span>
                  <span className="font-mono text-gray-700 flex-shrink-0">{id}</span>
                  {result.toolCalls.length > 0 && (
                    <span className="px-1 rounded bg-blue-50 text-blue-600 text-[10px] flex-shrink-0">
                      {result.toolCalls.length} tools
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
