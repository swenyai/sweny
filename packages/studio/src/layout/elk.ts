import ELK from "elkjs/lib/elk.bundled.js";
import type { Edge } from "@xyflow/react";
import type { RecipeDefinition } from "@sweny-ai/engine";
import type { StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";
import { definitionToFlow, extractTransitions } from "../lib/definition-to-flow.js";

// ELK doesn't ship TypeScript types; use unknown and cast where needed
const elk = new (ELK as new () => { layout: (graph: unknown) => Promise<unknown> })();

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

type ElkNode = { id: string; x?: number; y?: number };
type ElkGraph = { children?: ElkNode[] };

/**
 * Run ELK auto-layout on a RecipeDefinition.
 * Returns React Flow nodes with computed positions and the corresponding edges.
 */
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
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.edgeNodeBetweenLayers": "40",
    },
    children: rfNodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: transitions.map(({ source, target, label }) => ({
      id: `${source}--${label}--${target}`,
      sources: [source],
      targets: [target],
    })),
  };

  const layout = (await elk.layout(elkGraph)) as ElkGraph;

  // Map ELK positions back to React Flow nodes
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
