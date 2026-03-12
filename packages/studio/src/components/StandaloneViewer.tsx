import { useState, useEffect, useRef } from "react";
import { ReactFlow, Background, Controls, MiniMap, useReactFlow, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { RecipeDefinition } from "@sweny-ai/engine";
import { StateNode } from "./StateNode.js";
import { TransitionEdge } from "./TransitionEdge.js";
import { layoutDefinition } from "../layout/elk.js";
import type { StateNodeType, StateNodeData } from "./StateNode.js";
import type { Edge } from "@xyflow/react";
import type { TransitionEdgeData } from "./TransitionEdge.js";

const nodeTypes = { stateNode: StateNode };
const edgeTypes = { transitionEdge: TransitionEdge };

const EMPTY_EXECUTION_STATE: Record<string, "current" | "success" | "failed" | "skipped"> = {};

export interface RecipeViewerProps {
  /** The RecipeDefinition to visualize. */
  definition: RecipeDefinition;
  /**
   * Highlight these state ids (e.g. from a live execution).
   * Keys are state ids, values are the execution status.
   */
  executionState?: Record<string, "current" | "success" | "failed" | "skipped">;
  /** Canvas height. Defaults to "100%". */
  height?: string | number;
  /** Called when the user clicks a node. */
  onNodeClick?: (stateId: string) => void;
}

/**
 * Rendered inside <ReactFlow> so it has access to the ReactFlow context.
 * Calls fitView() after ELK places nodes — fixes the blank-canvas bug where
 * the fitView prop runs on mount (empty nodes) and never re-fires.
 */
function AutoFitView({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  const prevCount = useRef(0);

  useEffect(() => {
    if (nodeCount > 0 && nodeCount !== prevCount.current) {
      prevCount.current = nodeCount;
      // Two rAFs: first lets React flush the node positions,
      // second lets ReactFlow measure them before fitting.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitView({ padding: 0.1, duration: 450, minZoom: 0.4 });
        });
      });
    }
  }, [nodeCount, fitView]);

  return null;
}

export function RecipeViewer({
  definition,
  executionState = EMPTY_EXECUTION_STATE,
  height = "100%",
  onNodeClick,
}: RecipeViewerProps) {
  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-run ELK only when the definition changes (structure change).
  useEffect(() => {
    setError(null);
    setLoading(true);
    layoutDefinition(definition)
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
  }, [definition]);

  // Update execution highlights without re-running ELK.
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
    onNodeClick?.(node.data.stateId);
  };

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
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        onNodeClick={onNodeClick ? handleNodeClick : undefined}
        fitView={false}
        colorMode="dark"
        defaultEdgeOptions={{
          type: "transitionEdge",
          markerEnd: { type: "arrowclosed" as const, color: "#475569", width: 14, height: 14 },
        }}
      >
        <AutoFitView nodeCount={nodes.length} />
        <Background color="#1e2840" gap={22} size={1.5} />
        <Controls
          showInteractive={false}
          style={{ background: "#0d1827", border: "1px solid #1e3050", borderRadius: 8 }}
        />
        <MiniMap
          style={{ background: "#080f1e", border: "1px solid #1e293b", borderRadius: 8 }}
          maskColor="rgba(8,14,30,0.8)"
          nodeColor={(node) => {
            const d = node.data as StateNodeData;
            if (d?.state?.phase === "learn") return "#3b82f6";
            if (d?.state?.phase === "act") return "#f59e0b";
            if (d?.state?.phase === "report") return "#10b981";
            return "#334155";
          }}
        />
      </ReactFlow>
    </div>
  );
}
