import { useState, useEffect, useMemo } from "react";
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
import { layoutWorkflow } from "./layout/elk.js";
import { useEditorStore } from "./store/editor-store.js";
import { validateWorkflow } from "@sweny-ai/core/schema";
import type { NodeResult } from "@sweny-ai/core";
import type { StudioMode } from "./store/editor-store.js";

const nodeTypes = { skillNode: StateNode };
const edgeTypes = { conditionEdge: TransitionEdge };

function getUnreachableNodeIds(errors: ReturnType<typeof validateWorkflow>): Set<string> {
  return new Set(errors.filter((e) => e.code === "UNREACHABLE_NODE" && e.nodeId).map((e) => e.nodeId!));
}

function annotateEdgesWithErrors(
  edges: Edge<TransitionEdgeData>[],
  errors: ReturnType<typeof validateWorkflow>,
): Edge<TransitionEdgeData>[] {
  const unknownTargets = new Set(
    errors.filter((e) => e.code === "UNKNOWN_EDGE_TARGET" && e.nodeId).map((e) => e.nodeId!),
  );
  const unknownSources = new Set(
    errors.filter((e) => e.code === "UNKNOWN_EDGE_SOURCE" && e.nodeId).map((e) => e.nodeId!),
  );
  return edges.map((edge) => {
    const isError = unknownTargets.has(edge.target) || unknownSources.has(edge.source);
    return { ...edge, data: { ...(edge.data ?? { isConditional: false }), isError } };
  });
}

function nodeColor(node: RFNode): string {
  const data = node.data as StateNodeData;
  if (data?.execStatus === "current") return "#93c5fd";
  if (data?.execStatus === "success") return "#86efac";
  if (data?.execStatus === "failed") return "#fca5a5";
  if (data?.execStatus === "skipped") return "#d1d5db";
  if (data?.isEntry) return "#bfdbfe";
  return "#e5e7eb";
}

function getNodeExecStatus(
  nodeId: string,
  currentNodeId: string | null,
  completedNodes: Record<string, NodeResult>,
  mode: StudioMode,
): NodeExecStatus {
  if (mode === "design") return "pending";
  if (nodeId === currentNodeId) return "current";
  const result = completedNodes[nodeId];
  if (!result) return "pending";
  return result.status;
}

export function WorkflowViewer() {
  const {
    workflow,
    selection,
    setSelection,
    addEdge: storeAddEdge,
    isLayoutStale,
    markLayoutFresh,
    currentNodeId,
    completedNodes,
    mode,
  } = useEditorStore();

  const validationErrors = useMemo(() => validateWorkflow(workflow), [workflow]);
  const unreachableIds = useMemo(() => getUnreachableNodeIds(validationErrors), [validationErrors]);

  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialLayoutDone, setInitialLayoutDone] = useState(false);

  // Re-layout whenever workflow changes structurally
  useEffect(() => {
    if (!isLayoutStale && initialLayoutDone) return;
    setError(null);
    layoutWorkflow(workflow)
      .then(({ nodes: n, edges: e }) => {
        setNodes(
          n.map((node) => ({
            ...node,
            selected: selection?.kind === "node" && selection.id === node.id,
            data: {
              ...node.data,
              execStatus: getNodeExecStatus(node.id, currentNodeId, completedNodes, mode),
              isUnreachable: unreachableIds.has(node.id),
            },
          })),
        );
        setEdges(annotateEdgesWithErrors(e, validationErrors));
        markLayoutFresh();
        setInitialLayoutDone(true);
      })
      .catch((err: unknown) => {
        setError(`Layout failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, isLayoutStale, validationErrors, unreachableIds]);

  // Re-annotate edges when workflow changes without re-running ELK
  useEffect(() => {
    if (!initialLayoutDone) return;
    setEdges((prev) => annotateEdgesWithErrors(prev, validationErrors));
  }, [workflow, validationErrors, initialLayoutDone]);

  // Keep selection highlight and execStatus in sync without re-running ELK
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        selected: selection?.kind === "node" && selection.id === node.id,
        data: {
          ...node.data,
          execStatus: getNodeExecStatus(node.id, currentNodeId, completedNodes, mode),
          isUnreachable: unreachableIds.has(node.id),
        },
      })),
    );
  }, [currentNodeId, completedNodes, mode, selection, unreachableIds]);

  function onNodeClick(_: React.MouseEvent, node: RFNode) {
    setSelection({ kind: "node", id: node.id });
  }

  function onEdgeClick(_: React.MouseEvent, edge: Edge) {
    setSelection({ kind: "edge", id: edge.id, from: edge.source, to: edge.target });
  }

  function onPaneClick() {
    setSelection(null);
  }

  function onConnect(connection: Connection) {
    if (connection.source && connection.target) {
      storeAddEdge(connection.source, connection.target);
    }
  }

  const nodeCount = Object.keys(workflow.nodes).length;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {nodeCount === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400 pointer-events-none z-10">
          <p className="text-sm">No nodes yet.</p>
          <p className="text-xs">Add your first node using the toolbar above</p>
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
