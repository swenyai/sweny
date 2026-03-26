/**
 * Studio Adapter
 *
 * Converts between @sweny-ai/core Workflow types and React Flow
 * graph structures. This replaces definition-to-flow.ts in the
 * old Studio — and it's dramatically simpler because our Workflow
 * type already uses explicit nodes + edges (not next/on routing).
 *
 * Old Studio flow:
 *   WorkflowDefinition → extractTransitions() → build nodes → build edges → ELK
 *   (94 lines of conversion code)
 *
 * New Studio flow:
 *   Workflow → workflowToFlow()
 *   (direct mapping — edges are already explicit)
 *
 * The big wins for Studio in the new model:
 *
 * 1. NO CONVERSION LAYER — Workflow.nodes → React Flow nodes,
 *    Workflow.edges → React Flow edges. It's a 1:1 map.
 *
 * 2. SKILL CATALOG in the properties panel — instead of picking
 *    from "phase" and "uses" (provider roles), users browse a
 *    skill catalog and toggle which skills are available at each node.
 *
 * 3. INSTRUCTION EDITOR — each node has a rich-text instruction
 *    instead of a one-line description. This is what Claude actually
 *    reads, so WYSIWYG.
 *
 * 4. NATURAL LANGUAGE EDGE CONDITIONS — instead of "outcome → target"
 *    with magic string outcomes, edges have human-readable `when`
 *    clauses like "severity is high or critical".
 *
 * 5. OUTPUT SCHEMA EDITOR — optional JSON schema per node for
 *    structured output. Studio could render this as a form builder.
 *
 * 6. LIVE EXECUTION OVERLAY — the event stream from execute() maps
 *    directly to node highlights. node:enter → glow blue,
 *    tool:call → show tool name, node:exit → green/red.
 */

import type { Workflow, Node, Edge, ExecutionEvent, NodeResult, Skill } from "./types.js";
import { builtinSkills } from "./skills/index.js";

// ─── React Flow types (minimal subset) ──────────────────────────

export interface FlowNode {
  id: string;
  type: "skillNode";
  position: { x: number; y: number };
  data: SkillNodeData;
}

export interface SkillNodeData {
  nodeId: string;
  node: Node;
  isEntry: boolean;
  isTerminal: boolean;
  /** Resolved skill metadata for the node's skill IDs */
  skills: { id: string; name: string; toolCount: number }[];
  /** Execution state (for live/simulate mode) */
  exec: {
    status: "pending" | "running" | "success" | "failed" | "skipped";
    result?: NodeResult;
    currentTool?: string;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: "conditionEdge";
  data: {
    when?: string;
    isConditional: boolean;
  };
}

// ─── Conversion ──────────────────────────────────────────────────

/**
 * Convert a Workflow to React Flow nodes + edges.
 *
 * This is the entire conversion layer — compare to the old
 * definitionToFlow() which had to parse next/on routing into edges.
 */
export function workflowToFlow(
  workflow: Workflow,
  skillCatalog: Skill[] = builtinSkills,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const skillMap = new Map(skillCatalog.map((s) => [s.id, s]));
  const terminalIds = findTerminals(workflow);

  const nodes: FlowNode[] = Object.entries(workflow.nodes).map(([id, node]) => ({
    id,
    type: "skillNode" as const,
    position: { x: 0, y: 0 }, // ELK will compute real positions
    data: {
      nodeId: id,
      node,
      isEntry: id === workflow.entry,
      isTerminal: terminalIds.has(id),
      skills: node.skills.map((sid) => {
        const skill = skillMap.get(sid);
        return {
          id: sid,
          name: skill?.name ?? sid,
          toolCount: skill?.tools.length ?? 0,
        };
      }),
      exec: { status: "pending" },
    },
  }));

  const edges: FlowEdge[] = workflow.edges.map((edge) => ({
    id: `${edge.from}--${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: "conditionEdge" as const,
    data: {
      when: edge.when,
      isConditional: !!edge.when,
    },
  }));

  return { nodes, edges };
}

/**
 * Apply an execution event to the flow state.
 * Returns a function that mutates SkillNodeData in place (for Zustand/immer).
 */
export function applyExecutionEvent(event: ExecutionEvent, nodeDataMap: Map<string, SkillNodeData>): void {
  switch (event.type) {
    case "workflow:start":
      for (const data of nodeDataMap.values()) {
        data.exec = { status: "pending" };
      }
      break;

    case "node:enter": {
      const data = nodeDataMap.get(event.node);
      if (data) data.exec = { status: "running" };
      break;
    }

    case "tool:call": {
      const data = nodeDataMap.get(event.node);
      if (data) data.exec.currentTool = event.tool;
      break;
    }

    case "tool:result": {
      const data = nodeDataMap.get(event.node);
      if (data) data.exec.currentTool = undefined;
      break;
    }

    case "node:exit": {
      const data = nodeDataMap.get(event.node);
      if (data) {
        data.exec = {
          status: event.result.status === "success" ? "success" : "failed",
          result: event.result,
        };
      }
      break;
    }
  }
}

// ─── Reverse conversion (Studio → Workflow) ──────────────────────

/**
 * Convert React Flow state back to a Workflow.
 * This is what "Export" / "Save" does in Studio.
 */
export function flowToWorkflow(
  meta: { id: string; name: string; description: string; entry: string },
  nodes: FlowNode[],
  edges: FlowEdge[],
): Workflow {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    entry: meta.entry,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n.data.node])),
    edges: edges.map((e) => ({
      from: e.source,
      to: e.target,
      ...(e.data.when ? { when: e.data.when } : {}),
    })),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function findTerminals(workflow: Workflow): Set<string> {
  const hasOutgoing = new Set(workflow.edges.map((e) => e.from));
  return new Set(Object.keys(workflow.nodes).filter((id) => !hasOutgoing.has(id)));
}

/**
 * Generate a TypeScript file from a Workflow definition.
 *
 * Compare to the old exportAsTypescript() which generated step
 * implementation stubs. The new export is just the workflow
 * definition — Claude does the implementation.
 */
export function exportAsTypescript(workflow: Workflow): string {
  const varName = workflow.id.replace(/[^a-zA-Z0-9]/g, "_");

  return `import type { Workflow } from "@sweny-ai/core";

export const ${varName}: Workflow = ${JSON.stringify(workflow, null, 2)};
`;
}

/**
 * Skill catalog for the Studio properties panel.
 * Returns all available skills with their tool lists.
 */
export function getSkillCatalog(extraSkills: Skill[] = []): {
  id: string;
  name: string;
  description: string;
  tools: { name: string; description: string }[];
}[] {
  return [...builtinSkills, ...extraSkills].map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tools: s.tools.map((t) => ({ name: t.name, description: t.description })),
  }));
}
