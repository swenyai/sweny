import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export type TransitionEdgeData = {
  label: string;
  isError?: boolean;
};

// In @xyflow/react v12, custom edge types use: type MyEdge = Edge<Data, "typeName">
export type TransitionEdgeType = Edge<TransitionEdgeData, "transitionEdge">;

// Semantic edge coloring
function getEdgeColor(label: string): string {
  if (label === "failed") return "#ef4444";
  if (label === "→") return "#3a4f66";
  if (label === "skip" || label === "skipped") return "#4b5563";
  if (label === "implement") return "#8b5cf6";
  if (label === "local") return "#06b6d4";
  if (label === "dispatched") return "#22d3ee";
  if (label === "duplicate") return "#f59e0b";
  return "#6366f1"; // generic outcome → indigo
}

function getLabelStyle(
  label: string,
  isError: boolean,
): {
  color: string;
  background: string;
  border: string;
} {
  if (isError || label === "failed") {
    return {
      color: "#fca5a5",
      background: "rgba(239,68,68,0.15)",
      border: "1px solid rgba(239,68,68,0.4)",
    };
  }
  if (label === "→") {
    return {
      color: "#475569",
      background: "rgba(30,41,59,0.8)",
      border: "1px solid rgba(71,85,105,0.35)",
    };
  }
  const hex = getEdgeColor(label);
  // Parse hex to rgba
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    color: hex,
    background: `rgba(${r},${g},${b},0.12)`,
    border: `1px solid rgba(${r},${g},${b},0.38)`,
  };
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
  const strokeWidth = label === "→" ? 1.5 : 2;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          opacity: label === "→" ? 0.55 : 0.8,
          ...(label === "failed" || isError ? { strokeDasharray: "7 3" } : {}),
        }}
      />
      {label && label !== "→" && (
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
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 5,
                letterSpacing: "0.02em",
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
