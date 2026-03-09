import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StateDefinition, WorkflowPhase } from "@sweny-ai/engine";

export type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";

export type StateNodeData = {
  stateId: string;
  state: StateDefinition;
  isInitial: boolean;
  isTerminal: boolean;
  execStatus: NodeExecStatus;
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

const execRing: Record<NodeExecStatus, string> = {
  current: "ring-2 ring-blue-500 ring-offset-1 animate-pulse",
  success: "ring-2 ring-green-400",
  failed: "ring-2 ring-red-500",
  skipped: "ring-2 ring-gray-400",
  pending: "",
};

const execBg: Record<NodeExecStatus, string> = {
  current: "bg-blue-50",
  success: "bg-green-50",
  failed: "bg-red-50",
  skipped: "bg-gray-50",
  pending: "bg-white",
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const { stateId, state, isInitial, isTerminal, execStatus } = data;

  const borderStyle = isInitial ? "border-4 border-double" : isTerminal ? "border-2 border-dashed" : "border-2";

  const phaseBorder = phaseBorderColors[state.phase];
  const ring = execRing[execStatus];
  const bg = execBg[execStatus];

  return (
    <div className={`rounded-lg shadow-md p-3 min-w-[180px] max-w-[220px] ${borderStyle} ${phaseBorder} ${ring} ${bg}`}>
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
