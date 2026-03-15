import type { WorkflowDefinition } from "@sweny-ai/engine";
import type { Edge } from "@xyflow/react";
import type { NodeExecStatus, StateNodeData, StateNodeType } from "../components/StateNode.js";
import type { TransitionEdgeData } from "../components/TransitionEdge.js";

export type FlowTransition = {
  source: string;
  target: string;
  label: string;
};

/**
 * Extract all transitions from a WorkflowDefinition.
 * Skips edges where target is "end" — those mark terminal steps.
 */
export function extractTransitions(def: WorkflowDefinition): FlowTransition[] {
  const transitions: FlowTransition[] = [];

  for (const [stepId, step] of Object.entries(def.steps)) {
    // next field → default path edge
    if (step.next && step.next !== "end") {
      transitions.push({ source: stepId, target: step.next, label: "→" });
    }
    // on entries
    if (step.on) {
      for (const [outcome, target] of Object.entries(step.on)) {
        if (target !== "end") {
          transitions.push({ source: stepId, target, label: outcome });
        }
      }
    }
  }

  return transitions;
}

/**
 * Determine if a step is terminal:
 * - Has no `next` (or next is "end")
 * - Has no `on` entries (or all `on` targets are "end")
 */
function isTerminal(stepId: string, def: WorkflowDefinition): boolean {
  const step = def.steps[stepId];
  if (!step) return false;

  const hasNext = step.next && step.next !== "end";
  if (hasNext) return false;

  const onEntries = Object.entries(step.on ?? {});
  if (onEntries.length === 0) return true;

  // Terminal if ALL on targets are "end"
  return onEntries.every(([, target]) => target === "end");
}

/**
 * Convert a WorkflowDefinition to un-positioned React Flow nodes and edges.
 * Positions are set to 0,0 — ELK will compute real positions.
 */
export function definitionToFlow(def: WorkflowDefinition): {
  nodes: StateNodeType[];
  edges: Edge<TransitionEdgeData>[];
} {
  const transitions = extractTransitions(def);

  const defaultExecStatus: NodeExecStatus = "pending";

  const nodes: StateNodeType[] = Object.entries(def.steps).map(([stepId, step]) => {
    const data: StateNodeData = {
      stateId: stepId,
      state: step,
      isInitial: stepId === def.initial,
      isTerminal: isTerminal(stepId, def),
      execStatus: defaultExecStatus,
    };
    return {
      id: stepId,
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
