import { useState, useEffect, useCallback } from "react";
import { WorkflowViewer } from "@sweny-ai/studio/viewer";
import { triageWorkflow } from "@sweny-ai/core/workflows";
import "@sweny-ai/studio/style.css";

type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";

/**
 * Animated demo of Studio Live Mode.
 *
 * Cycles through the triage workflow nodes to show what live execution
 * looks like — blue pulse on current node, green on completed, gray on pending.
 */

// The execution path through the triage DAG (happy path: novel issue → implement → PR)
const EXEC_PATH: { node: string; durationMs: number }[] = [
  { node: "prepare", durationMs: 1800 },
  { node: "gather", durationMs: 3200 },
  { node: "investigate", durationMs: 3800 },
  { node: "create_issue", durationMs: 2400 },
  { node: "implement", durationMs: 3000 },
  { node: "create_pr", durationMs: 1800 },
  { node: "notify", durationMs: 1600 },
];

export function LiveModeDemo() {
  const [execState, setExecState] = useState<Record<string, NodeExecStatus>>({});
  const [stepIdx, setStepIdx] = useState(-1);
  const [running, setRunning] = useState(false);

  const reset = useCallback(() => {
    setExecState({});
    setStepIdx(-1);
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    setExecState({});
    setStepIdx(0);
    setRunning(true);
  }, []);

  // Advance through nodes on a timer
  useEffect(() => {
    if (!running || stepIdx < 0) return;

    // All done — pause then restart
    if (stepIdx >= EXEC_PATH.length) {
      const t = setTimeout(() => start(), 2500);
      return () => clearTimeout(t);
    }

    const { node, durationMs } = EXEC_PATH[stepIdx];

    // Mark current node
    setExecState((prev) => ({ ...prev, [node]: "current" }));

    // After duration, mark success and advance
    const t = setTimeout(() => {
      setExecState((prev) => ({ ...prev, [node]: "success" }));
      setStepIdx((i) => i + 1);
    }, durationMs);

    return () => clearTimeout(t);
  }, [running, stepIdx, start]);

  // Auto-start on mount
  useEffect(() => {
    const t = setTimeout(() => start(), 800);
    return () => clearTimeout(t);
  }, [start]);

  const currentNode = stepIdx >= 0 && stepIdx < EXEC_PATH.length ? EXEC_PATH[stepIdx].node : null;
  const nodeName = currentNode
    ? (triageWorkflow.nodes[currentNode]?.name ?? currentNode)
    : stepIdx >= EXEC_PATH.length
      ? "Complete"
      : "";

  return (
    <div style={{ position: "relative" }}>
      {/* Hide minimap and controls — too noisy for a docs demo */}
      <style>{`
        .live-mode-demo .react-flow__minimap,
        .live-mode-demo .react-flow__controls { display: none !important; }
      `}</style>
      <div
        className="live-mode-demo"
        style={{
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid var(--sl-color-gray-5, #333)",
        }}
      >
        <WorkflowViewer workflow={triageWorkflow} executionState={execState} height="min(75vh, 680px)" />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          fontSize: "13px",
          color: "var(--sl-color-gray-3, #999)",
        }}
      >
        <span>
          {running && currentNode && (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#3b82f6",
                  marginRight: 6,
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
              {nodeName}
            </>
          )}
          {running && stepIdx >= EXEC_PATH.length && <>Workflow complete</>}
          {!running && <>Click play to simulate</>}
        </span>
        <button
          onClick={running ? reset : start}
          style={{
            background: "none",
            border: "1px solid var(--sl-color-gray-5, #555)",
            borderRadius: "4px",
            color: "var(--sl-color-white, #eee)",
            padding: "4px 12px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {running ? "Reset" : "Play"}
        </button>
      </div>
    </div>
  );
}
