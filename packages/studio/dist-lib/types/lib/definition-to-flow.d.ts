import type { RecipeDefinition } from "@sweny-ai/engine";
import type { Edge } from "@xyflow/react";
import type { StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";
export type FlowTransition = {
  source: string;
  target: string;
  label: string;
};
/**
 * Extract all transitions from a RecipeDefinition.
 * Skips edges where target is "end" — those mark terminal states.
 */
export declare function extractTransitions(def: RecipeDefinition): FlowTransition[];
/**
 * Convert a RecipeDefinition to un-positioned React Flow nodes and edges.
 * Positions are set to 0,0 — ELK will compute real positions.
 */
export declare function definitionToFlow(def: RecipeDefinition): {
  nodes: StateNodeType[];
  edges: Edge<TransitionEdgeData>[];
};
