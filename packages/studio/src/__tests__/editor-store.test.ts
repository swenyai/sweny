import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../store/editor-store";
import type { Workflow } from "@sweny-ai/core";

// ── Test fixtures ────────────────────────────────────────────────────────────

const testWorkflow: Workflow = {
  id: "test",
  name: "Test Workflow",
  description: "A test workflow for editor store tests",
  entry: "step-a",
  nodes: {
    "step-a": { name: "Step A", instruction: "Do A", skills: ["github"] },
    "step-b": { name: "Step B", instruction: "Do B", skills: ["slack"] },
    "step-c": { name: "Step C", instruction: "Do C", skills: [] },
  },
  edges: [
    { from: "step-a", to: "step-b" },
    { from: "step-b", to: "step-c", when: "success" },
  ],
};

function resetStore() {
  const store = useEditorStore.getState();
  store.setWorkflow(testWorkflow);
  store.setSelection(null);
  store.markLayoutFresh();
  store.resetExecution();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("editor-store", () => {
  beforeEach(resetStore);

  // ── setWorkflow ─────────────────────────────────────────────────────────

  describe("setWorkflow", () => {
    it("replaces the workflow and marks layout stale", () => {
      const newWf: Workflow = { ...testWorkflow, id: "new", name: "New" };
      useEditorStore.getState().setWorkflow(newWf);
      const state = useEditorStore.getState();
      expect(state.workflow.id).toBe("new");
      expect(state.isLayoutStale).toBe(true);
    });
  });

  // ── Node mutations ──────────────────────────────────────────────────────

  describe("addNode", () => {
    it("adds a new node and marks layout stale", () => {
      useEditorStore.getState().addNode("step-d");
      const state = useEditorStore.getState();
      expect(state.workflow.nodes["step-d"]).toBeDefined();
      expect(state.workflow.nodes["step-d"].name).toBe("step-d");
      expect(state.workflow.nodes["step-d"].instruction).toBe("");
      expect(state.workflow.nodes["step-d"].skills).toEqual([]);
      expect(state.isLayoutStale).toBe(true);
    });

    it("does not add a duplicate node", () => {
      useEditorStore.getState().addNode("step-a");
      const state = useEditorStore.getState();
      // Should still have original node data
      expect(state.workflow.nodes["step-a"].instruction).toBe("Do A");
    });

    it("does not add a node with empty id", () => {
      const before = Object.keys(useEditorStore.getState().workflow.nodes).length;
      useEditorStore.getState().addNode("");
      const after = Object.keys(useEditorStore.getState().workflow.nodes).length;
      expect(after).toBe(before);
    });
  });

  describe("deleteNode", () => {
    it("removes node and cleans up edges", () => {
      useEditorStore.getState().deleteNode("step-b");
      const state = useEditorStore.getState();
      expect(state.workflow.nodes["step-b"]).toBeUndefined();
      // Edges referencing step-b should be removed
      const edgesWithB = state.workflow.edges.filter((e) => e.from === "step-b" || e.to === "step-b");
      expect(edgesWithB).toHaveLength(0);
      expect(state.isLayoutStale).toBe(true);
    });

    it("updates entry when entry node is deleted", () => {
      useEditorStore.getState().deleteNode("step-a");
      const state = useEditorStore.getState();
      expect(state.workflow.entry).not.toBe("step-a");
      // Should be set to first remaining node
      expect(Object.keys(state.workflow.nodes)).toContain(state.workflow.entry);
    });

    it("clears selection if deleted node was selected", () => {
      useEditorStore.getState().setSelection({ kind: "node", id: "step-b" });
      useEditorStore.getState().deleteNode("step-b");
      expect(useEditorStore.getState().selection).toBeNull();
    });

    it("preserves selection if different node was deleted", () => {
      useEditorStore.getState().setSelection({ kind: "node", id: "step-a" });
      useEditorStore.getState().deleteNode("step-c");
      expect(useEditorStore.getState().selection).toEqual({ kind: "node", id: "step-a" });
    });
  });

  describe("updateNode", () => {
    it("updates node properties", () => {
      useEditorStore.getState().updateNode("step-a", { name: "Updated A", instruction: "New instruction" });
      const node = useEditorStore.getState().workflow.nodes["step-a"];
      expect(node.name).toBe("Updated A");
      expect(node.instruction).toBe("New instruction");
    });

    it("updates skills array", () => {
      useEditorStore.getState().updateNode("step-a", { skills: ["github", "slack"] });
      expect(useEditorStore.getState().workflow.nodes["step-a"].skills).toEqual(["github", "slack"]);
    });

    it("no-ops for nonexistent node", () => {
      // Should not throw
      useEditorStore.getState().updateNode("nonexistent", { name: "X" });
    });
  });

  describe("renameNode", () => {
    it("renames node and updates edges", () => {
      const err = useEditorStore.getState().renameNode("step-a", "renamed-a");
      expect(err).toBeNull();
      const state = useEditorStore.getState();
      expect(state.workflow.nodes["renamed-a"]).toBeDefined();
      expect(state.workflow.nodes["step-a"]).toBeUndefined();
      // Edge should be updated
      const edge = state.workflow.edges.find((e) => e.from === "renamed-a");
      expect(edge).toBeDefined();
      expect(state.isLayoutStale).toBe(true);
    });

    it("updates entry when renamed node is entry", () => {
      useEditorStore.getState().renameNode("step-a", "new-entry");
      expect(useEditorStore.getState().workflow.entry).toBe("new-entry");
    });

    it("returns error for empty ID", () => {
      const err = useEditorStore.getState().renameNode("step-a", "  ");
      expect(err).toBe("Node ID cannot be empty");
    });

    it("returns error for invalid characters", () => {
      const err = useEditorStore.getState().renameNode("step-a", "has spaces");
      expect(err).toContain("letters, digits, hyphens, and underscores");
    });

    it("returns error for duplicate ID", () => {
      const err = useEditorStore.getState().renameNode("step-a", "step-b");
      expect(err).toContain("already exists");
    });

    it("no-ops for same name", () => {
      const err = useEditorStore.getState().renameNode("step-a", "step-a");
      expect(err).toBeNull();
    });

    it("updates selection when renamed node was selected", () => {
      useEditorStore.getState().setSelection({ kind: "node", id: "step-a" });
      useEditorStore.getState().renameNode("step-a", "new-a");
      expect(useEditorStore.getState().selection).toEqual({ kind: "node", id: "new-a" });
    });
  });

  // ── Edge mutations ──────────────────────────────────────────────────────

  describe("addEdge", () => {
    it("adds a new edge and marks layout stale", () => {
      useEditorStore.getState().addEdge("step-a", "step-c");
      const state = useEditorStore.getState();
      const newEdge = state.workflow.edges.find((e) => e.from === "step-a" && e.to === "step-c");
      expect(newEdge).toBeDefined();
      expect(state.isLayoutStale).toBe(true);
    });

    it("adds conditional edge with when clause", () => {
      useEditorStore.getState().addEdge("step-a", "step-c", "on error");
      const edge = useEditorStore.getState().workflow.edges.find((e) => e.from === "step-a" && e.to === "step-c");
      expect(edge?.when).toBe("on error");
    });

    it("blocks duplicate unconditional edge between same pair", () => {
      const before = useEditorStore.getState().workflow.edges.length;
      useEditorStore.getState().addEdge("step-a", "step-b"); // already exists unconditional
      expect(useEditorStore.getState().workflow.edges.length).toBe(before);
    });

    it("allows conditional edge alongside existing unconditional edge", () => {
      const before = useEditorStore.getState().workflow.edges.length;
      useEditorStore.getState().addEdge("step-a", "step-b", "on error");
      expect(useEditorStore.getState().workflow.edges.length).toBe(before + 1);
      const newEdge = useEditorStore.getState().workflow.edges.at(-1);
      expect(newEdge?.when).toBe("on error");
    });

    it("allows multiple conditional edges between same pair", () => {
      useEditorStore.getState().addEdge("step-a", "step-b", "on error");
      useEditorStore.getState().addEdge("step-a", "step-b", "on timeout");
      const abEdges = useEditorStore.getState().workflow.edges.filter((e) => e.from === "step-a" && e.to === "step-b");
      // Original unconditional + 2 conditional = 3
      expect(abEdges).toHaveLength(3);
    });
  });

  describe("updateEdge", () => {
    // Test workflow edges: [0] step-a→step-b, [1] step-b→step-c (when: "success")

    it("updates the when condition", () => {
      useEditorStore.getState().updateEdge(1, { when: "on failure" });
      const edge = useEditorStore.getState().workflow.edges[1];
      expect(edge.when).toBe("on failure");
    });

    it("removes when condition when set to empty string", () => {
      useEditorStore.getState().updateEdge(1, { when: "" });
      const edge = useEditorStore.getState().workflow.edges[1];
      expect(edge.when).toBeUndefined();
    });

    it("does NOT mark layout stale when only when changes", () => {
      useEditorStore.getState().updateEdge(1, { when: "new condition" });
      expect(useEditorStore.getState().isLayoutStale).toBe(false);
    });

    it("marks layout stale when to changes", () => {
      useEditorStore.getState().updateEdge(0, { to: "step-c" });
      const state = useEditorStore.getState();
      expect(state.workflow.edges[0].to).toBe("step-c");
      expect(state.isLayoutStale).toBe(true);
    });

    it("no-ops for out-of-bounds index", () => {
      const before = JSON.stringify(useEditorStore.getState().workflow.edges);
      useEditorStore.getState().updateEdge(999, { when: "whatever" });
      expect(JSON.stringify(useEditorStore.getState().workflow.edges)).toBe(before);
    });

    it("sets max_iterations", () => {
      useEditorStore.getState().updateEdge(1, { max_iterations: 3 });
      expect(useEditorStore.getState().workflow.edges[1].max_iterations).toBe(3);
    });

    it("removes max_iterations when set to 0", () => {
      useEditorStore.getState().updateEdge(1, { max_iterations: 3 });
      useEditorStore.getState().updateEdge(1, { max_iterations: 0 });
      expect(useEditorStore.getState().workflow.edges[1].max_iterations).toBeUndefined();
    });
  });

  describe("deleteEdge", () => {
    it("removes edge by index and marks layout stale", () => {
      useEditorStore.getState().deleteEdge(0);
      const state = useEditorStore.getState();
      // Only one edge should remain (the step-b→step-c one)
      expect(state.workflow.edges).toHaveLength(1);
      expect(state.workflow.edges[0].from).toBe("step-b");
      expect(state.isLayoutStale).toBe(true);
    });

    it("clears selection if deleted edge was selected", () => {
      useEditorStore
        .getState()
        .setSelection({ kind: "edge", id: "edge-0", edgeIndex: 0, from: "step-a", to: "step-b" });
      useEditorStore.getState().deleteEdge(0);
      expect(useEditorStore.getState().selection).toBeNull();
    });

    it("no-ops for out-of-bounds index", () => {
      const before = useEditorStore.getState().workflow.edges.length;
      useEditorStore.getState().deleteEdge(999);
      expect(useEditorStore.getState().workflow.edges).toHaveLength(before);
    });
  });

  // ── Layout state ────────────────────────────────────────────────────────

  describe("markLayoutFresh", () => {
    it("clears the isLayoutStale flag", () => {
      useEditorStore.getState().addNode("temp");
      expect(useEditorStore.getState().isLayoutStale).toBe(true);
      useEditorStore.getState().markLayoutFresh();
      expect(useEditorStore.getState().isLayoutStale).toBe(false);
    });
  });

  // ── Workflow meta ───────────────────────────────────────────────────────

  describe("updateWorkflowMeta", () => {
    it("updates name only", () => {
      useEditorStore.getState().updateWorkflowMeta({ name: "New Name" });
      expect(useEditorStore.getState().workflow.name).toBe("New Name");
      expect(useEditorStore.getState().workflow.description).toBe("A test workflow for editor store tests");
    });

    it("updates description only", () => {
      useEditorStore.getState().updateWorkflowMeta({ description: "New desc" });
      expect(useEditorStore.getState().workflow.description).toBe("New desc");
    });
  });

  describe("setEntry", () => {
    it("updates the entry node", () => {
      useEditorStore.getState().setEntry("step-b");
      expect(useEditorStore.getState().workflow.entry).toBe("step-b");
    });
  });

  // ── Execution slice ─────────────────────────────────────────────────────

  describe("execution state", () => {
    it("starts in idle state", () => {
      const state = useEditorStore.getState();
      expect(state.executionStatus).toBe("idle");
      expect(state.currentNodeId).toBeNull();
      expect(state.completedNodes).toEqual({});
    });

    it("workflow:start resets and sets running", () => {
      useEditorStore.getState().applyEvent({ type: "workflow:start", workflow: "test" });
      const state = useEditorStore.getState();
      expect(state.executionStatus).toBe("running");
      expect(state.currentNodeId).toBeNull();
    });

    it("node:enter sets currentNodeId", () => {
      useEditorStore.getState().applyEvent({ type: "workflow:start", workflow: "test" });
      useEditorStore.getState().applyEvent({ type: "node:enter", node: "step-a", instruction: "Do A" });
      expect(useEditorStore.getState().currentNodeId).toBe("step-a");
    });

    it("node:exit clears currentNodeId and records result", () => {
      useEditorStore.getState().applyEvent({ type: "workflow:start", workflow: "test" });
      useEditorStore.getState().applyEvent({ type: "node:enter", node: "step-a", instruction: "Do A" });
      useEditorStore.getState().applyEvent({
        type: "node:exit",
        node: "step-a",
        result: { status: "success", data: { answer: 42 }, toolCalls: [] },
      });
      const state = useEditorStore.getState();
      expect(state.currentNodeId).toBeNull();
      expect(state.completedNodes["step-a"]).toBeDefined();
      expect(state.completedNodes["step-a"].status).toBe("success");
    });

    it("workflow:end marks completed when all succeed", () => {
      useEditorStore.getState().applyEvent({ type: "workflow:start", workflow: "test" });
      useEditorStore.getState().applyEvent({
        type: "workflow:end",
        results: {
          "step-a": { status: "success", data: {}, toolCalls: [] },
          "step-b": { status: "success", data: {}, toolCalls: [] },
        },
      });
      expect(useEditorStore.getState().executionStatus).toBe("completed");
    });

    it("workflow:end marks failed when any node failed", () => {
      useEditorStore.getState().applyEvent({ type: "workflow:start", workflow: "test" });
      useEditorStore.getState().applyEvent({
        type: "workflow:end",
        results: {
          "step-a": { status: "success", data: {}, toolCalls: [] },
          "step-b": { status: "failed", data: {}, toolCalls: [] },
        },
      });
      expect(useEditorStore.getState().executionStatus).toBe("failed");
    });

    it("resetExecution returns to idle", () => {
      useEditorStore.getState().applyEvent({ type: "workflow:start", workflow: "test" });
      useEditorStore.getState().resetExecution();
      const state = useEditorStore.getState();
      expect(state.executionStatus).toBe("idle");
      expect(state.currentNodeId).toBeNull();
      expect(state.completedNodes).toEqual({});
    });
  });

  // ── Selection ───────────────────────────────────────────────────────────

  describe("setSelection", () => {
    it("sets node selection", () => {
      useEditorStore.getState().setSelection({ kind: "node", id: "step-a" });
      expect(useEditorStore.getState().selection).toEqual({ kind: "node", id: "step-a" });
    });

    it("sets edge selection", () => {
      useEditorStore
        .getState()
        .setSelection({ kind: "edge", id: "edge-0", edgeIndex: 0, from: "step-a", to: "step-b" });
      const sel = useEditorStore.getState().selection;
      expect(sel?.kind).toBe("edge");
      if (sel?.kind === "edge") {
        expect(sel.edgeIndex).toBe(0);
      }
    });

    it("clears selection with null", () => {
      useEditorStore.getState().setSelection({ kind: "node", id: "step-a" });
      useEditorStore.getState().setSelection(null);
      expect(useEditorStore.getState().selection).toBeNull();
    });
  });
});
