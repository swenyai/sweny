import { type Node, type NodeProps } from "@xyflow/react";
import type { StateDefinition } from "@sweny-ai/engine";
export type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";
export type StateNodeData = {
  stateId: string;
  state: StateDefinition;
  isInitial: boolean;
  isTerminal: boolean;
  execStatus: NodeExecStatus;
};
export type StateNodeType = Node<StateNodeData, "stateNode">;
export declare function StateNode({ data }: NodeProps<StateNodeType>): import("react/jsx-runtime").JSX.Element;
