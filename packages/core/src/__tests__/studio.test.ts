import { describe, it, expect } from "vitest";
import { workflowToFlow, flowToWorkflow, applyExecutionEvent, exportAsTypescript, getSkillCatalog } from "../studio.js";
import type { Workflow, ExecutionEvent, NodeResult } from "../types.js";
import type { SkillNodeData } from "../studio.js";

const testWorkflow: Workflow = {
  id: "test-studio",
  name: "Studio Test",
  description: "A→B, A→C",
  entry: "a",
  nodes: {
    a: { name: "Node A", instruction: "Do A", skills: ["github"] },
    b: { name: "Node B", instruction: "Do B", skills: [] },
    c: { name: "Node C", instruction: "Do C", skills: ["slack"] },
  },
  edges: [
    { from: "a", to: "b" },
    { from: "a", to: "c", when: "needs notification" },
  ],
};

describe("workflowToFlow", () => {
  it("converts nodes to FlowNodes", () => {
    const { nodes } = workflowToFlow(testWorkflow);
    expect(nodes).toHaveLength(3);
    const nodeA = nodes.find((n) => n.id === "a");
    expect(nodeA?.type).toBe("skillNode");
    expect(nodeA?.data.isEntry).toBe(true);
    expect(nodeA?.data.nodeId).toBe("a");
    expect(nodeA?.data.node.name).toBe("Node A");
  });

  it("marks terminal nodes", () => {
    const { nodes } = workflowToFlow(testWorkflow);
    const nodeB = nodes.find((n) => n.id === "b");
    const nodeC = nodes.find((n) => n.id === "c");
    expect(nodeB?.data.isTerminal).toBe(true);
    expect(nodeC?.data.isTerminal).toBe(true);
    // a is not terminal (it has outgoing edges)
    const nodeA = nodes.find((n) => n.id === "a");
    expect(nodeA?.data.isTerminal).toBe(false);
  });

  it("converts edges to FlowEdges", () => {
    const { edges } = workflowToFlow(testWorkflow);
    expect(edges).toHaveLength(2);
    const unconditional = edges.find((e) => e.source === "a" && e.target === "b");
    expect(unconditional?.data.isConditional).toBe(false);
    expect(unconditional?.data.when).toBeUndefined();

    const conditional = edges.find((e) => e.source === "a" && e.target === "c");
    expect(conditional?.data.isConditional).toBe(true);
    expect(conditional?.data.when).toBe("needs notification");
  });

  it("resolves skill metadata from catalog", () => {
    const { nodes } = workflowToFlow(testWorkflow);
    const nodeA = nodes.find((n) => n.id === "a");
    expect(nodeA?.data.skills).toHaveLength(1);
    expect(nodeA?.data.skills[0].id).toBe("github");
    expect(nodeA?.data.skills[0].name).toBe("GitHub");
    expect(nodeA?.data.skills[0].toolCount).toBeGreaterThan(0);
  });

  it("handles unknown skills gracefully", () => {
    const { nodes } = workflowToFlow(testWorkflow, []); // empty catalog
    const nodeA = nodes.find((n) => n.id === "a");
    expect(nodeA?.data.skills[0].name).toBe("github"); // falls back to ID
    expect(nodeA?.data.skills[0].toolCount).toBe(0);
  });

  it("initializes all nodes as pending", () => {
    const { nodes } = workflowToFlow(testWorkflow);
    for (const node of nodes) {
      expect(node.data.exec.status).toBe("pending");
    }
  });
});

describe("flowToWorkflow", () => {
  it("round-trips correctly", () => {
    const { nodes, edges } = workflowToFlow(testWorkflow);
    const rebuilt = flowToWorkflow(
      {
        id: testWorkflow.id,
        name: testWorkflow.name,
        description: testWorkflow.description,
        entry: testWorkflow.entry,
      },
      nodes,
      edges,
    );

    expect(rebuilt.id).toBe(testWorkflow.id);
    expect(rebuilt.entry).toBe(testWorkflow.entry);
    expect(Object.keys(rebuilt.nodes)).toHaveLength(3);
    expect(rebuilt.edges).toHaveLength(2);
    expect(rebuilt.edges.find((e) => e.from === "a" && e.to === "c")?.when).toBe("needs notification");
  });

  it("omits when field for unconditional edges", () => {
    const { nodes, edges } = workflowToFlow(testWorkflow);
    const rebuilt = flowToWorkflow({ id: "x", name: "X", description: "", entry: "a" }, nodes, edges);
    const unconditional = rebuilt.edges.find((e) => e.from === "a" && e.to === "b");
    expect(unconditional).not.toHaveProperty("when");
  });
});

describe("applyExecutionEvent", () => {
  function makeNodeDataMap(): Map<string, SkillNodeData> {
    const { nodes } = workflowToFlow(testWorkflow);
    return new Map(nodes.map((n) => [n.id, n.data]));
  }

  it("resets all nodes on workflow:start", () => {
    const map = makeNodeDataMap();
    map.get("a")!.exec = { status: "success" };
    applyExecutionEvent({ type: "workflow:start", workflow: "test" } as ExecutionEvent, map);
    expect(map.get("a")!.exec.status).toBe("pending");
  });

  it("marks node as running on node:enter", () => {
    const map = makeNodeDataMap();
    applyExecutionEvent({ type: "node:enter", node: "a", instruction: "Do A" } as ExecutionEvent, map);
    expect(map.get("a")!.exec.status).toBe("running");
  });

  it("tracks current tool on tool:call", () => {
    const map = makeNodeDataMap();
    map.get("a")!.exec = { status: "running" };
    applyExecutionEvent({ type: "tool:call", node: "a", tool: "github_search_code", input: {} } as ExecutionEvent, map);
    expect(map.get("a")!.exec.currentTool).toBe("github_search_code");
  });

  it("clears current tool on tool:result", () => {
    const map = makeNodeDataMap();
    map.get("a")!.exec = { status: "running", currentTool: "github_search_code" };
    applyExecutionEvent(
      { type: "tool:result", node: "a", tool: "github_search_code", output: {} } as ExecutionEvent,
      map,
    );
    expect(map.get("a")!.exec.currentTool).toBeUndefined();
  });

  it("marks node as success on node:exit with success", () => {
    const map = makeNodeDataMap();
    const result: NodeResult = { status: "success", data: {}, toolCalls: [] };
    applyExecutionEvent({ type: "node:exit", node: "a", result } as ExecutionEvent, map);
    expect(map.get("a")!.exec.status).toBe("success");
    expect(map.get("a")!.exec.result).toBe(result);
  });

  it("marks node as failed on node:exit with failure", () => {
    const map = makeNodeDataMap();
    const result: NodeResult = { status: "failed", data: { error: "oops" }, toolCalls: [] };
    applyExecutionEvent({ type: "node:exit", node: "a", result } as ExecutionEvent, map);
    expect(map.get("a")!.exec.status).toBe("failed");
  });

  it("ignores events for unknown nodes", () => {
    const map = makeNodeDataMap();
    // Should not throw
    applyExecutionEvent({ type: "node:enter", node: "ghost", instruction: "" } as ExecutionEvent, map);
    expect(map.has("ghost")).toBe(false);
  });
});

describe("exportAsTypescript", () => {
  it("generates valid TypeScript", () => {
    const ts = exportAsTypescript(testWorkflow);
    expect(ts).toContain("import type { Workflow }");
    expect(ts).toContain("test_studio");
    expect(ts).toContain('"Studio Test"');
  });

  it("sanitizes id for variable name", () => {
    const wf: Workflow = { ...testWorkflow, id: "my-special_workflow.v2" };
    const ts = exportAsTypescript(wf);
    expect(ts).toContain("my_special_workflow_v2");
  });
});

describe("getSkillCatalog", () => {
  it("returns builtin skills", () => {
    const catalog = getSkillCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    const github = catalog.find((s) => s.id === "github");
    expect(github).toBeDefined();
    expect(github!.tools.length).toBeGreaterThan(0);
  });

  it("includes extra skills", () => {
    const extra = {
      id: "custom",
      name: "Custom",
      description: "A custom skill",
      category: "general" as const,
      config: {},
      tools: [{ name: "custom_tool", description: "Does custom", input_schema: {}, handler: async () => {} }],
    };
    const catalog = getSkillCatalog([extra]);
    expect(catalog.find((s) => s.id === "custom")).toBeDefined();
  });
});
