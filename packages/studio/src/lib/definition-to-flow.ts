import type { RecipeDefinition } from "@sweny-ai/engine";
import type { Edge } from "@xyflow/react";
import type { NodeExecStatus, StateNodeData, StateNodeType } from "../components/StateNode.js";
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
export function extractTransitions(def: RecipeDefinition): FlowTransition[] {
  const transitions: FlowTransition[] = [];

  for (const [stateId, state] of Object.entries(def.states)) {
    // next field → default path edge
    if (state.next && state.next !== "end") {
      transitions.push({ source: stateId, target: state.next, label: "→" });
    }
    // on entries
    if (state.on) {
      for (const [outcome, target] of Object.entries(state.on)) {
        if (target !== "end") {
          transitions.push({ source: stateId, target, label: outcome });
        }
      }
    }
  }

  return transitions;
}

/**
 * Determine if a state is terminal:
 * - Has no `next` (or next is "end")
 * - Has no `on` entries (or all `on` targets are "end")
 */
function isTerminal(stateId: string, def: RecipeDefinition): boolean {
  const state = def.states[stateId];
  if (!state) return false;

  const hasNext = state.next && state.next !== "end";
  if (hasNext) return false;

  const onEntries = Object.entries(state.on ?? {});
  if (onEntries.length === 0) return true;

  // Terminal if ALL on targets are "end"
  return onEntries.every(([, target]) => target === "end");
}

/**
 * Convert a RecipeDefinition to un-positioned React Flow nodes and edges.
 * Positions are set to 0,0 — ELK will compute real positions.
 */
export function definitionToFlow(def: RecipeDefinition): {
  nodes: StateNodeType[];
  edges: Edge<TransitionEdgeData>[];
} {
  const transitions = extractTransitions(def);

  const defaultExecStatus: NodeExecStatus = "pending";

  const nodes: StateNodeType[] = Object.entries(def.states).map(([stateId, state]) => {
    const data: StateNodeData = {
      stateId,
      state,
      isInitial: stateId === def.initial,
      isTerminal: isTerminal(stateId, def),
      execStatus: defaultExecStatus,
    };
    return {
      id: stateId,
      type: "stateNode" as const,
      position: { x: 0, y: 0 },
      data,
    };
  });

  const edges: Edge<TransitionEdgeData>[] = transitions.map(({ source, target, label }) => ({
    id: `${source}--${label}--${target}`,
    source,
    target,
    type: "transitionEdge" as const,
    data: { label },
  }));

  return { nodes, edges };
}
