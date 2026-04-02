import { describe, it, expect } from "vitest";
import { toMermaid, toMermaidBlock } from "./mermaid.js";
import type { Workflow } from "./types.js";
import { triageWorkflow, implementWorkflow } from "./workflows/index.js";

// ─── Fixtures ──────────────────────────────────────────────────────

const simple: Workflow = {
  id: "simple",
  name: "Simple",
  description: "A→B→C",
  entry: "a",
  nodes: {
    a: { name: "Triage", instruction: "Triage the alert", skills: ["github"] },
    b: { name: "Investigate", instruction: "Investigate the issue", skills: ["sentry"] },
    c: { name: "Report", instruction: "Write report", skills: ["slack"] },
  },
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

const branching: Workflow = {
  id: "branching",
  name: "Branching",
  description: "Conditional routing",
  entry: "triage",
  nodes: {
    triage: { name: "Triage", instruction: "Classify severity", skills: [] },
    investigate: { name: "Investigate", instruction: "Deep dive", skills: [] },
    notify: { name: "Notify", instruction: "Send alert", skills: [] },
    close: { name: "Close", instruction: "Close ticket", skills: [] },
  },
  edges: [
    { from: "triage", to: "investigate", when: "severity is high or critical" },
    { from: "triage", to: "notify", when: "severity is low" },
    { from: "investigate", to: "close" },
    { from: "notify", to: "close" },
  ],
};

const withLoop: Workflow = {
  id: "loop",
  name: "Loop",
  description: "Retry loop",
  entry: "a",
  nodes: {
    a: { name: "Try", instruction: "Attempt fix", skills: [] },
    b: { name: "Done", instruction: "Wrap up", skills: [] },
  },
  edges: [
    { from: "a", to: "a", when: "needs retry", max_iterations: 3 },
    { from: "a", to: "b" },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────

describe("toMermaid", () => {
  it("renders a simple linear workflow", () => {
    const result = toMermaid(simple);

    expect(result).toContain("graph TB");
    // Entry node gets stadium shape
    expect(result).toContain("a([Triage \\u25B6])");
    // Non-entry nodes get default shape
    expect(result).toContain("b[Investigate]");
    expect(result).toContain("c[Report]");
    // Edges
    expect(result).toContain("a --> b");
    expect(result).toContain("b --> c");
  });

  it("renders conditional edges with labels", () => {
    const result = toMermaid(branching);

    expect(result).toContain('triage -->|"severity is high or critical"| investigate');
    expect(result).toContain('triage -->|"severity is low"| notify');
    expect(result).toContain("investigate --> close");
    expect(result).toContain("notify --> close");
  });

  it("renders max_iterations on edges", () => {
    const result = toMermaid(withLoop);

    expect(result).toContain('a -->|"needs retry (max 3x)"| a');
    expect(result).toContain("a --> b");
  });

  it("renders max_iterations without condition", () => {
    const wf: Workflow = {
      ...simple,
      edges: [
        { from: "a", to: "b", max_iterations: 5 },
        { from: "b", to: "c" },
      ],
    };
    const result = toMermaid(wf);
    expect(result).toContain('a -->|"max 5x"| b');
  });

  it("applies execution state styling", () => {
    const result = toMermaid(simple, {
      state: {
        a: "success",
        b: "current",
      },
    });

    expect(result).toContain("classDef current fill:#3b82f6");
    expect(result).toContain("classDef success fill:#22c55e");
    expect(result).toContain("class a success");
    expect(result).toContain("class b current");
    // c has no state — no class applied
    expect(result).not.toContain("class c");
  });

  it("applies failed and skipped styling", () => {
    const result = toMermaid(simple, {
      state: {
        a: "success",
        b: "failed",
        c: "skipped",
      },
    });

    expect(result).toContain("classDef failed fill:#ef4444");
    expect(result).toContain("classDef skipped fill:#6b7280");
    expect(result).toContain("class b failed");
    expect(result).toContain("class c skipped");
  });

  it("omits style block when no state provided", () => {
    const result = toMermaid(simple);

    expect(result).not.toContain("classDef");
    expect(result).not.toContain("class ");
  });

  it("supports LR direction", () => {
    const result = toMermaid(simple, { direction: "LR" });
    expect(result).toContain("graph LR");
  });

  it("supports title", () => {
    const result = toMermaid(simple, { title: "My Workflow" });
    expect(result).toContain("---");
    expect(result).toContain("title: My Workflow");
  });

  it("sanitizes node IDs with special characters", () => {
    const wf: Workflow = {
      id: "special",
      name: "Special",
      description: "",
      entry: "step.one",
      nodes: {
        "step.one": { name: "Step One", instruction: "Do it", skills: [] },
        "step two": { name: "Step Two", instruction: "Do it", skills: [] },
      },
      edges: [{ from: "step.one", to: "step two" }],
    };
    const result = toMermaid(wf);

    expect(result).toContain("step_one");
    expect(result).toContain("step_two");
    expect(result).not.toContain("step.one");
    expect(result).not.toContain("step two");
  });

  it("escapes special characters in labels", () => {
    const wf: Workflow = {
      id: "escape",
      name: "Escape",
      description: "",
      entry: "a",
      nodes: {
        a: { name: 'Say "hello"', instruction: "x", skills: [] },
        b: { name: "Done", instruction: "x", skills: [] },
      },
      edges: [{ from: "a", to: "b" }],
    };
    const result = toMermaid(wf);

    expect(result).toContain("&quot;");
    expect(result).not.toContain('Say "hello"');
  });

  it("groups multiple nodes with same status", () => {
    const result = toMermaid(simple, {
      state: { a: "success", b: "success", c: "current" },
    });

    expect(result).toContain("class a,b success");
    expect(result).toContain("class c current");
  });
});

describe("builtin workflows", () => {
  it("renders triage workflow", () => {
    const result = toMermaid(triageWorkflow);
    expect(result).toContain("graph TB");
    // Every node should appear
    for (const [id, node] of Object.entries(triageWorkflow.nodes)) {
      expect(result).toContain(node.name);
    }
    // Every edge should appear
    for (const edge of triageWorkflow.edges) {
      expect(result).toContain(edge.from);
      expect(result).toContain(edge.to);
    }
  });

  it("renders implement workflow", () => {
    const result = toMermaid(implementWorkflow);
    expect(result).toContain("graph TB");
    for (const node of Object.values(implementWorkflow.nodes)) {
      expect(result).toContain(node.name);
    }
  });

  it("renders triage with execution state", () => {
    const ids = Object.keys(triageWorkflow.nodes);
    const state: Record<string, "success" | "current" | "failed" | "skipped"> = {};
    state[ids[0]] = "success";
    if (ids[1]) state[ids[1]] = "current";

    const result = toMermaid(triageWorkflow, { state, title: triageWorkflow.name });
    expect(result).toContain("classDef success");
    expect(result).toContain("classDef current");
    expect(result).toContain(`class ${ids[0]} success`);
  });
});

describe("toMermaidBlock", () => {
  it("wraps in fenced code block", () => {
    const result = toMermaidBlock(simple);

    expect(result).toMatch(/^```mermaid\n/);
    expect(result).toMatch(/\n```$/);
    expect(result).toContain("graph TB");
  });

  it("passes options through", () => {
    const result = toMermaidBlock(simple, { direction: "LR", state: { a: "success" } });

    expect(result).toContain("graph LR");
    expect(result).toContain("class a success");
  });
});
