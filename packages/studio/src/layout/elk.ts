import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs";
import type { Edge } from "@xyflow/react";
import type { Workflow } from "@sweny-ai/core";
import { workflowToFlow } from "@sweny-ai/core/studio";
import { whenLabel } from "@sweny-ai/core/schema";
import type { StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";
import { measureLabel, separateBoxes, type Box, type Point } from "./geometry.js";

const elk = new ELK();

const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 84;

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
}

/** Text drawn on an edge, or undefined when the edge has no label. Shared with the renderer. */
export function edgeLabelText(when: Parameters<typeof whenLabel>[0], isError = false): string | undefined {
  const text = whenLabel(when);
  if (!text) return undefined;
  return isError ? `⚠ ${text}` : text;
}

export const ELK_LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "70",
  "elk.spacing.edgeNode": "30",
  "elk.spacing.edgeEdge": "24",
  "elk.spacing.edgeLabel": "14",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.layered.spacing.edgeNodeBetweenLayers": "40",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "24",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.edgeLabels.centerLabelPlacementStrategy": "MEDIAN_LAYER",
};

export async function layoutWorkflow(
  workflow: Workflow,
  options?: LayoutOptions,
): Promise<{
  nodes: StateNodeType[];
  edges: Edge<TransitionEdgeData>[];
}> {
  const nodeWidth = options?.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options?.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const { nodes: flowNodes, edges: flowEdges } = workflowToFlow(workflow);

  const elkGraph = {
    id: "root",
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: flowNodes.map((node): ElkNode => ({
      id: node.id,
      width: nodeWidth,
      height: nodeHeight,
    })),
    edges: flowEdges.map((edge): ElkExtendedEdge => {
      const text = edgeLabelText(edge.data.when);
      return {
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        labels: text
          ? [
              {
                id: `${edge.id}-label`,
                text,
                // reserve room for the error prefix so a later isError flip never overflows the box
                ...measureLabel(`⚠ ${text}`),
                layoutOptions: { "elk.edgeLabels.inline": "true" },
              },
            ]
          : [],
      };
    }),
  };

  const layout = await elk.layout(elkGraph);

  // Map core FlowNode to Studio StateNodeType
  const positionedNodes: StateNodeType[] = flowNodes.map((flowNode) => {
    const elkNode = layout.children?.find((c) => c.id === flowNode.id);
    return {
      id: flowNode.id,
      type: "skillNode" as const,
      position: {
        x: elkNode?.x ?? 0,
        y: elkNode?.y ?? 0,
      },
      style: { width: nodeWidth, minHeight: nodeHeight },
      initialWidth: nodeWidth,
      initialHeight: nodeHeight,
      data: {
        nodeId: flowNode.data.nodeId,
        node: flowNode.data.node,
        isEntry: flowNode.data.isEntry,
        isTerminal: flowNode.data.isTerminal,
        skills: flowNode.data.skills,
        execStatus: "pending" as const,
      },
    };
  });

  const nodePos = new Map(positionedNodes.map((n) => [n.id, n.position]));
  const elkEdges = new Map((layout.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge]));

  const edges: Edge<TransitionEdgeData>[] = flowEdges.map((flowEdge) => {
    const elkEdge = elkEdges.get(flowEdge.id);
    const route: Point[] = [];
    for (const section of elkEdge?.sections ?? []) {
      route.push(section.startPoint, ...(section.bendPoints ?? []), section.endPoint);
    }
    const label = elkEdge?.labels?.[0];
    const labelBox: Box | undefined =
      label && label.x !== undefined && label.y !== undefined
        ? { x: label.x, y: label.y, width: label.width ?? 0, height: label.height ?? 0 }
        : undefined;
    const src = nodePos.get(flowEdge.source);
    const dst = nodePos.get(flowEdge.target);
    return {
      id: flowEdge.id,
      source: flowEdge.source,
      target: flowEdge.target,
      type: "conditionEdge" as const,
      data: {
        when: flowEdge.data.when,
        max_iterations: flowEdge.data.max_iterations,
        edgeIndex: flowEdge.edgeIndex,
        isConditional: flowEdge.data.isConditional,
        route: route.length >= 2 ? route : undefined,
        labelBox,
        layoutAnchors:
          src && dst
            ? {
                source: { x: src.x + nodeWidth / 2, y: src.y + nodeHeight },
                target: { x: dst.x + nodeWidth / 2, y: dst.y },
              }
            : undefined,
      },
    };
  });

  // ELK keeps inline labels apart; this guards the rare residual overlap.
  separateBoxes(edges.flatMap((e) => (e.data?.labelBox ? [e.data.labelBox] : [])));

  return { nodes: positionedNodes, edges };
}
