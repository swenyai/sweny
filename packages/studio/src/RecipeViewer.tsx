import { useState, useEffect } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { RecipeDefinition } from "@sweny-ai/engine";
import { StateNode, type StateNodeType, type StateNodeData } from "./components/StateNode.js";
import { TransitionEdge, type TransitionEdgeData } from "./components/TransitionEdge.js";
import { layoutDefinition } from "./layout/elk.js";

const nodeTypes = { stateNode: StateNode };
const edgeTypes = { transitionEdge: TransitionEdge };

interface RecipeViewerProps {
  definition: RecipeDefinition;
  /** Optional: highlight these state ids (e.g. for simulation) */
  activeStateIds?: string[];
}

export function RecipeViewer({ definition, activeStateIds = [] }: RecipeViewerProps) {
  const [nodes, setNodes] = useState<StateNodeType[]>([]);
  const [edges, setEdges] = useState<Edge<TransitionEdgeData>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    layoutDefinition(definition)
      .then(({ nodes: n, edges: e }) => {
        // Apply active highlighting
        const highlighted = n.map((node) => ({
          ...node,
          selected: activeStateIds.includes(node.id),
        }));
        setNodes(highlighted);
        setEdges(e);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Layout failed: ${message}`);
      });
  }, [definition, activeStateIds]);

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-red-50 text-red-700 p-4">
        <p className="font-mono text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as StateNodeData;
            if (data?.state?.phase === "learn") return "#bfdbfe";
            if (data?.state?.phase === "act") return "#fde68a";
            if (data?.state?.phase === "report") return "#bbf7d0";
            return "#e5e7eb";
          }}
        />
      </ReactFlow>
    </div>
  );
}
