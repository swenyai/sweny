import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export type TransitionEdgeData = {
  label: string;
};

// In @xyflow/react v12, custom edge types use: type MyEdge = Edge<Data, "typeName">
export type TransitionEdgeType = Edge<TransitionEdgeData, "transitionEdge">;

function getLabelColor(label: string): string {
  if (label === "failed") return "text-red-600 bg-red-50 border-red-200";
  if (label === "→") return "text-gray-400 bg-gray-50 border-gray-200";
  return "text-gray-700 bg-white border-gray-300";
}

function getEdgeColor(label: string): string {
  if (label === "failed") return "#dc2626"; // red-600
  if (label === "→") return "#9ca3af"; // gray-400
  return "#6b7280"; // gray-500
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

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const strokeColor = getEdgeColor(label);
  const labelClasses = getLabelColor(label);

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke: strokeColor, strokeWidth: 1.5 }} />
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
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${labelClasses}`}>{label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
