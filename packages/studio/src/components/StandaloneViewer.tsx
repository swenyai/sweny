import { useState, useEffect } from "react";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
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
}

export function RecipeViewer({ definition, executionState = {}, height = "100%" }: RecipeViewerProps) {
  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
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
      })
      .catch((err: unknown) => {
        setError(`Layout failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [definition, executionState]);

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
    <div style={{ width: "100%", height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
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
