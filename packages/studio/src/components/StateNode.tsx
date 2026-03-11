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

export type StateNodeType = Node<StateNodeData, "stateNode">;

// Phase accent colors — left bar + badge
const phaseAccent: Record<WorkflowPhase, { bar: string; badgeBg: string; badgeText: string }> = {
  learn: { bar: "#3b82f6", badgeBg: "rgba(59,130,246,0.18)", badgeText: "#93c5fd" },
  act: { bar: "#f59e0b", badgeBg: "rgba(245,158,11,0.18)", badgeText: "#fcd34d" },
  report: { bar: "#10b981", badgeBg: "rgba(16,185,129,0.18)", badgeText: "#6ee7b7" },
};

// Exec status → box-shadow ring + bg tint
const execStyle: Record<NodeExecStatus, { ring: string; bg: string }> = {
  current: { ring: "0 0 0 2.5px #3b82f6, 0 0 16px rgba(59,130,246,0.5)", bg: "rgba(59,130,246,0.10)" },
  success: { ring: "0 0 0 2px #22c55e", bg: "rgba(34,197,94,0.07)" },
  failed: { ring: "0 0 0 2px #ef4444", bg: "rgba(239,68,68,0.09)" },
  skipped: { ring: "0 0 0 2px #6b7280", bg: "rgba(107,114,128,0.06)" },
  pending: { ring: "none", bg: "#141e30" },
};

// Provider category → display label
const providerLabels: Record<string, string> = {
  observability: "Observability",
  issueTracking: "Issue Tracking",
  sourceControl: "Source Control",
  codingAgent: "Coding Agent",
  notification: "Notification",
  messaging: "Messaging",
  incident: "Incident",
};

const providerColors: Record<string, string> = {
  observability: "#818cf8",
  issueTracking: "#f472b6",
  sourceControl: "#34d399",
  codingAgent: "#fb923c",
  notification: "#a78bfa",
  messaging: "#22d3ee",
  incident: "#f87171",
};

const badgeBase: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  borderRadius: 4,
  padding: "1px 5px",
  lineHeight: 1.6,
  display: "inline-block",
  letterSpacing: "0.01em",
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const { stateId, state, isInitial, isTerminal, execStatus } = data;

  const accent = phaseAccent[state.phase];
  const exec = execStyle[execStatus];
  const borderWidth = isInitial ? "2.5px" : isTerminal ? "1.5px" : "1px";
  const borderStyle = isTerminal ? "dashed" : "solid";

  const containerStyle: CSSProperties = {
    display: "flex",
    borderRadius: 8,
    overflow: "hidden",
    minWidth: 220,
    maxWidth: 260,
    background: exec.bg,
    boxShadow: `0 2px 10px rgba(0,0,0,0.5), ${exec.ring}`,
    border: `${borderWidth} ${borderStyle} ${accent.bar}`,
    fontFamily: "inherit",
    position: "relative",
  };

  const provider = (state as StateDefinition & { provider?: string }).provider;
  const provColor = provider ? (providerColors[provider] ?? "#94a3b8") : undefined;

  return (
    <div style={containerStyle}>
      {/* Left accent bar */}
      <div
        style={{
          width: 4,
          flexShrink: 0,
          background: accent.bar,
          opacity: 0.85,
        }}
      />

      {/* Card body */}
      <div style={{ flex: 1, padding: "9px 10px 8px", minWidth: 0 }}>
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
              color: "#e2e8f0",
              fontSize: 12,
              lineHeight: 1.3,
              wordBreak: "break-all",
              flex: 1,
            }}
          >
            {stateId}
          </span>
          <span
            style={{ ...badgeBase, background: accent.badgeBg, color: accent.badgeText, flexShrink: 0, marginTop: 1 }}
          >
            {state.phase}
          </span>
        </div>

        {/* Description */}
        {state.description && (
          <p
            style={{
              fontSize: 11,
              color: "#94a3b8",
              margin: "0 0 7px",
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {state.description}
          </p>
        )}

        {/* Bottom row: provider + critical badges */}
        {(provider || state.critical || isInitial) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
              marginTop: state.description ? 0 : 4,
            }}
          >
            {provider && (
              <span
                style={{
                  ...badgeBase,
                  background: `${provColor}18`,
                  color: provColor,
                  border: `1px solid ${provColor}35`,
                }}
              >
                {providerLabels[provider] ?? provider}
              </span>
            )}
            {state.critical && (
              <span
                style={{
                  ...badgeBase,
                  background: "rgba(239,68,68,0.15)",
                  color: "#fca5a5",
                  border: "1px solid rgba(239,68,68,0.3)",
                }}
              >
                critical
              </span>
            )}
            {isInitial && (
              <span
                style={{
                  ...badgeBase,
                  background: "rgba(99,102,241,0.15)",
                  color: "#a5b4fc",
                  border: "1px solid rgba(99,102,241,0.3)",
                }}
              >
                start
              </span>
            )}
            {isTerminal && (
              <span
                style={{
                  ...badgeBase,
                  background: "rgba(107,114,128,0.15)",
                  color: "#9ca3af",
                  border: "1px solid rgba(107,114,128,0.3)",
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
        style={{ top: -6, background: "#334155", border: "2px solid #1e293b", width: 10, height: 10 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ bottom: -6, background: "#334155", border: "2px solid #1e293b", width: 10, height: 10 }}
      />
    </div>
  );
}
