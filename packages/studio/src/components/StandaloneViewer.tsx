import { useState, useEffect, useRef, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Workflow } from "@sweny-ai/core";
import { StateNode } from "./StateNode.js";
import { TransitionEdge } from "./TransitionEdge.js";
import { layoutWorkflow, type LayoutOptions } from "../layout/elk.js";
import type { StateNodeType, StateNodeData, NodeExecStatus } from "./StateNode.js";
import type { Edge } from "@xyflow/react";
import type { TransitionEdgeData } from "./TransitionEdge.js";

const nodeTypes = { skillNode: StateNode };
const edgeTypes = { conditionEdge: TransitionEdge };

const EMPTY_EXECUTION_STATE: Record<string, NodeExecStatus> = {};

export interface WorkflowViewerProps {
  /** The Workflow to visualize. */
  workflow: Workflow;
  /**
   * Highlight these node ids (e.g. from a live execution).
   * Keys are node ids, values are the execution status.
   */
  executionState?: Record<string, NodeExecStatus>;
  /** Canvas height. Defaults to "100%". */
  height?: string | number;
  /** Called when the user clicks a node. */
  onNodeClick?: (nodeId: string) => void;
  /** Show the minimap overlay. Defaults to true. */
  showMiniMap?: boolean;
  /** Node width in pixels for ELK layout. Defaults to 280. */
  nodeWidth?: number;
  /** Node height in pixels for ELK layout. Defaults to 84. */
  nodeHeight?: number;
}

function AutoFitView({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  const prevCount = useRef(0);

  useEffect(() => {
    if (nodeCount > 0 && nodeCount !== prevCount.current) {
      prevCount.current = nodeCount;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitView({ padding: 0.15, duration: 450, minZoom: 0.15 });
        });
      });
    }
  }, [nodeCount, fitView]);

  return null;
}

export function WorkflowViewer({
  workflow,
  executionState = EMPTY_EXECUTION_STATE,
  height = "100%",
  onNodeClick,
  showMiniMap = true,
  nodeWidth,
  nodeHeight,
}: WorkflowViewerProps) {
  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setLoading(true);
    const layoutOpts: LayoutOptions = {};
    if (nodeWidth) layoutOpts.nodeWidth = nodeWidth;
    if (nodeHeight) layoutOpts.nodeHeight = nodeHeight;
    layoutWorkflow(workflow, layoutOpts)
      .then(({ nodes: n, edges: e }) => {
        setNodes(
          n.map((node) => ({
            ...node,
            data: {
              ...node.data,
              execStatus: executionState[node.id] ?? "pending",
            },
          })),
        );
        setEdges(e);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(`Layout failed: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, nodeWidth, nodeHeight]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        data: {
          ...node.data,
          execStatus: executionState[node.id] ?? "pending",
        },
      })),
    );
  }, [executionState]);

  const handleNodeClick: NodeMouseHandler<StateNodeType> = (_evt, node) => {
    onNodeClick?.(node.data.nodeId);
  };

  const onNodesChange = useCallback(
    (changes: NodeChange<StateNodeType>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge<TransitionEdgeData>>[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height,
          background: "#fef2f2",
          color: "#b91c1c",
          padding: "1rem",
        }}
      >
        <code style={{ fontSize: "0.75rem" }}>{error}</code>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height,
        position: "relative",
        background: "#060d1a",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            background: "rgba(0,0,0,0.35)",
            borderRadius: "inherit",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: "3px solid rgba(99,102,241,0.25)",
              borderTopColor: "#6366f1",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}
          />
        </div>
      )}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes node-pulse {
          0%, 100% { box-shadow: 0 0 0 2.5px #3b82f6, 0 0 20px rgba(59,130,246,0.4); }
          50%       { box-shadow: 0 0 0 2.5px #3b82f6, 0 0 30px rgba(59,130,246,0.65); }
        }
        .react-flow__node[data-exec-status="current"] > div {
          animation: node-pulse 2s ease-in-out infinite;
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        onNodeClick={onNodeClick ? handleNodeClick : undefined}
        fitView={false}
        colorMode="dark"
        defaultEdgeOptions={{
          type: "conditionEdge",
          markerEnd: { type: "arrowclosed" as const, color: "#4d7aaa", width: 20, height: 20 },
        }}
      >
        <AutoFitView nodeCount={nodes.length} />
        <Background color="#1e2840" gap={22} size={1.5} />
        <Controls
          showInteractive={false}
          style={{ background: "#0d1827", border: "1px solid #1e3050", borderRadius: 8 }}
        />
        {showMiniMap && (
          <MiniMap
            style={{ background: "#080f1e", border: "1px solid #1e293b", borderRadius: 8 }}
            maskColor="rgba(8,14,30,0.8)"
            nodeColor={(node) => {
              const d = node.data as StateNodeData;
              if (d?.isEntry) return "#3b82f6";
              if (d?.isTerminal) return "#10b981";
              return "#334155";
            }}
          />
        )}
      </ReactFlow>
    </div>
  );
}
