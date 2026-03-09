import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StateDefinition, WorkflowPhase } from "@sweny-ai/engine";

export type StateNodeData = {
  stateId: string;
  state: StateDefinition;
  isInitial: boolean;
  isTerminal: boolean;
};

// In @xyflow/react v12, custom node types use: type MyNode = Node<Data, "typeName">
export type StateNodeType = Node<StateNodeData, "stateNode">;

const phaseColors: Record<WorkflowPhase, string> = {
  learn: "bg-blue-100 text-blue-800",
  act: "bg-amber-100 text-amber-800",
  report: "bg-green-100 text-green-800",
};

const phaseBorderColors: Record<WorkflowPhase, string> = {
  learn: "border-blue-300",
  act: "border-amber-300",
  report: "border-green-300",
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const { stateId, state, isInitial, isTerminal } = data;

  const borderStyle = isInitial ? "border-4 border-double" : isTerminal ? "border-2 border-dashed" : "border-2";

  const phaseBorder = phaseBorderColors[state.phase];

  return (
    <div className={`rounded-lg bg-white shadow-md p-3 min-w-[180px] max-w-[220px] ${borderStyle} ${phaseBorder}`}>
      {/* Target handle (left) */}
      <Handle type="target" position={Position.Left} />

      {/* Header row: state id + critical badge */}
      <div className="flex items-center gap-1 flex-wrap mb-1">
        <span className="font-bold text-gray-800 text-sm truncate flex-1">{stateId}</span>
        {state.critical && (
          <span className="text-xs font-semibold bg-red-100 text-red-700 rounded px-1 py-0.5">critical</span>
        )}
      </div>

      {/* Phase badge */}
      <div className="mb-1">
        <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${phaseColors[state.phase]}`}>{state.phase}</span>
      </div>

      {/* Description */}
      {state.description && (
        <p className="text-xs text-gray-500 mt-1 leading-tight line-clamp-2">{state.description}</p>
      )}

      {/* Source handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-blue-500 border-2 border-white opacity-0 hover:opacity-100 transition-opacity"
      />
    </div>
  );
}
