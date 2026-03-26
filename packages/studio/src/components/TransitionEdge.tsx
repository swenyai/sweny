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
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              maxWidth: 160,
            }}
            className="nodrag nopan"
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "block",
                color: isError ? "#fca5a5" : "#a5b4fc",
                background: isError ? "rgba(239,68,68,0.15)" : "rgba(99,102,241,0.13)",
                border: isError ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(99,102,241,0.42)",
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
