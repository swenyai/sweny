import { useState, useEffect, useRef, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node as RFNode,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StateNode, type StateNodeType, type StateNodeData, type NodeExecStatus } from "./components/StateNode.js";
import { TransitionEdge, type TransitionEdgeData } from "./components/TransitionEdge.js";
import { layoutDefinition } from "./layout/elk.js";
import { useEditorStore } from "./store/editor-store.js";
import { validateWorkflow } from "@sweny-ai/engine";
import type { WorkflowDefinition, StepResult } from "@sweny-ai/engine";
import type { StudioMode } from "./store/editor-store.js";

const nodeTypes = { stateNode: StateNode };
const edgeTypes = { transitionEdge: TransitionEdge };

function getUnreachableStepIds(errors: ReturnType<typeof validateWorkflow>): Set<string> {
  return new Set(errors.filter((e) => e.code === "UNREACHABLE_STEP" && e.stateId).map((e) => e.stateId!));
}

function annotateEdgesWithErrors(
  edges: Edge<TransitionEdgeData>[],
  definition: WorkflowDefinition,
  errors: ReturnType<typeof validateWorkflow>,
): Edge<TransitionEdgeData>[] {
  const unknownTargets = new Set(
    errors
      .filter((e) => e.code === "UNKNOWN_TARGET" && e.stateId && e.targetId)
      .map((e) => `${e.stateId}::${e.targetId}`),
  );
  return edges.map((edge) => {
    const sourceStep = definition.steps[edge.source];
    const target = edge.data?.label === "→" ? sourceStep?.next : sourceStep?.on?.[edge.data?.label ?? ""];
    const isError = !!target && unknownTargets.has(`${edge.source}::${target}`);
    return { ...edge, data: { ...(edge.data ?? { label: "" }), isError } };
  });
}

function nodeColor(node: RFNode): string {
  const data = node.data as StateNodeData;
  // Execution status takes priority over phase color in simulate/live modes
  if (data?.execStatus === "current") return "#93c5fd"; // blue-300
  if (data?.execStatus === "success") return "#86efac"; // green-300
  if (data?.execStatus === "failed") return "#fca5a5"; // red-300
  if (data?.execStatus === "skipped") return "#d1d5db"; // gray-300
  if (data?.state?.phase === "learn") return "#bfdbfe";
  if (data?.state?.phase === "act") return "#fde68a";
  if (data?.state?.phase === "report") return "#bbf7d0";
  return "#e5e7eb";
}

function getNodeExecStatus(
  nodeId: string,
  currentStepId: string | null,
  completedSteps: Record<string, StepResult>,
  mode: StudioMode,
): NodeExecStatus {
  if (mode === "design") return "pending";
  if (nodeId === currentStepId) return "current";
  const result = completedSteps[nodeId];
  if (!result) return "pending";
  return result.status; // "success" | "failed" | "skipped"
}

export function WorkflowViewer() {
  const {
    definition,
    selection,
    setSelection,
    addTransition,
    isLayoutStale,
    markLayoutFresh,
    currentStepId,
    completedSteps,
    mode,
  } = useEditorStore();
  // Validate once per definition change — shared by all effects below
  const validationErrors = useMemo(() => validateWorkflow(definition), [definition]);
  const unreachableIds = useMemo(() => getUnreachableStepIds(validationErrors), [validationErrors]);

  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const initialLayoutDone = useRef(false);

  // Re-layout whenever definition changes structurally
  useEffect(() => {
    if (!isLayoutStale && initialLayoutDone.current) return; // skip if layout is fresh
    setError(null);
    layoutDefinition(definition)
      .then(({ nodes: n, edges: e }) => {
        setNodes(
          n.map((node) => ({
            ...node,
            selected: selection?.kind === "step" && selection.id === node.id,
            data: {
              ...node.data,
              execStatus: getNodeExecStatus(node.id, currentStepId, completedSteps, mode),
              isUnreachable: unreachableIds.has(node.id),
            },
          })),
        );
        setEdges(annotateEdgesWithErrors(e, definition, validationErrors));
        markLayoutFresh();
        initialLayoutDone.current = true;
      })
      .catch((err: unknown) => {
        setError(`Layout failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, isLayoutStale, validationErrors, unreachableIds]);

  // Re-annotate edges with isError when definition changes, without re-running ELK
  useEffect(() => {
    if (!initialLayoutDone.current) return;
    setEdges((prev) => annotateEdgesWithErrors(prev, definition, validationErrors));
  }, [definition, validationErrors]);

  // Keep selection highlight and execStatus in sync without re-running ELK
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        selected: selection?.kind === "step" && selection.id === node.id,
        data: {
          ...node.data,
          execStatus: getNodeExecStatus(node.id, currentStepId, completedSteps, mode),
          isUnreachable: unreachableIds.has(node.id),
        },
      })),
    );
  }, [currentStepId, completedSteps, mode, selection, unreachableIds]);

  function onNodeClick(_: React.MouseEvent, node: RFNode) {
    setSelection({ kind: "step", id: node.id });
  }

  function onEdgeClick(_: React.MouseEvent, edge: Edge) {
    const data = edge.data as TransitionEdgeData;
    setSelection({ kind: "edge", source: edge.source, outcome: data.label });
  }

  function onPaneClick() {
    setSelection(null);
  }

  function onConnect(connection: Connection) {
    // New connection dragged by user — default outcome is "success"
    if (connection.source && connection.target) {
      addTransition(connection.source, "success", connection.target);
    }
  }

  const stepCount = Object.keys(definition.steps).length;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {stepCount === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400 pointer-events-none z-10">
          <p className="text-sm">No steps yet.</p>
          <p className="text-xs">Add your first step using the toolbar above ↑</p>
        </div>
      )}
      {error ? (
        <div className="flex items-center justify-center w-full h-full bg-red-50 text-red-700 p-4">
          <p className="font-mono text-sm">{error}</p>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
        >
          <Background />
          <Controls />
          <MiniMap nodeColor={nodeColor} />
        </ReactFlow>
      )}
    </div>
  );
}
