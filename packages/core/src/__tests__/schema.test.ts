import { describe, it, expect } from "vitest";
import {
  workflowZ,
  nodeZ,
  edgeZ,
  skillZ,
  toolZ,
  parseWorkflow,
  validateWorkflow,
  workflowJsonSchema,
} from "../schema.js";
import type { Workflow } from "../types.js";
import { triageWorkflow } from "../workflows/triage.js";
import { implementWorkflow } from "../workflows/implement.js";

// ─── Test fixtures ───────────────────────────────────────────────

const validWorkflow: Workflow = {
  id: "test-wf",
  name: "Test Workflow",
  description: "A→B→C",
  entry: "a",
  nodes: {
    a: { name: "A", instruction: "Do A", skills: ["github"] },
    b: { name: "B", instruction: "Do B", skills: [] },
    c: { name: "C", instruction: "Do C", skills: [] },
  },
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

// ─── Zod schema tests ────────────────────────────────────────────

describe("Zod schemas", () => {
  describe("nodeZ", () => {
    it("parses a valid node", () => {
      const result = nodeZ.parse({ name: "Step", instruction: "Do it", skills: ["github"] });
      expect(result.name).toBe("Step");
      expect(result.skills).toEqual(["github"]);
    });

    it("defaults skills to empty array", () => {
      const result = nodeZ.parse({ name: "Step", instruction: "Do it" });
      expect(result.skills).toEqual([]);
    });

    it("rejects empty name", () => {
      expect(() => nodeZ.parse({ name: "", instruction: "x" })).toThrow();
    });

    it("rejects empty instruction", () => {
      expect(() => nodeZ.parse({ name: "x", instruction: "" })).toThrow();
    });

    it("accepts optional output schema", () => {
      const result = nodeZ.parse({
        name: "S",
        instruction: "I",
        output: { type: "object", properties: { severity: { type: "string" } } },
      });
      expect(result.output).toBeDefined();
    });
  });

  describe("edgeZ", () => {
    it("parses a simple edge", () => {
      const result = edgeZ.parse({ from: "a", to: "b" });
      expect(result.from).toBe("a");
      expect(result.when).toBeUndefined();
    });

    it("parses an edge with condition", () => {
      const result = edgeZ.parse({ from: "a", to: "b", when: "severity is high" });
      expect(result.when).toBe("severity is high");
    });

    it("rejects empty from", () => {
      expect(() => edgeZ.parse({ from: "", to: "b" })).toThrow();
    });

    it("rejects empty to", () => {
      expect(() => edgeZ.parse({ from: "a", to: "" })).toThrow();
    });
  });

  describe("toolZ", () => {
    it("parses a valid tool", () => {
      const result = toolZ.parse({
        name: "my_tool",
        description: "Does things",
        input_schema: { type: "object", properties: {} },
      });
      expect(result.name).toBe("my_tool");
    });

    it("rejects empty name", () => {
      expect(() => toolZ.parse({ name: "", description: "x", input_schema: {} })).toThrow();
    });
  });

  describe("skillZ", () => {
    it("parses a valid skill", () => {
      const result = skillZ.parse({
        id: "test",
        name: "Test",
        description: "A test skill",
        category: "general",
        config: {
          TOKEN: { description: "API token", required: true, env: "TOKEN" },
        },
        tools: [{ name: "t", description: "d", input_schema: {} }],
      });
      expect(result.id).toBe("test");
      expect(result.tools).toHaveLength(1);
    });
  });

  describe("workflowZ", () => {
    it("parses a valid workflow", () => {
      const raw = JSON.parse(JSON.stringify(validWorkflow));
      const result = workflowZ.parse(raw);
      expect(result.id).toBe("test-wf");
      expect(Object.keys(result.nodes)).toHaveLength(3);
    });

    it("defaults description to empty string", () => {
      const raw = {
        id: "x",
        name: "X",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do A" } },
        edges: [],
      };
      const result = workflowZ.parse(raw);
      expect(result.description).toBe("");
    });

    it("rejects missing id", () => {
      expect(() => workflowZ.parse({ name: "x", entry: "a", nodes: {}, edges: [] })).toThrow();
    });

    it("rejects missing entry", () => {
      expect(() => workflowZ.parse({ id: "x", name: "x", nodes: {}, edges: [] })).toThrow();
    });

    it("rejects empty id", () => {
      expect(() => workflowZ.parse({ id: "", name: "x", entry: "a", nodes: {}, edges: [] })).toThrow();
    });
  });

  describe("parseWorkflow", () => {
    it("parses a raw JSON workflow", () => {
      const raw = JSON.parse(JSON.stringify(validWorkflow));
      const parsed = parseWorkflow(raw);
      expect(parsed.id).toBe("test-wf");
      expect(parsed.nodes["a"].instruction).toBe("Do A");
    });

    it("rejects invalid input", () => {
      expect(() => parseWorkflow({ id: "" })).toThrow();
      expect(() => parseWorkflow(null)).toThrow();
      expect(() => parseWorkflow("not an object")).toThrow();
    });
  });
});

// ─── Structural validation tests ─────────────────────────────────

describe("validateWorkflow", () => {
  it("validates a correct workflow", () => {
    expect(validateWorkflow(validWorkflow)).toEqual([]);
  });

  it("detects missing entry node", () => {
    const bad = { ...validWorkflow, entry: "nonexistent" };
    const errors = validateWorkflow(bad);
    expect(errors).toContainEqual(expect.objectContaining({ code: "MISSING_ENTRY" }));
  });

  it("detects unknown edge source", () => {
    const bad: Workflow = {
      ...validWorkflow,
      edges: [{ from: "ghost", to: "b" }],
    };
    const errors = validateWorkflow(bad);
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_EDGE_SOURCE" }));
  });

  it("detects unknown edge target", () => {
    const bad: Workflow = {
      ...validWorkflow,
      edges: [{ from: "a", to: "ghost" }],
    };
    const errors = validateWorkflow(bad);
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_EDGE_TARGET" }));
  });

  it("detects self-loops", () => {
    const loopy: Workflow = {
      ...validWorkflow,
      edges: [
        { from: "a", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    const errors = validateWorkflow(loopy);
    expect(errors).toContainEqual(expect.objectContaining({ code: "SELF_LOOP", nodeId: "a" }));
  });

  it("detects unreachable nodes", () => {
    const disconnected: Workflow = {
      ...validWorkflow,
      edges: [{ from: "a", to: "b" }],
      // c has no incoming edge from the reachable set
    };
    const errors = validateWorkflow(disconnected);
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNREACHABLE_NODE", nodeId: "c" }));
  });

  it("detects unknown skill references", () => {
    const errors = validateWorkflow(validWorkflow, new Set(["not-github"]));
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_SKILL", nodeId: "a" }));
  });

  it("passes when known skills match", () => {
    const errors = validateWorkflow(validWorkflow, new Set(["github"]));
    expect(errors).toEqual([]);
  });

  it("validates triage workflow", () => {
    expect(validateWorkflow(triageWorkflow)).toEqual([]);
  });

  it("validates implement workflow", () => {
    expect(validateWorkflow(implementWorkflow)).toEqual([]);
  });

  it("handles empty nodes object", () => {
    const empty: Workflow = {
      id: "empty",
      name: "Empty",
      description: "",
      entry: "x",
      nodes: {},
      edges: [],
    };
    const errors = validateWorkflow(empty);
    expect(errors).toContainEqual(expect.objectContaining({ code: "MISSING_ENTRY" }));
  });
});

// ─── JSON Schema shape tests ─────────────────────────────────────

describe("workflowJsonSchema", () => {
  it("has the correct $id", () => {
    expect(workflowJsonSchema.$id).toBe("https://sweny.ai/schemas/workflow.json");
  });

  it("requires all top-level fields", () => {
    expect(workflowJsonSchema.required).toContain("id");
    expect(workflowJsonSchema.required).toContain("name");
    expect(workflowJsonSchema.required).toContain("nodes");
    expect(workflowJsonSchema.required).toContain("edges");
    expect(workflowJsonSchema.required).toContain("entry");
  });

  it("has additionalProperties: false at top level", () => {
    expect(workflowJsonSchema.additionalProperties).toBe(false);
  });

  it("has additionalProperties: false on edge items", () => {
    expect((workflowJsonSchema.properties.edges.items as any).additionalProperties).toBe(false);
  });

  it("has additionalProperties: false on node items", () => {
    expect((workflowJsonSchema.properties.nodes.additionalProperties as any).additionalProperties).toBe(false);
  });

  it("edge items require from and to", () => {
    expect((workflowJsonSchema.properties.edges.items as any).required).toContain("from");
    expect((workflowJsonSchema.properties.edges.items as any).required).toContain("to");
  });

  it("node items require name and instruction", () => {
    expect((workflowJsonSchema.properties.nodes.additionalProperties as any).required).toContain("name");
    expect((workflowJsonSchema.properties.nodes.additionalProperties as any).required).toContain("instruction");
  });
});
