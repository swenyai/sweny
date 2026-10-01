import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { EdgeWhen } from "@sweny-ai/core";
import { whenLabel } from "@sweny-ai/core/schema";
import {
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  LABEL_PAD_X,
  LABEL_PAD_Y,
  measureLabel,
  pointsToPath,
  type Box,
  type Point,
} from "../layout/geometry.js";
import { tok } from "../theme.js";

export type TransitionEdgeData = {
  when?: EdgeWhen;
  max_iterations?: number;
  edgeIndex: number;
  isConditional: boolean;
  isError?: boolean;
  /** ELK route (start, bends, end) in flow coordinates. */
  route?: Point[];
  /** ELK label box in flow coordinates (top-left origin). */
  labelBox?: Box;
  /** Handle positions at layout time; a mismatch means a node was dragged and the route is stale. */
  layoutAnchors?: { source: Point; target: Point };
};

export type TransitionEdgeType = Edge<TransitionEdgeData, "conditionEdge">;

/** Allowed drift between layout-time and current handle positions (node height varies with content). */
const ANCHOR_TOLERANCE = 24;

function near(a: Point, x: number, y: number): boolean {
  return Math.abs(a.x - x) <= ANCHOR_TOLERANCE && Math.abs(a.y - y) <= ANCHOR_TOLERANCE;
}

export interface EdgeGeometry {
  path: string;
  /** Label box in flow coordinates, or null when the edge has no label. */
  label: Box | null;
}

/** Use the ELK route and label box when they still match the handles, else a smooth-step fallback. */
export function resolveEdgeGeometry(args: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Parameters<typeof getSmoothStepPath>[0]["sourcePosition"];
  targetPosition: Parameters<typeof getSmoothStepPath>[0]["targetPosition"];
  data?: TransitionEdgeData;
  displayLabel?: string;
}): EdgeGeometry {
  const { sourceX, sourceY, targetX, targetY, data, displayLabel } = args;
  const anchors = data?.layoutAnchors;
  const fresh = !!anchors && near(anchors.source, sourceX, sourceY) && near(anchors.target, targetX, targetY);

  if (fresh && data?.route && data.route.length >= 2) {
    const label = displayLabel ? (data.labelBox ?? null) : null;
    return { path: pointsToPath(data.route), label };
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: args.sourcePosition,
    targetPosition: args.targetPosition,
    borderRadius: 8,
  });
  if (!displayLabel) return { path, label: null };
  const { width, height } = measureLabel(displayLabel);
  return { path, label: { x: labelX - width / 2, y: labelY - height / 2, width, height } };
}

/** The pill drawn on an edge. Pure markup: sized by the same box ELK reserved. */
export function EdgeLabel({ text, box, isError }: { text: string; box: Box; isError: boolean }) {
  return (
    <div
      data-testid="edge-label"
      style={{
        position: "absolute",
        transform: `translate(${box.x}px,${box.y}px)`,
        width: box.width,
        height: box.height,
        pointerEvents: "all",
      }}
      className="nodrag nopan"
    >
      <span
        style={{
          boxSizing: "border-box",
          width: "100%",
          height: "100%",
          fontSize: LABEL_FONT_SIZE,
          fontWeight: 600,
          padding: `${LABEL_PAD_Y}px ${LABEL_PAD_X}px`,
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          lineHeight: `${LABEL_LINE_HEIGHT}px`,
          color: isError ? "#dc2626" : tok("labelText"),
          background: isError ? "#fef2f2" : tok("labelBg"),
          border: isError ? "1px solid #fecaca" : `1px solid ${tok("labelBorder")}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}
      >
        {text}
      </span>
    </div>
  );
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
  const when = whenLabel(data?.when);
  const isConditional = data?.isConditional ?? false;
  const isError = data?.isError ?? false;

  const displayLabel = isError && when ? `⚠ ${when}` : when;
  const { path, label } = resolveEdgeGeometry({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    displayLabel,
  });

  const strokeColor = isError ? "#ef4444" : isConditional ? tok("primary") : "#4d7aaa";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: 3,
          opacity: isConditional ? 1 : 0.75,
          ...(isError ? { strokeDasharray: "6 3" } : {}),
        }}
      />
      {displayLabel && label && (
        <EdgeLabelRenderer>
          <EdgeLabel text={displayLabel} box={label} isError={isError} />
        </EdgeLabelRenderer>
      )}
    </>
  );
}
