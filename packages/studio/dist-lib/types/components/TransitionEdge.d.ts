import { type Edge, type EdgeProps } from "@xyflow/react";
export type TransitionEdgeData = {
  label: string;
  isError?: boolean;
};
export type TransitionEdgeType = Edge<TransitionEdgeData, "transitionEdge">;
export declare function TransitionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<TransitionEdgeType>): import("react/jsx-runtime").JSX.Element;
