import type { Edge } from "@xyflow/react";
import type { RecipeDefinition } from "@sweny-ai/engine";
import type { StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";
export declare function layoutDefinition(def: RecipeDefinition): Promise<{
  nodes: StateNodeType[];
  edges: Edge<TransitionEdgeData>[];
}>;
