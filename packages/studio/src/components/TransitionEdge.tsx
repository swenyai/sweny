import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { CSSProperties } from "react";

export type TransitionEdgeData = {
  label: string;
  isError?: boolean; // true when the target state doesn't exist
};

// In @xyflow/react v12, custom edge types use: type MyEdge = Edge<Data, "typeName">
export type TransitionEdgeType = Edge<TransitionEdgeData, "transitionEdge">;

function getLabelStyle(label: string, isError: boolean): CSSProperties {
  if (isError || label === "failed") {
    return { color: "#fca5a5", background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.45)" };
  }
  if (label === "→") {
    return { color: "#64748b", background: "rgba(100,116,139,0.12)", border: "1px solid rgba(100,116,139,0.3)" };
  }
  return { color: "#94a3b8", background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.3)" };
}

function getEdgeColor(label: string): string {
  if (label === "failed") return "#ef4444";
  if (label === "→") return "#475569"; // slate-600
  return "#64748b"; // slate-500
}

export function TransitionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<TransitionEdgeType>) {
  const label = data?.label ?? "";
  const isError = data?.isError ?? false;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const strokeColor = isError ? "#ef4444" : getEdgeColor(label);
  const labelStyle = getLabelStyle(label, isError);
  const displayLabel = isError ? `⚠ ${label}` : label;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: 1.5,
          ...(isError ? { strokeDasharray: "6 3" } : {}),
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "1px 6px",
                borderRadius: 4,
                ...labelStyle,
              }}
            >
              {displayLabel}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
