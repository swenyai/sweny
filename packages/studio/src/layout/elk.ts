import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs";
import type { Edge } from "@xyflow/react";
import type { Workflow } from "@sweny-ai/core";
import { workflowToFlow } from "@sweny-ai/core/studio";
import type { StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";

const elk = new ELK();

const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 84;

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
}

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
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.edgeNodeBetweenLayers": "50",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: flowNodes.map(
      (node): ElkNode => ({
        id: node.id,
        width: nodeWidth,
        height: nodeHeight,
      }),
    ),
    edges: flowEdges.map(
      (edge): ElkExtendedEdge => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }),
    ),
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

  const edges: Edge<TransitionEdgeData>[] = flowEdges.map((flowEdge) => ({
    id: flowEdge.id,
    source: flowEdge.source,
    target: flowEdge.target,
    type: "conditionEdge" as const,
    data: {
      when: flowEdge.data.when,
      max_iterations: flowEdge.data.max_iterations,
      edgeIndex: flowEdge.edgeIndex,
      isConditional: flowEdge.data.isConditional,
    },
  }));

  return { nodes: positionedNodes, edges };
}
