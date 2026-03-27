import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export type TransitionEdgeData = {
  when?: string;
  isConditional: boolean;
  isError?: boolean;
};

export type TransitionEdgeType = Edge<TransitionEdgeData, "conditionEdge">;

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
  const when = data?.when;
  const isConditional = data?.isConditional ?? false;
  const isError = data?.isError ?? false;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Shift conditional labels 40% toward their target to prevent overlap
  // when multiple edges leave the same source node
  const shiftedLabelX = isConditional ? labelX + (targetX - labelX) * 0.4 : labelX;
  const shiftedLabelY = isConditional ? labelY + (targetY - labelY) * 0.4 : labelY;

  const strokeColor = isError ? "#ef4444" : isConditional ? "#6366f1" : "#4d7aaa";
  const displayLabel = isError && when ? `⚠ ${when}` : when;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: 3,
          opacity: isConditional ? 1 : 0.75,
          ...(isError ? { strokeDasharray: "6 3" } : {}),
        }}
      />
      {/* Show label for conditional edges */}
      {displayLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${shiftedLabelX}px,${shiftedLabelY}px)`,
              pointerEvents: "all",
              maxWidth: 220,
            }}
            className="nodrag nopan"
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 5,
                display: "block",
                lineHeight: 1.4,
                color: isError ? "#dc2626" : "#4338ca",
                background: isError ? "#fef2f2" : "#eef0ff",
                border: isError ? "1px solid #fecaca" : "1px solid #c7d2fe",
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
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
