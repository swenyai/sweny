import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StateDefinition, WorkflowPhase } from "@sweny-ai/engine";

export type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";

export type StateNodeData = {
  stateId: string;
  state: StateDefinition;
  isInitial: boolean;
  isTerminal: boolean;
  execStatus: NodeExecStatus;
};

export type StateNodeType = Node<StateNodeData, "stateNode">;

// Phase accent — left bar + badge
const phaseAccent: Record<WorkflowPhase, { bar: string; badgeBg: string; badgeText: string }> = {
  learn: { bar: "#3b82f6", badgeBg: "rgba(59,130,246,0.14)", badgeText: "#93c5fd" },
  act: { bar: "#f59e0b", badgeBg: "rgba(245,158,11,0.14)", badgeText: "#fcd34d" },
  report: { bar: "#10b981", badgeBg: "rgba(16,185,129,0.14)", badgeText: "#6ee7b7" },
};

// Exec status → shadow ring + tinted bg
const execStyle: Record<NodeExecStatus, { shadow: string; bg: string; borderColor: string }> = {
  current: {
    shadow: "0 0 0 2.5px #3b82f6, 0 0 20px rgba(59,130,246,0.4)",
    bg: "rgba(59,130,246,0.08)",
    borderColor: "#3b82f6",
  },
  success: {
    shadow: "0 0 0 1.5px #22c55e",
    bg: "rgba(34,197,94,0.06)",
    borderColor: "#22c55e",
  },
  failed: {
    shadow: "0 0 0 1.5px #ef4444",
    bg: "rgba(239,68,68,0.08)",
    borderColor: "#ef4444",
  },
  skipped: {
    shadow: "0 0 0 1.5px rgba(100,116,139,0.45)",
    bg: "rgba(107,114,128,0.04)",
    borderColor: "rgba(100,116,139,0.4)",
  },
  pending: {
    shadow: "0 4px 16px rgba(0,0,0,0.5)",
    bg: "rgba(8,14,26,0.9)",
    borderColor: "",
  },
};

// Provider category → icon + display label + color
const providerMeta: Record<string, { icon: string; label: string; color: string }> = {
  observability: { icon: "◉", label: "Observability", color: "#818cf8" },
  issueTracking: { icon: "◈", label: "Issue Tracking", color: "#f472b6" },
  sourceControl: { icon: "⎇", label: "Source Control", color: "#34d399" },
  codingAgent: { icon: "⬡", label: "Coding Agent", color: "#fb923c" },
  notification: { icon: "◎", label: "Notification", color: "#a78bfa" },
  messaging: { icon: "◎", label: "Messaging", color: "#22d3ee" },
  incident: { icon: "△", label: "Incident", color: "#f87171" },
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const { stateId, state, isInitial, isTerminal, execStatus } = data;

  const accent = phaseAccent[state.phase];
  const exec = execStyle[execStatus];
  const provider = (state as StateDefinition & { provider?: string }).provider;
  const pMeta = provider ? (providerMeta[provider] ?? null) : null;

  const borderColor = exec.borderColor || (isInitial ? accent.bar + "bb" : accent.bar + "44");
  const borderWidth = isInitial ? "2px" : "1px";
  const borderStyle = isTerminal ? "dashed" : "solid";

  return (
    <div
      style={{
        display: "flex",
        borderRadius: 10,
        overflow: "hidden",
        minWidth: 252,
        maxWidth: 278,
        background: exec.bg,
        boxShadow: exec.shadow,
        border: `${borderWidth} ${borderStyle} ${borderColor}`,
        fontFamily: "inherit",
        position: "relative",
      }}
    >
      {/* Left phase accent bar */}
      <div
        style={{
          width: 5,
          flexShrink: 0,
          background: accent.bar,
          opacity: execStatus === "skipped" ? 0.35 : 0.9,
        }}
      />

      {/* Card body */}
      <div style={{ flex: 1, padding: "10px 11px 9px", minWidth: 0 }}>
        {/* Top row: state id + phase badge */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 6,
            marginBottom: 5,
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              fontWeight: 700,
              color: execStatus === "skipped" ? "#64748b" : "#dde5f0",
              fontSize: 12.5,
              lineHeight: 1.3,
              wordBreak: "break-all",
              flex: 1,
            }}
          >
            {stateId}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 4,
              padding: "2px 6px",
              lineHeight: 1.75,
              display: "inline-block",
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              flexShrink: 0,
              marginTop: 1,
              background: accent.badgeBg,
              color: accent.badgeText,
            }}
          >
            {state.phase}
          </span>
        </div>

        {/* Description */}
        {state.description && (
          <p
            style={{
              fontSize: 10.5,
              color: execStatus === "skipped" ? "#475569" : "#7a8fa0",
              margin: "0 0 7px",
              lineHeight: 1.55,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {state.description}
          </p>
        )}

        {/* Bottom badges row */}
        {(pMeta || state.critical || isInitial || isTerminal) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
              marginTop: state.description ? 1 : 4,
            }}
          >
            {pMeta && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  borderRadius: 4,
                  padding: "1.5px 6px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  letterSpacing: "0.01em",
                  background: pMeta.color + "1a",
                  color: pMeta.color,
                  border: `1px solid ${pMeta.color}38`,
                }}
              >
                {pMeta.icon} {pMeta.label}
              </span>
            )}
            {state.critical && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  borderRadius: 4,
                  padding: "1.5px 6px",
                  background: "rgba(239,68,68,0.14)",
                  color: "#fca5a5",
                  border: "1px solid rgba(239,68,68,0.28)",
                }}
              >
                critical
              </span>
            )}
            {isInitial && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  borderRadius: 4,
                  padding: "1.5px 6px",
                  background: "rgba(99,102,241,0.14)",
                  color: "#a5b4fc",
                  border: "1px solid rgba(99,102,241,0.28)",
                }}
              >
                start
              </span>
            )}
            {isTerminal && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  borderRadius: 4,
                  padding: "1.5px 6px",
                  background: "rgba(107,114,128,0.14)",
                  color: "#9ca3af",
                  border: "1px solid rgba(107,114,128,0.28)",
                }}
              >
                end
              </span>
            )}
          </div>
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ top: -5, background: "#1e293b", border: "2px solid #475569", width: 10, height: 10 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ bottom: -5, background: "#1e293b", border: "2px solid #475569", width: 10, height: 10 }}
      />
    </div>
  );
}
