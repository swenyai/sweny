import { useState, useEffect, useRef } from "react";
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
import { validateDefinition } from "@sweny-ai/engine";
import type { RecipeDefinition, StepResult } from "@sweny-ai/engine";
import type { StudioMode } from "./store/editor-store.js";

const nodeTypes = { stateNode: StateNode };
const edgeTypes = { transitionEdge: TransitionEdge };

function annotateEdgesWithErrors(
  edges: Edge<TransitionEdgeData>[],
  definition: RecipeDefinition,
): Edge<TransitionEdgeData>[] {
  const errors = validateDefinition(definition);
  const unknownTargets = new Set(
    errors
      .filter((e) => e.code === "UNKNOWN_TARGET" && e.stateId && e.targetId)
      .map((e) => `${e.stateId}::${e.targetId}`),
  );
  return edges.map((edge) => {
    const sourceState = definition.states[edge.source];
    const target = edge.data?.label === "→" ? sourceState?.next : sourceState?.on?.[edge.data?.label ?? ""];
    const isError = !!target && unknownTargets.has(`${edge.source}::${target}`);
    return { ...edge, data: { ...(edge.data ?? { label: "" }), isError } };
  });
}

function nodeColor(node: RFNode): string {
  const data = node.data as StateNodeData;
  if (data?.state?.phase === "learn") return "#bfdbfe";
  if (data?.state?.phase === "act") return "#fde68a";
  if (data?.state?.phase === "report") return "#bbf7d0";
  return "#e5e7eb";
}

function getNodeExecStatus(
  nodeId: string,
  currentStateId: string | null,
  completedStates: Record<string, StepResult>,
  mode: StudioMode,
): NodeExecStatus {
  if (mode === "design") return "pending";
  if (nodeId === currentStateId) return "current";
  const result = completedStates[nodeId];
  if (!result) return "pending";
  return result.status; // "success" | "failed" | "skipped"
}

export function RecipeViewer() {
  const {
    definition,
    selection,
    setSelection,
    addTransition,
    isLayoutStale,
    markLayoutFresh,
    currentStateId,
    completedStates,
    mode,
  } = useEditorStore();
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
            selected: selection?.kind === "state" && selection.id === node.id,
            data: {
              ...node.data,
              execStatus: getNodeExecStatus(node.id, currentStateId, completedStates, mode),
            },
          })),
        );
        setEdges(annotateEdgesWithErrors(e, definition));
        markLayoutFresh();
        initialLayoutDone.current = true;
      })
      .catch((err: unknown) => {
        setError(`Layout failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, isLayoutStale]);

  // Re-annotate edges with isError when definition changes, without re-running ELK
  useEffect(() => {
    if (!initialLayoutDone.current) return;
    setEdges((prev) => annotateEdgesWithErrors(prev, definition));
  }, [definition]);

  // Keep selection highlight and execStatus in sync without re-running ELK
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        selected: selection?.kind === "state" && selection.id === node.id,
        data: {
          ...node.data,
          execStatus: getNodeExecStatus(node.id, currentStateId, completedStates, mode),
        },
      })),
    );
  }, [currentStateId, completedStates, mode, selection]);

  function onNodeClick(_: React.MouseEvent, node: RFNode) {
    setSelection({ kind: "state", id: node.id });
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

  return (
    <div style={{ width: "100%", height: "100%" }}>
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
