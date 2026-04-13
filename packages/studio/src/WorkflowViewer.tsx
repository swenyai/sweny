import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  applyNodeChanges,
  type Edge,
  type Node as RFNode,
  type NodeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StateNode, type StateNodeType, type StateNodeData, type NodeExecStatus } from "./components/StateNode.js";
import { TransitionEdge, type TransitionEdgeData } from "./components/TransitionEdge.js";
import { ContextMenu, type ContextMenuState } from "./components/ContextMenu.js";
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
    return { ...edge, data: { ...(edge.data ?? { isConditional: false, edgeIndex: 0 }), isError } };
  });
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

function WorkflowCanvas() {
  const {
    workflow,
    selection,
    setSelection,
    addEdge: storeAddEdge,
    addNode,
    updateNode,
    isLayoutStale,
    markLayoutFresh,
    currentNodeId,
    completedNodes,
    mode,
  } = useEditorStore();

  const { screenToFlowPosition } = useReactFlow();

  const validationErrors = useMemo(() => validateWorkflow(workflow), [workflow]);
  const unreachableIds = useMemo(() => getUnreachableNodeIds(validationErrors), [validationErrors]);

  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialLayoutDone, setInitialLayoutDone] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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
              isEntry: node.id === workflow.entry,
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

  // Keep selection highlight, entry badge, and execStatus in sync without re-running ELK
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        selected: selection?.kind === "node" && selection.id === node.id,
        data: {
          ...node.data,
          isEntry: node.id === workflow.entry,
          execStatus: getNodeExecStatus(node.id, currentNodeId, completedNodes, mode),
          isUnreachable: unreachableIds.has(node.id),
        },
      })),
    );
  }, [workflow.entry, currentNodeId, completedNodes, mode, selection, unreachableIds]);

  // Handle node changes (dragging, selection) from React Flow
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Filter out select changes — we handle selection ourselves
    const positionChanges = changes.filter((c) => c.type !== "select");
    if (positionChanges.length > 0) {
      setNodes((nds) => applyNodeChanges(positionChanges, nds) as StateNodeType[]);
    }
  }, []);

  function onNodeClick(_: React.MouseEvent, node: RFNode) {
    setSelection({ kind: "node", id: node.id });
  }

  function onEdgeClick(_: React.MouseEvent, edge: Edge) {
    const edgeIndex = (edge.data as TransitionEdgeData | undefined)?.edgeIndex ?? 0;
    setSelection({ kind: "edge", id: edge.id, edgeIndex, from: edge.source, to: edge.target });
  }

  function onPaneClick() {
    setSelection(null);
    setContextMenu(null);
  }

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: RFNode) => {
      if (mode !== "design") return;
      event.preventDefault();
      setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
    },
    [mode],
  );

  function onConnect(connection: Connection) {
    if (connection.source && connection.target) {
      storeAddEdge(connection.source, connection.target);
    }
  }

  // Toolbox drag-and-drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/sweny-node");
      if (!raw) return;

      const template = JSON.parse(raw) as {
        name: string;
        defaultId: string;
        skills: string[];
        instruction: string;
      };

      // Generate unique ID
      const existing = new Set(Object.keys(workflow.nodes));
      let id = template.defaultId;
      let counter = 1;
      while (existing.has(id)) {
        id = `${template.defaultId}_${counter++}`;
      }

      // Add node to store
      addNode(id);
      // Apply template data
      updateNode(id, {
        name: template.name || id,
        skills: template.skills ?? [],
        instruction: template.instruction ?? "",
      });

      // Select the new node
      setSelection({ kind: "node", id });
    },
    [workflow.nodes, addNode, updateNode, setSelection],
  );

  const nodeCount = Object.keys(workflow.nodes).length;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {nodeCount === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400 pointer-events-none z-10">
          <p className="text-sm">No nodes yet.</p>
          <p className="text-xs">Drag a node from the toolbox on the left</p>
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
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodesDraggable
          snapToGrid
          snapGrid={[10, 10]}
        >
          <Background />
          <Controls />
        </ReactFlow>
      )}
      {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

export function WorkflowViewer() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas />
    </ReactFlowProvider>
  );
}
