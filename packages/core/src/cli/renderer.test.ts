import { describe, it, expect, beforeEach } from "vitest";
import { DagRenderer } from "./renderer.js";
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
});
