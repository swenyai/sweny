import { describe, it, expect } from "vitest";
import { workflowToFlow, flowToWorkflow, applyExecutionEvent, exportAsTypescript, getSkillCatalog } from "../studio.js";
import type { Workflow, ExecutionEvent, NodeResult, Skill } from "../types.js";
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

  // Defensive behavior: streaming LLM YAML (and user-authored
  // workflows) routinely arrive with fields omitted. The viewer
  // must not crash on these — it should render an empty state for
  // the missing pieces.
  describe("defensive handling of partial workflows", () => {
    it("treats a node with undefined skills as having no skills", () => {
      const partial = {
        id: "partial",
        name: "Partial",
        description: "",
        entry: "a",
        nodes: {
          // Cast to unknown→Node: we're deliberately simulating
          // what a partial YAML parse produces at runtime.
          a: { name: "A", instruction: "Do A" } as unknown as Workflow["nodes"][string],
        },
        edges: [],
      } satisfies Workflow;

      expect(() => workflowToFlow(partial)).not.toThrow();
      const { nodes } = workflowToFlow(partial);
      expect(nodes[0].data.skills).toEqual([]);
    });

    it("treats a workflow with undefined edges as having no edges", () => {
      const partial = {
        id: "partial",
        name: "Partial",
        description: "",
        entry: "a",
        nodes: {
          a: { name: "A", instruction: "Do A", skills: [] },
        },
      } as unknown as Workflow;

      expect(() => workflowToFlow(partial)).not.toThrow();
      const { nodes, edges } = workflowToFlow(partial);
      expect(edges).toEqual([]);
      // The sole node is still terminal because there are no outgoing edges.
      expect(nodes[0].data.isTerminal).toBe(true);
    });

    it("treats a workflow with undefined nodes as having no nodes", () => {
      const partial = {
        id: "partial",
        name: "Partial",
        description: "",
        entry: "a",
        edges: [],
      } as unknown as Workflow;

      expect(() => workflowToFlow(partial)).not.toThrow();
      const { nodes, edges } = workflowToFlow(partial);
      expect(nodes).toEqual([]);
      expect(edges).toEqual([]);
    });

    it("treats a skill catalog entry with missing tools as toolCount=0", () => {
      const brokenSkill = {
        id: "broken",
        name: "Broken",
        description: "No tools array",
        category: "general" as const,
        config: {},
        // tools omitted on purpose
      } as unknown as Skill;

      const wf: Workflow = {
        id: "t",
        name: "T",
        description: "",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do A", skills: ["broken"] } },
        edges: [],
      };

      expect(() => workflowToFlow(wf, [brokenSkill])).not.toThrow();
      const { nodes } = workflowToFlow(wf, [brokenSkill]);
      expect(nodes[0].data.skills[0].toolCount).toBe(0);
    });
  });
});

describe("edge IDs and edgeIndex", () => {
  it("generates unique edge IDs using array index", () => {
    const { edges } = workflowToFlow(testWorkflow);
    const ids = edges.map((e) => e.id);
    expect(ids[0]).toBe("edge-0");
    expect(ids[1]).toBe("edge-1");
    // All IDs are unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns correct edgeIndex matching array position", () => {
    const { edges } = workflowToFlow(testWorkflow);
    edges.forEach((edge, i) => {
      expect(edge.edgeIndex).toBe(i);
    });
  });

  it("produces unique IDs for multiple edges between the same node pair", () => {
    const wf: Workflow = {
      id: "multi-edge",
      name: "Multi-Edge",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "A", skills: [] },
        b: { name: "B", instruction: "B", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "b", when: "error detected" },
        { from: "a", to: "b", when: "retry needed" },
      ],
    };
    const { edges } = workflowToFlow(wf);
    expect(edges).toHaveLength(3);
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(["edge-0", "edge-1", "edge-2"]);
  });

  it("produces stable IDs across multiple conversions", () => {
    const first = workflowToFlow(testWorkflow).edges.map((e) => e.id);
    const second = workflowToFlow(testWorkflow).edges.map((e) => e.id);
    expect(first).toEqual(second);
  });
});

describe("max_iterations in conversion", () => {
  const wfWithMaxIter: Workflow = {
    id: "retry-loop",
    name: "Retry Loop",
    description: "",
    entry: "check",
    nodes: {
      check: { name: "Check", instruction: "Check it", skills: [] },
      fix: { name: "Fix", instruction: "Fix it", skills: [] },
    },
    edges: [
      { from: "check", to: "fix", when: "issue found" },
      { from: "fix", to: "check", when: "needs re-check", max_iterations: 3 },
    ],
  };

  it("includes max_iterations in flow edge data", () => {
    const { edges } = workflowToFlow(wfWithMaxIter);
    const retryEdge = edges.find((e) => e.source === "fix" && e.target === "check");
    expect(retryEdge?.data.max_iterations).toBe(3);
  });

  it("omits max_iterations when not set", () => {
    const { edges } = workflowToFlow(wfWithMaxIter);
    const firstEdge = edges.find((e) => e.source === "check" && e.target === "fix");
    expect(firstEdge?.data.max_iterations).toBeUndefined();
  });

  it("round-trips max_iterations through flowToWorkflow", () => {
    const { nodes, edges } = workflowToFlow(wfWithMaxIter);
    const rebuilt = flowToWorkflow(
      {
        id: wfWithMaxIter.id,
        name: wfWithMaxIter.name,
        description: wfWithMaxIter.description,
        entry: wfWithMaxIter.entry,
      },
      nodes,
      edges,
    );
    const retryEdge = rebuilt.edges.find((e) => e.from === "fix" && e.to === "check");
    expect(retryEdge?.max_iterations).toBe(3);
    // Non-retry edge should not have max_iterations
    const normalEdge = rebuilt.edges.find((e) => e.from === "check" && e.to === "fix");
    expect(normalEdge).not.toHaveProperty("max_iterations");
  });
});

describe("Source type preservation", () => {
  it("preserves inline string instructions through round-trip", () => {
    const { nodes, edges } = workflowToFlow(testWorkflow);
    const rebuilt = flowToWorkflow({ id: "x", name: "X", description: "", entry: "a" }, nodes, edges);
    expect(rebuilt.nodes.a.instruction).toBe("Do A");
  });

  it("preserves {file:} Source through round-trip", () => {
    const wf: Workflow = {
      id: "file-src",
      name: "File Source",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: { file: "./instructions/step-a.md" }, skills: [] },
      },
      edges: [],
    };
    const { nodes, edges } = workflowToFlow(wf);
    const rebuilt = flowToWorkflow({ id: wf.id, name: wf.name, description: "", entry: "a" }, nodes, edges);
    expect(rebuilt.nodes.a.instruction).toEqual({ file: "./instructions/step-a.md" });
  });

  it("preserves {url:} Source through round-trip", () => {
    const wf: Workflow = {
      id: "url-src",
      name: "URL Source",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: { url: "https://example.com/instruction.md" }, skills: [] },
      },
      edges: [],
    };
    const { nodes, edges } = workflowToFlow(wf);
    const rebuilt = flowToWorkflow({ id: wf.id, name: wf.name, description: "", entry: "a" }, nodes, edges);
    expect(rebuilt.nodes.a.instruction).toEqual({ url: "https://example.com/instruction.md" });
  });

  it("preserves {inline:} Source through round-trip", () => {
    const wf: Workflow = {
      id: "inline-src",
      name: "Inline Source",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: { inline: "Explicit inline text" }, skills: [] },
      },
      edges: [],
    };
    const { nodes, edges } = workflowToFlow(wf);
    const rebuilt = flowToWorkflow({ id: wf.id, name: wf.name, description: "", entry: "a" }, nodes, edges);
    expect(rebuilt.nodes.a.instruction).toEqual({ inline: "Explicit inline text" });
  });

  it("preserves {url:, type:} Source through round-trip", () => {
    const wf: Workflow = {
      id: "url-type-src",
      name: "URL Type Source",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: { url: "https://example.com/data", type: "fetch" }, skills: [] },
      },
      edges: [],
    };
    const { nodes, edges } = workflowToFlow(wf);
    const rebuilt = flowToWorkflow({ id: wf.id, name: wf.name, description: "", entry: "a" }, nodes, edges);
    const src = rebuilt.nodes.a.instruction;
    expect(src).toEqual({ url: "https://example.com/data", type: "fetch" });
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

  it("omits max_iterations when not set", () => {
    const { nodes, edges } = workflowToFlow(testWorkflow);
    const rebuilt = flowToWorkflow({ id: "x", name: "X", description: "", entry: "a" }, nodes, edges);
    for (const edge of rebuilt.edges) {
      expect(edge).not.toHaveProperty("max_iterations");
    }
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

  // Fix #7: skipped nodes have their own distinct state — do not collapse
  // them into "failed", which misrepresents the workflow for Studio users.
  it("marks node as skipped on node:exit with skipped", () => {
    const map = makeNodeDataMap();
    const result: NodeResult = { status: "skipped", data: { skipped_reason: "requires not met" }, toolCalls: [] };
    applyExecutionEvent({ type: "node:exit", node: "a", result } as ExecutionEvent, map);
    expect(map.get("a")!.exec.status).toBe("skipped");
    expect(map.get("a")!.exec.result).toBe(result);
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
