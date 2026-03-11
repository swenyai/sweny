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
          fitView({ padding: 0.15, duration: 400 });
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
    <div style={{ width: "100%", height, position: "relative" }}>
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            background: "rgba(0,0,0,0.15)",
            borderRadius: "inherit",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: "3px solid rgba(99,102,241,0.3)",
              borderTopColor: "#6366f1",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}
          />
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
      >
        <AutoFitView nodeCount={nodes.length} />
        <Background />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            const d = node.data as StateNodeData;
            if (d?.state?.phase === "learn") return "#bfdbfe";
            if (d?.state?.phase === "act") return "#fde68a";
            if (d?.state?.phase === "report") return "#bbf7d0";
            return "#e5e7eb";
          }}
        />
      </ReactFlow>
    </div>
  );
}
