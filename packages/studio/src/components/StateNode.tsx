import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StateDefinition, WorkflowPhase } from "@sweny-ai/engine";
import type { CSSProperties } from "react";

export type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";

export type StateNodeData = {
  stateId: string;
  state: StateDefinition;
  isInitial: boolean;
  isTerminal: boolean;
  execStatus: NodeExecStatus;
};

// In @xyflow/react v12, custom node types use: type MyNode = Node<Data, "typeName">
export type StateNodeType = Node<StateNodeData, "stateNode">;

const phaseStyle: Record<WorkflowPhase, { border: string; badgeBg: string; badgeText: string }> = {
  learn: { border: "#3b82f6", badgeBg: "rgba(59,130,246,0.18)", badgeText: "#93c5fd" },
  act: { border: "#f59e0b", badgeBg: "rgba(245,158,11,0.18)", badgeText: "#fcd34d" },
  report: { border: "#10b981", badgeBg: "rgba(16,185,129,0.18)", badgeText: "#6ee7b7" },
};

const execStyle: Record<NodeExecStatus, { ring: string; bg: string }> = {
  current: { ring: "0 0 0 2.5px #3b82f6, 0 0 14px rgba(59,130,246,0.55)", bg: "rgba(59,130,246,0.10)" },
  success: { ring: "0 0 0 2px #22c55e", bg: "rgba(34,197,94,0.07)" },
  failed: { ring: "0 0 0 2px #ef4444", bg: "rgba(239,68,68,0.09)" },
  skipped: { ring: "0 0 0 2px #6b7280", bg: "rgba(107,114,128,0.06)" },
  pending: { ring: "none", bg: "#1e293b" },
};

const badgeBase: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  padding: "1px 5px",
  lineHeight: 1.6,
  display: "inline-block",
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const { stateId, state, isInitial, isTerminal, execStatus } = data;

  const phase = phaseStyle[state.phase];
  const exec = execStyle[execStatus];
  const borderStyle = isInitial ? "3px double" : isTerminal ? "2px dashed" : "2px solid";

  const containerStyle: CSSProperties = {
    borderRadius: 8,
    padding: "10px 12px",
    minWidth: 180,
    maxWidth: 220,
    border: `${borderStyle} ${phase.border}`,
    background: exec.bg,
    boxShadow: `0 4px 14px rgba(0,0,0,0.45), ${exec.ring}`,
    fontFamily: "inherit",
  };

  return (
    <div style={containerStyle}>
      {/* Target handle (left) */}
      <Handle type="target" position={Position.Left} />

      {/* Header row: state id + critical badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
        <span
          style={{
            fontWeight: 700,
            color: "#e2e8f0",
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {stateId}
        </span>
        {state.critical && (
          <span style={{ ...badgeBase, background: "rgba(239,68,68,0.18)", color: "#fca5a5" }}>critical</span>
        )}
      </div>

      {/* Phase badge */}
      <div style={{ marginBottom: state.description ? 5 : 0 }}>
        <span style={{ ...badgeBase, background: phase.badgeBg, color: phase.badgeText }}>{state.phase}</span>
      </div>

      {/* Description */}
      {state.description && (
        <p
          style={{
            fontSize: 11,
            color: "#94a3b8",
            margin: "4px 0 0",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {state.description}
        </p>
      )}

      {/* Source handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 10, height: 10, background: "#3b82f6", border: "2px solid #1e293b", opacity: 0.7 }}
      />
    </div>
  );
}
