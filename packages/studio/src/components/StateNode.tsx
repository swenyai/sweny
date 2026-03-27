import { Handle, Position, type Node as RFNode, type NodeProps } from "@xyflow/react";
import type { Node } from "@sweny-ai/core";
import { SkillIcon } from "./SkillIcon.js";

export type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";

export type StateNodeData = {
  nodeId: string;
  node: Node;
  isEntry: boolean;
  isTerminal: boolean;
  skills: { id: string; name: string }[];
  execStatus: NodeExecStatus;
  isUnreachable?: boolean;
};

export type StateNodeType = RFNode<StateNodeData, "skillNode">;

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

const skillColors: Record<string, string> = {
  github: "#6366f1",
  linear: "#818cf8",
  sentry: "#f472b6",
  datadog: "#a78bfa",
  betterstack: "#22d3ee",
  slack: "#34d399",
  notification: "#fb923c",
  filesystem: "#94a3b8",
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const { nodeId, node, isEntry, isTerminal, skills, execStatus, isUnreachable } = data;
  const exec = execStyle[execStatus];

  const accentColor = skills.length > 0 ? (skillColors[skills[0].id] ?? "#6366f1") : "#64748b";
  const showUnreachable = isUnreachable && !exec.borderColor;
  const borderColor =
    exec.borderColor || (showUnreachable ? "#f97316" : isEntry ? accentColor + "cc" : accentColor + "40");
  const borderStyle = isTerminal || showUnreachable ? "dashed" : "solid";
  const textOpacity = execStatus === "skipped" ? 0.45 : 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        borderRadius: 8,
        overflow: "hidden",
        width: 280,
        minHeight: 84,
        background: exec.bg,
        boxShadow: exec.shadow,
        border: `1px ${borderStyle} ${borderColor}`,
        fontFamily: "inherit",
        position: "relative",
        cursor: "pointer",
      }}
    >
      {/* Accent bar */}
      <div
        style={{ width: 4, flexShrink: 0, background: accentColor, opacity: execStatus === "skipped" ? 0.3 : 0.95 }}
      />

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "8px 10px 8px 10px",
          minWidth: 0,
          gap: 4,
        }}
      >
        {/* Row 1: node name + entry badge */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span
            style={{
              fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.3,
              color: "#dde5f0",
              flex: 1,
              opacity: textOpacity,
            }}
          >
            {node.name || nodeId}
          </span>

          {/* Entry badge */}
          {isEntry && (
            <span
              style={{
                fontSize: 7.5,
                fontWeight: 800,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                padding: "2px 5px",
                borderRadius: 3,
                background: "rgba(59,130,246,0.16)",
                color: "#93c5fd",
                flexShrink: 0,
                marginTop: 1,
                opacity: textOpacity,
              }}
            >
              entry
            </span>
          )}
        </div>

        {/* Row 2: node ID */}
        <span
          style={{
            fontFamily: "ui-monospace, 'Cascadia Code', monospace",
            fontSize: 9,
            color: "#64748b",
            opacity: textOpacity,
          }}
        >
          {nodeId}
        </span>

        {/* Row 3: skill badges */}
        {skills.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 1 }}>
            {skills.map((skill) => (
              <span
                key={skill.id}
                style={{
                  fontSize: 8.5,
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: `${skillColors[skill.id] ?? "#6366f1"}20`,
                  color: skillColors[skill.id] ?? "#6366f1",
                  flexShrink: 0,
                  opacity: textOpacity,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <SkillIcon skillId={skill.id} size={10} />
                {skill.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Unreachable warning badge */}
      {showUnreachable && (
        <span
          style={{
            position: "absolute",
            top: 3,
            right: 5,
            fontSize: 9,
            color: "#f97316",
            lineHeight: 1,
            pointerEvents: "none",
          }}
          title="This node is unreachable from the entry node"
        >
          ⚠
        </span>
      )}

      {/* Handles — visible connection points */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          top: -5,
          background: "#334155",
          border: "2px solid #64748b",
          width: 10,
          height: 10,
          borderRadius: "50%",
          cursor: "crosshair",
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          bottom: -5,
          background: "#334155",
          border: "2px solid #64748b",
          width: 10,
          height: 10,
          borderRadius: "50%",
          cursor: "crosshair",
        }}
      />
    </div>
  );
}
