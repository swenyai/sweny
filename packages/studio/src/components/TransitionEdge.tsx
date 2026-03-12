import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export type TransitionEdgeData = {
  label: string;
  isError?: boolean;
};

export type TransitionEdgeType = Edge<TransitionEdgeData, "transitionEdge">;

function getEdgeColor(label: string): string {
  if (label === "failed") return "#ef4444";
  if (label === "→") return "#3b5070";
  if (label === "skip" || label === "skipped") return "#4b5563";
  if (label === "implement") return "#8b5cf6";
  if (label === "local") return "#06b6d4";
  if (label === "dispatched") return "#22d3ee";
  if (label === "duplicate") return "#f59e0b";
  return "#6366f1";
}

function getLabelStyle(label: string, isError: boolean): { color: string; background: string; border: string } {
  if (isError || label === "failed") {
    return { color: "#fca5a5", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)" };
  }
  if (label === "→") {
    return { color: "#3b5070", background: "rgba(30,41,59,0.8)", border: "1px solid rgba(59,80,112,0.35)" };
  }
  const hex = getEdgeColor(label);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { color: hex, background: `rgba(${r},${g},${b},0.13)`, border: `1px solid rgba(${r},${g},${b},0.42)` };
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
  const isDefault = label === "→";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: isDefault ? 1.5 : 2,
          opacity: isDefault ? 0.5 : 0.9,
          ...(label === "failed" || isError ? { strokeDasharray: "6 3" } : {}),
        }}
      />
      {/* Show label for all non-default edges */}
      {label && !isDefault && (
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
                fontSize: 9.5,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 5,
                letterSpacing: "0.03em",
                whiteSpace: "nowrap",
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
