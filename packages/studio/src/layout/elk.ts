import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs";
import type { Edge } from "@xyflow/react";
import type { RecipeDefinition } from "@sweny-ai/engine";
import type { StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";
import { definitionToFlow, extractTransitions } from "../lib/definition-to-flow.js";

const elk = new ELK();

const NODE_WIDTH = 230;
const NODE_HEIGHT = 110;

export async function layoutDefinition(def: RecipeDefinition): Promise<{
  nodes: StateNodeType[];
  edges: Edge<TransitionEdgeData>[];
}> {
  const { nodes: rfNodes, edges: rfEdges } = definitionToFlow(def);
  const transitions = extractTransitions(def);

  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.edgeNodeBetweenLayers": "52",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: rfNodes.map(
      (node): ElkNode => ({
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }),
    ),
    edges: transitions.map(
      ({ source, target, label }): ElkExtendedEdge => ({
        id: `${source}--${label}--${target}`,
        sources: [source],
        targets: [target],
      }),
    ),
  };

  const layout = await elk.layout(elkGraph);

  const positionedNodes: StateNodeType[] = rfNodes.map((node) => {
    const elkNode = layout.children?.find((c) => c.id === node.id);
    return {
      ...node,
      position: {
        x: elkNode?.x ?? 0,
        y: elkNode?.y ?? 0,
      },
    };
  });

  return { nodes: positionedNodes, edges: rfEdges };
}
