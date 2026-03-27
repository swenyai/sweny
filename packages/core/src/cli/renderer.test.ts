import { describe, it, expect, beforeEach } from "vitest";
import { DagRenderer, stripAnsi } from "./renderer.js";
import type { Workflow, ExecutionEvent } from "../types.js";

const testWorkflow: Workflow = {
  id: "test",
  name: "Test Workflow",
  description: "A simple test workflow",
  nodes: {
    gather: { name: "Gather Context", instruction: "Gather", skills: [] },
    investigate: { name: "Investigate", instruction: "Investigate", skills: [] },
    report: { name: "Report", instruction: "Report", skills: [] },
  },
  edges: [
    { from: "gather", to: "investigate" },
    { from: "investigate", to: "report" },
  ],
  entry: "gather",
};

describe("DagRenderer", () => {
  let renderer: DagRenderer;

  beforeEach(() => {
    renderer = new DagRenderer(testWorkflow, { animate: false });
  });

  it("starts all nodes in pending state", () => {
    expect(renderer.getNodeState("gather")).toBe("pending");
    expect(renderer.getNodeState("investigate")).toBe("pending");
    expect(renderer.getNodeState("report")).toBe("pending");
  });

  it("tracks node state: pending → running on node:enter", () => {
    const event: ExecutionEvent = { type: "node:enter", node: "gather", instruction: "Gather" };
    renderer.update(event);
    expect(renderer.getNodeState("gather")).toBe("running");
    expect(renderer.getNodeState("investigate")).toBe("pending");
  });

  it("tracks node state: running → completed on node:exit success", () => {
    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    renderer.update({
      type: "node:exit",
      node: "gather",
      result: { status: "success", data: {}, toolCalls: [] },
    });
    expect(renderer.getNodeState("gather")).toBe("completed");
  });

  it("tracks node state: running → failed on node:exit failed", () => {
    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    renderer.update({
      type: "node:exit",
      node: "gather",
      result: { status: "failed", data: {}, toolCalls: [] },
    });
    expect(renderer.getNodeState("gather")).toBe("failed");
  });

  it("tracks failed nodes", () => {
    renderer.update({ type: "node:enter", node: "investigate", instruction: "Investigate" });
    renderer.update({
      type: "node:exit",
      node: "investigate",
      result: { status: "failed", data: { error: "timeout" }, toolCalls: [] },
    });
    expect(renderer.getNodeState("investigate")).toBe("failed");
  });

  it("counts tool calls per node", () => {
    expect(renderer.getToolCallCount("gather")).toBe(0);

    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    renderer.update({ type: "tool:call", node: "gather", tool: "search", input: {} });
    renderer.update({ type: "tool:call", node: "gather", tool: "fetch", input: {} });

    expect(renderer.getToolCallCount("gather")).toBe(2);
    expect(renderer.getToolCallCount("investigate")).toBe(0);
  });

  it("counts tool calls across multiple nodes independently", () => {
    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    renderer.update({ type: "tool:call", node: "gather", tool: "search", input: {} });
    renderer.update({ type: "node:exit", node: "gather", result: { status: "success", data: {}, toolCalls: [] } });

    renderer.update({ type: "node:enter", node: "investigate", instruction: "Investigate" });
    renderer.update({ type: "tool:call", node: "investigate", tool: "read", input: {} });
    renderer.update({ type: "tool:call", node: "investigate", tool: "write", input: {} });
    renderer.update({ type: "tool:call", node: "investigate", tool: "run", input: {} });

    expect(renderer.getToolCallCount("gather")).toBe(1);
    expect(renderer.getToolCallCount("investigate")).toBe(3);
  });

  it("renders to string without crashing", () => {
    const output = renderer.renderToString();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("output contains all node names", () => {
    const output = renderer.renderToString();
    expect(output).toContain("Gather Context");
    expect(output).toContain("Investigate");
    expect(output).toContain("Report");
  });

  it("topological order starts from entry node", () => {
    const output = renderer.renderToString();
    const gatherIdx = output.indexOf("Gather Context");
    const investigateIdx = output.indexOf("Investigate");
    const reportIdx = output.indexOf("Report");

    expect(gatherIdx).toBeLessThan(investigateIdx);
    expect(investigateIdx).toBeLessThan(reportIdx);
  });

  it("shows running status icon for active node", () => {
    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    const output = renderer.renderToString();
    // ◉ is the running icon
    expect(output).toContain("◉");
  });

  it("shows completed status icon for finished node", () => {
    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    renderer.update({
      type: "node:exit",
      node: "gather",
      result: { status: "success", data: {}, toolCalls: [] },
    });
    const output = renderer.renderToString();
    // ● is the completed icon
    expect(output).toContain("●");
  });

  it("shows failed status icon for failed node", () => {
    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    renderer.update({
      type: "node:exit",
      node: "gather",
      result: { status: "failed", data: {}, toolCalls: [] },
    });
    const output = renderer.renderToString();
    // ✕ is the failed icon
    expect(output).toContain("✕");
  });

  it("returns pending state for unknown node id", () => {
    expect(renderer.getNodeState("nonexistent")).toBe("pending");
  });

  it("returns 0 tool calls for unknown node id", () => {
    expect(renderer.getToolCallCount("nonexistent")).toBe(0);
  });

  it("includes a legend in the output", () => {
    const output = renderer.renderToString();
    // Legend should mention at least pending and completed
    expect(output).toContain("○");
    expect(output).toContain("●");
  });

  it("handles workflow:start event without crashing", () => {
    const event: ExecutionEvent = { type: "workflow:start", workflow: "test" };
    expect(() => renderer.update(event)).not.toThrow();
  });

  it("handles workflow:end event without crashing", () => {
    const event: ExecutionEvent = {
      type: "workflow:end",
      results: {
        gather: { status: "success", data: {}, toolCalls: [] },
      },
    };
    expect(() => renderer.update(event)).not.toThrow();
  });

  it("handles route event without crashing", () => {
    const event: ExecutionEvent = { type: "route", from: "gather", to: "investigate", reason: "next" };
    expect(() => renderer.update(event)).not.toThrow();
  });

  describe("uniform box widths", () => {
    const mixedWidthWorkflow: Workflow = {
      id: "mixed",
      name: "Mixed Width Workflow",
      description: "Nodes with varying name lengths",
      nodes: {
        a: { name: "A", instruction: "Short", skills: [] },
        b: { name: "Gather Context and Analyze", instruction: "Long name", skills: [] },
        c: { name: "Report", instruction: "Medium", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      entry: "a",
    };

    it("all top-border lines have the same width", () => {
      const r = new DagRenderer(mixedWidthWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      const topLines = output.split("\n").filter((l) => l.includes("┌") && l.includes("┐"));
      expect(topLines.length).toBe(3);
      const widths = topLines.map((l) => l.trim().length);
      expect(new Set(widths).size).toBe(1); // all same width
    });

    it("output contains ▼ arrowhead on non-first boxes", () => {
      const r = new DagRenderer(mixedWidthWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      expect(output).toContain("▼");
    });

    it("▼ is positioned between box borders", () => {
      const r = new DagRenderer(mixedWidthWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      const arrowLines = output.split("\n").filter((l) => l.includes("▼"));
      for (const line of arrowLines) {
        // ▼ should be inside a top border: ┌───▼───┐
        expect(line).toMatch(/┌─*▼─*┐/);
      }
    });

    it("bottom of non-terminal boxes has centered ┬", () => {
      const r = new DagRenderer(mixedWidthWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      const bottomLinesWithT = output.split("\n").filter((l) => l.includes("┬"));
      // A and B are non-terminal, so 2 lines with ┬
      expect(bottomLinesWithT.length).toBe(2);
      for (const line of bottomLinesWithT) {
        expect(line).toMatch(/└─*┬─*┘/);
      }
    });

    it("vertical connector uses centered │", () => {
      const r = new DagRenderer(mixedWidthWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      // Find lines that are purely vertical connectors (between boxes)
      const lines = output.split("\n");
      const connectorLines = lines.filter((l) => l.trim() === "│");
      expect(connectorLines.length).toBeGreaterThan(0);
      // The │ should be centered relative to the box width
      const topLine = lines.find((l) => l.includes("┌") && l.includes("┐"))!;
      const tIdx = topLine.indexOf("┌");
      const boxWidth = topLine.lastIndexOf("┐") - tIdx + 1;
      const expectedCol = tIdx + Math.floor(boxWidth / 2);
      for (const cl of connectorLines) {
        expect(cl.indexOf("│")).toBe(expectedCol);
      }
    });
  });

  describe("branching layout", () => {
    const branchingWorkflow: Workflow = {
      id: "triage",
      name: "Triage Test",
      description: "A branching workflow",
      nodes: {
        gather: { name: "Gather Context", instruction: "Gather", skills: [] },
        investigate: { name: "Investigate", instruction: "Investigate", skills: [] },
        create_ticket: { name: "Create Ticket", instruction: "Create", skills: [] },
        skip: { name: "Skip", instruction: "Skip", skills: [] },
        notify: { name: "Notify", instruction: "Notify", skills: [] },
      },
      edges: [
        { from: "gather", to: "investigate" },
        { from: "investigate", to: "create_ticket" },
        { from: "investigate", to: "skip" },
        { from: "create_ticket", to: "notify" },
      ],
      entry: "gather",
    };

    it("output contains both branch children", () => {
      const r = new DagRenderer(branchingWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      expect(output).toContain("Create Ticket");
      expect(output).toContain("Skip");
    });

    it("output contains ┴ fork character", () => {
      const r = new DagRenderer(branchingWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      expect(output).toContain("┴");
    });

    it("state tracking works through branches", () => {
      const r = new DagRenderer(branchingWorkflow, { animate: false });
      r.update({ type: "node:enter", node: "gather", instruction: "Gather" });
      r.update({ type: "node:exit", node: "gather", result: { status: "success", data: {}, toolCalls: [] } });
      r.update({ type: "node:enter", node: "investigate", instruction: "Investigate" });
      r.update({ type: "node:exit", node: "investigate", result: { status: "success", data: {}, toolCalls: [] } });
      r.update({ type: "node:enter", node: "create_ticket", instruction: "Create" });

      expect(r.getNodeState("gather")).toBe("completed");
      expect(r.getNodeState("investigate")).toBe("completed");
      expect(r.getNodeState("create_ticket")).toBe("running");
      expect(r.getNodeState("skip")).toBe("pending");
      expect(r.getNodeState("notify")).toBe("pending");
    });

    it("topological order: Gather before Investigate before Notify", () => {
      const r = new DagRenderer(branchingWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      const gatherIdx = output.indexOf("Gather Context");
      const investigateIdx = output.indexOf("Investigate");
      const notifyIdx = output.indexOf("Notify");
      expect(gatherIdx).toBeLessThan(investigateIdx);
      expect(investigateIdx).toBeLessThan(notifyIdx);
    });

    it("falls back to sequential for 3+ children", () => {
      const tripleWorkflow: Workflow = {
        id: "triple",
        name: "Triple Branch",
        description: "Three-way branch",
        nodes: {
          start: { name: "Start", instruction: "Start", skills: [] },
          a: { name: "Branch A", instruction: "A", skills: [] },
          b: { name: "Branch B", instruction: "B", skills: [] },
          c: { name: "Branch C", instruction: "C", skills: [] },
        },
        edges: [
          { from: "start", to: "a" },
          { from: "start", to: "b" },
          { from: "start", to: "c" },
        ],
        entry: "start",
      };
      const r = new DagRenderer(tripleWorkflow, { animate: false });
      const output = stripAnsi(r.renderToString());
      // Should NOT have ┴ fork — sequential fallback
      expect(output).not.toContain("┴");
      // But all branches are present
      expect(output).toContain("Branch A");
      expect(output).toContain("Branch B");
      expect(output).toContain("Branch C");
    });
  });
});
