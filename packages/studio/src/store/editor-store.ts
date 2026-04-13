import { create } from "zustand";
import { temporal } from "zundo";
import { produce } from "immer";
import type { Workflow, Node, Edge, ExecutionEvent, NodeResult } from "@sweny-ai/core";
import { triageWorkflow } from "@sweny-ai/core/workflows";

export type StudioMode = "design" | "simulate" | "live";

export interface ExecutionSlice {
  mode: StudioMode;
  // Which node is currently executing (entered but not yet exited)
  currentNodeId: string | null;
  // Results of nodes that have completed
  completedNodes: Record<string, NodeResult>;
  // Overall workflow status
  executionStatus: "idle" | "running" | "completed" | "failed" | "partial";
  // For live mode: connection info
  liveConnection: {
    url: string;
    transport: "websocket" | "sse";
    status: "disconnected" | "connecting" | "connected" | "error";
    error?: string;
  } | null;

  // Actions
  setMode(mode: StudioMode): void;
  applyEvent(event: ExecutionEvent): void;
  resetExecution(): void;
  setLiveConnection(conn: ExecutionSlice["liveConnection"]): void;
}

// What the user has selected on the canvas
export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string; edgeIndex: number; from: string; to: string }
  | null;

export interface EditorState extends ExecutionSlice {
  workflow: Workflow;
  selection: Selection;
  isLayoutStale: boolean; // true when structure changed and ELK needs to re-run

  // Setters
  setWorkflow(wf: Workflow): void;
  setSelection(sel: Selection): void;

  // Workflow meta mutations
  updateWorkflowMeta(patch: Partial<Pick<Workflow, "name" | "description">>): void;
  setEntry(id: string): void;

  // Node mutations (all affect `workflow`)
  addNode(id: string): void;
  deleteNode(id: string): void;
  updateNode(id: string, patch: Partial<Node>): void;
  /** Rename a node ID and cascade all references. Returns an error string on failure, null on success. */
  renameNode(oldId: string, newId: string): string | null;
  /** Clone a node with a unique ID suffix. Returns the new node's ID. */
  duplicateNode(id: string): string | null;
  /** Remove all edges connected to a node (both incoming and outgoing). */
  disconnectNode(id: string): void;

  // Edge mutations
  addEdge(from: string, to: string, when?: string): void;
  updateEdge(edgeIndex: number, patch: { when?: string; to?: string; max_iterations?: number }): void;
  deleteEdge(edgeIndex: number): void;

  markLayoutFresh(): void;
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      workflow: triageWorkflow,
      selection: null,
      isLayoutStale: false,

      // ExecutionSlice initial state
      mode: "design" as StudioMode,
      currentNodeId: null,
      completedNodes: {},
      executionStatus: "idle" as const,
      liveConnection: null,

      setMode: (mode: StudioMode) =>
        set(
          produce((s: EditorState) => {
            s.mode = mode;
          }),
        ),

      applyEvent: (event: ExecutionEvent) =>
        set(
          produce((s: EditorState) => {
            if (event.type === "workflow:start") {
              s.currentNodeId = null;
              s.completedNodes = {};
              s.executionStatus = "running";
            }
            if (event.type === "node:enter") {
              s.currentNodeId = event.node;
            }
            if (event.type === "node:exit") {
              s.currentNodeId = null;
              s.completedNodes[event.node] = event.result;
            }
            if (event.type === "workflow:end") {
              s.currentNodeId = null;
              const results = event.results;
              const anyFailed = Object.values(results).some((r) => r.status === "failed");
              s.executionStatus = anyFailed ? "failed" : "completed";
            }
          }),
        ),

      resetExecution: () =>
        set(
          produce((s: EditorState) => {
            s.currentNodeId = null;
            s.completedNodes = {};
            s.executionStatus = "idle";
            s.liveConnection = null;
          }),
        ),

      setLiveConnection: (conn: ExecutionSlice["liveConnection"]) =>
        set(
          produce((s: EditorState) => {
            s.liveConnection = conn;
          }),
        ),

      setWorkflow: (wf: Workflow) =>
        set(
          produce((s: EditorState) => {
            s.workflow = wf;
            s.isLayoutStale = true;
          }),
        ),

      setSelection: (sel: Selection) =>
        set(
          produce((s: EditorState) => {
            s.selection = sel;
          }),
        ),

      markLayoutFresh: () =>
        set(
          produce((s: EditorState) => {
            s.isLayoutStale = false;
          }),
        ),

      updateWorkflowMeta: (patch: Partial<Pick<Workflow, "name" | "description">>) =>
        set(
          produce((s: EditorState) => {
            if (patch.name !== undefined) s.workflow.name = patch.name;
            if (patch.description !== undefined) s.workflow.description = patch.description;
          }),
        ),

      setEntry: (id: string) =>
        set(
          produce((s: EditorState) => {
            s.workflow.entry = id;
            s.isLayoutStale = true;
          }),
        ),

      addNode: (id: string) =>
        set(
          produce((s: EditorState) => {
            if (!id || s.workflow.nodes[id]) return;
            s.workflow.nodes[id] = {
              name: id,
              instruction: "",
              skills: [],
            };
            s.isLayoutStale = true;
          }),
        ),

      deleteNode: (id: string) =>
        set(
          produce((s: EditorState) => {
            delete s.workflow.nodes[id];
            // Remove edges that reference this node
            s.workflow.edges = s.workflow.edges.filter((e) => e.from !== id && e.to !== id);
            // Fix entry if needed
            if (s.workflow.entry === id) {
              const remaining = Object.keys(s.workflow.nodes);
              s.workflow.entry = remaining[0] ?? "";
            }
            // Clear selection if this node was selected
            if (s.selection?.kind === "node" && s.selection.id === id) {
              s.selection = null;
            }
            s.isLayoutStale = true;
          }),
        ),

      updateNode: (id: string, patch: Partial<Node>) =>
        set(
          produce((s: EditorState) => {
            const node = s.workflow.nodes[id];
            if (!node) return;
            if (patch.name !== undefined) node.name = patch.name;
            if (patch.instruction !== undefined) node.instruction = patch.instruction;
            if (patch.skills !== undefined) node.skills = patch.skills;
            if (patch.output !== undefined) node.output = patch.output;
          }),
        ),

      duplicateNode: (id: string): string | null => {
        const state = get();
        const node = state.workflow.nodes[id];
        if (!node) return null;
        const existing = new Set(Object.keys(state.workflow.nodes));
        let newId = `${id}_copy`;
        let counter = 1;
        while (existing.has(newId)) {
          newId = `${id}_copy_${counter++}`;
        }
        set(
          produce((s: EditorState) => {
            s.workflow.nodes[newId] = {
              name: `${node.name} (copy)`,
              instruction: node.instruction,
              skills: [...node.skills],
              ...(node.output ? { output: structuredClone(node.output) } : {}),
            };
            s.isLayoutStale = true;
          }),
        );
        return newId;
      },

      disconnectNode: (id: string) =>
        set(
          produce((s: EditorState) => {
            const before = s.workflow.edges.length;
            s.workflow.edges = s.workflow.edges.filter((e) => e.from !== id && e.to !== id);
            if (s.workflow.edges.length !== before) {
              s.isLayoutStale = true;
            }
          }),
        ),

      renameNode: (oldId: string, newId: string): string | null => {
        const trimmed = newId.trim();
        if (!trimmed) return "Node ID cannot be empty";
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
          return "Node IDs may only contain letters, digits, hyphens, and underscores";
        }
        if (trimmed === oldId) return null;
        const state = get();
        if (state.workflow.nodes[trimmed]) {
          return `A node with ID "${trimmed}" already exists`;
        }
        if (!state.workflow.nodes[oldId]) {
          return `Node "${oldId}" does not exist`;
        }
        set(
          produce((s: EditorState) => {
            const node = s.workflow.nodes[oldId];
            s.workflow.nodes[trimmed] = node;
            delete s.workflow.nodes[oldId];
            if (s.workflow.entry === oldId) s.workflow.entry = trimmed;
            // Update edges
            for (const edge of s.workflow.edges) {
              if (edge.from === oldId) edge.from = trimmed;
              if (edge.to === oldId) edge.to = trimmed;
            }
            if (s.selection?.kind === "node" && s.selection.id === oldId) {
              s.selection = { kind: "node", id: trimmed };
            }
            s.isLayoutStale = true;
          }),
        );
        return null;
      },

      addEdge: (from: string, to: string, when?: string) =>
        set(
          produce((s: EditorState) => {
            // Block duplicate unconditional edges between the same pair.
            // Multiple conditional edges (different `when`) are allowed.
            if (!when) {
              const exists = s.workflow.edges.some((e) => e.from === from && e.to === to && !e.when);
              if (exists) return;
            }
            const edge: Edge = { from, to };
            if (when) edge.when = when;
            s.workflow.edges.push(edge);
            s.isLayoutStale = true;
          }),
        ),

      updateEdge: (edgeIndex: number, patch: { when?: string; to?: string; max_iterations?: number }) =>
        set(
          produce((s: EditorState) => {
            const edge = s.workflow.edges[edgeIndex];
            if (!edge) return;
            if (patch.when !== undefined) {
              if (patch.when) {
                edge.when = patch.when;
              } else {
                delete edge.when;
              }
            }
            if (patch.max_iterations !== undefined) {
              if (patch.max_iterations > 0) {
                edge.max_iterations = patch.max_iterations;
              } else {
                delete edge.max_iterations;
              }
            }
            if (patch.to !== undefined) {
              edge.to = patch.to;
              s.isLayoutStale = true;
            }
          }),
        ),

      deleteEdge: (edgeIndex: number) =>
        set(
          produce((s: EditorState) => {
            if (edgeIndex >= 0 && edgeIndex < s.workflow.edges.length) {
              s.workflow.edges.splice(edgeIndex, 1);
            }
            if (s.selection?.kind === "edge" && s.selection.edgeIndex === edgeIndex) {
              s.selection = null;
            }
            s.isLayoutStale = true;
          }),
        ),
    }),
    {
      // Only track `workflow` in undo history — not selection or isLayoutStale
      partialize: (state) => ({ workflow: state.workflow }),
    },
  ),
);

// Expose the temporal API for undo/redo
export const useTemporalStore = () => useEditorStore.temporal;
