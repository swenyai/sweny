import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StepDefinition, WorkflowPhase } from "@sweny-ai/engine";
import { findStepType } from "../lib/step-types.js";

export type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";

export type StateNodeData = {
  stateId: string;
  state: StepDefinition;
  isInitial: boolean;
  isTerminal: boolean;
  execStatus: NodeExecStatus;
};

export type StateNodeType = Node<StateNodeData, "stateNode">;

const phaseAccent: Record<WorkflowPhase, { bar: string; badgeBg: string; badgeText: string }> = {
  learn: { bar: "#3b82f6", badgeBg: "rgba(59,130,246,0.16)", badgeText: "#93c5fd" },
  act: { bar: "#f59e0b", badgeBg: "rgba(245,158,11,0.16)", badgeText: "#fcd34d" },
  report: { bar: "#10b981", badgeBg: "rgba(16,185,129,0.16)", badgeText: "#6ee7b7" },
};

const execStyle: Record<NodeExecStatus, { shadow: string; bg: string; borderColor: string }> = {
  current: {
    shadow: "0 0 0 2px #3b82f6, 0 0 16px rgba(59,130,246,0.45)",
    bg: "rgba(59,130,246,0.1)",
    borderColor: "#3b82f6",
  },
  success: { shadow: "0 0 0 1.5px #22c55e", bg: "rgba(34,197,94,0.07)", borderColor: "#22c55e" },
  failed: { shadow: "0 0 0 1.5px #ef4444", bg: "rgba(239,68,68,0.09)", borderColor: "#ef4444" },
  skipped: { shadow: "none", bg: "rgba(107,114,128,0.04)", borderColor: "rgba(100,116,139,0.3)" },
  pending: { shadow: "0 2px 12px rgba(0,0,0,0.5)", bg: "rgba(8,14,26,0.92)", borderColor: "" },
};

const providerMeta: Record<string, { icon: string; color: string }> = {
  observability: { icon: "◉", color: "#818cf8" },
  issueTracking: { icon: "◈", color: "#f472b6" },
  sourceControl: { icon: "⎇", color: "#34d399" },
  codingAgent: { icon: "⬡", color: "#fb923c" },
  notification: { icon: "◎", color: "#a78bfa" },
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const { stateId, state, isInitial, isTerminal, execStatus } = data;
  const accent = phaseAccent[state.phase];
  const exec = execStyle[execStatus];
  // Show provider icon for the first declared dependency (e.g. "observability", "issueTracker")
  const primaryUse = state.uses?.[0] ?? null;
  const pMeta = primaryUse ? (providerMeta[primaryUse] ?? null) : null;
  const typeEntry = state.type ? findStepType(state.type) : undefined;
  const typeLabel = typeEntry ? typeEntry.label : state.type ? state.type.replace(/^sweny\//, "") : null;

  const borderColor = exec.borderColor || (isInitial ? accent.bar + "cc" : accent.bar + "40");
  const borderStyle = isTerminal ? "dashed" : "solid";
  const textOpacity = execStatus === "skipped" ? 0.45 : 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        borderRadius: 7,
        overflow: "hidden",
        width: 200,
        height: typeLabel ? 52 : 40,
        background: exec.bg,
        boxShadow: exec.shadow,
        border: `1px ${borderStyle} ${borderColor}`,
        fontFamily: "inherit",
        position: "relative",
        cursor: "pointer",
      }}
    >
      {/* Phase accent bar */}
      <div
        style={{ width: 4, flexShrink: 0, background: accent.bar, opacity: execStatus === "skipped" ? 0.3 : 0.95 }}
      />

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 9px 0 8px",
          minWidth: 0,
        }}
      >
        {/* Top row: ID + icons + phase badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              fontSize: 11,
              fontWeight: 700,
              color: "#dde5f0",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              opacity: textOpacity,
            }}
          >
            {stateId}
          </span>

          {/* Provider icon */}
          {pMeta && (
            <span style={{ fontSize: 10, color: pMeta.color, flexShrink: 0, opacity: textOpacity, lineHeight: 1 }}>
              {pMeta.icon}
            </span>
          )}

          {/* Phase badge */}
          <span
            style={{
              fontSize: 7.5,
              fontWeight: 800,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              padding: "2px 5px",
              borderRadius: 3,
              background: accent.badgeBg,
              color: accent.badgeText,
              flexShrink: 0,
              opacity: textOpacity,
            }}
          >
            {state.phase}
          </span>
        </div>

        {/* Step type subtitle */}
        {typeLabel && (
          <div
            style={{
              fontSize: 9,
              color: "#64748b",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2,
              opacity: textOpacity,
            }}
          >
            {typeLabel}
          </div>
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ top: -4, background: "#1e293b", border: "2px solid #334155", width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ bottom: -4, background: "#1e293b", border: "2px solid #334155", width: 8, height: 8 }}
      />
    </div>
  );
}
