import { describe, it, expect } from "vitest";
import {
  workflowZ,
  nodeZ,
  edgeZ,
  skillZ,
  toolZ,
  mcpServerConfigZ,
  skillDefinitionZ,
  parseWorkflow,
  validateWorkflow,
  workflowJsonSchema,
} from "../schema.js";
import type { Workflow } from "../types.js";
import { triageWorkflow, implementWorkflow } from "../workflows/index.js";

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

    it("accepts a verify block with any_tool_called", () => {
      const result = nodeZ.parse({
        name: "S",
        instruction: "I",
        verify: { any_tool_called: ["linear_create_issue", "github_create_issue"] },
      });
      expect(result.verify?.any_tool_called).toEqual(["linear_create_issue", "github_create_issue"]);
    });

    it("rejects verify with no check declared", () => {
      expect(() => nodeZ.parse({ name: "S", instruction: "I", verify: {} })).toThrow();
    });

    it("rejects verify with empty any_tool_called", () => {
      expect(() => nodeZ.parse({ name: "S", instruction: "I", verify: { any_tool_called: [] } })).toThrow();
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

    it("parses an edge with max_iterations", () => {
      const result = edgeZ.parse({ from: "a", to: "b", when: "needs retry", max_iterations: 3 });
      expect(result.max_iterations).toBe(3);
    });

    it("rejects max_iterations less than 1", () => {
      expect(() => edgeZ.parse({ from: "a", to: "b", max_iterations: 0 })).toThrow();
    });

    it("rejects non-integer max_iterations", () => {
      expect(() => edgeZ.parse({ from: "a", to: "b", max_iterations: 1.5 })).toThrow();
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

  describe("mcpServerConfigZ", () => {
    it("accepts stdio config", () => {
      const result = mcpServerConfigZ.parse({ command: "npx", args: ["-y", "@company/tool-server"] });
      expect(result.command).toBe("npx");
    });
    it("accepts http config", () => {
      const result = mcpServerConfigZ.parse({
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer token" },
      });
      expect(result.url).toBe("https://mcp.example.com");
    });
    it("accepts explicit type", () => {
      const result = mcpServerConfigZ.parse({ type: "stdio", command: "node", args: ["server.js"] });
      expect(result.type).toBe("stdio");
    });
    it("accepts env field", () => {
      const result = mcpServerConfigZ.parse({
        command: "npx",
        args: ["-y", "server"],
        env: { API_KEY: "Company API key" },
      });
      expect(result.env).toEqual({ API_KEY: "Company API key" });
    });
    it("rejects config with neither command nor url", () => {
      expect(() => mcpServerConfigZ.parse({ args: ["foo"] })).toThrow(
        "MCP server must have either command (stdio) or url (HTTP)",
      );
    });
  });

  describe("skillDefinitionZ", () => {
    it("accepts instruction-only skill", () => {
      const result = skillDefinitionZ.parse({
        name: "Code Standards",
        instruction: "Follow our coding conventions...",
      });
      expect(result.instruction).toBe("Follow our coding conventions...");
    });
    it("accepts mcp-only skill", () => {
      const result = skillDefinitionZ.parse({ mcp: { command: "npx", args: ["-y", "server"] } });
      expect(result.mcp?.command).toBe("npx");
    });
    it("accepts both instruction and mcp", () => {
      const result = skillDefinitionZ.parse({
        instruction: "Use this server for...",
        mcp: { url: "https://mcp.example.com" },
      });
      expect(result.instruction).toBeDefined();
      expect(result.mcp).toBeDefined();
    });
    it("rejects skill with neither instruction nor mcp", () => {
      expect(() => skillDefinitionZ.parse({ name: "Empty" })).toThrow(
        "Inline skill must provide instruction, mcp, or both",
      );
    });
  });

  describe("skillZ with new fields", () => {
    it("accepts skill with instruction and no tools", () => {
      const result = skillZ.parse({
        id: "code-standards",
        name: "Code Standards",
        description: "Team coding conventions",
        category: "general",
        instruction: "Follow camelCase naming...",
      });
      expect(result.tools).toEqual([]);
      expect(result.instruction).toBe("Follow camelCase naming...");
    });
    it("accepts skill with mcp and no tools", () => {
      const result = skillZ.parse({
        id: "our-crm",
        name: "Our CRM",
        description: "CRM integration",
        category: "general",
        mcp: { url: "https://crm.example.com/mcp" },
      });
      expect(result.tools).toEqual([]);
      expect(result.mcp?.url).toBe("https://crm.example.com/mcp");
    });
    it("rejects skill with no tools, no instruction, no mcp", () => {
      expect(() => skillZ.parse({ id: "empty", name: "Empty", description: "Nothing", category: "general" })).toThrow(
        "Skill must provide at least one of: tools, instruction, or mcp",
      );
    });
    it("defaults tools to empty array", () => {
      const result = skillZ.parse({
        id: "x",
        name: "X",
        description: "X",
        category: "general",
        instruction: "do stuff",
      });
      expect(result.tools).toEqual([]);
    });
    it("defaults config to empty object", () => {
      const result = skillZ.parse({
        id: "x",
        name: "X",
        description: "X",
        category: "general",
        instruction: "do stuff",
      });
      expect(result.config).toEqual({});
    });
  });

  describe("workflowZ with skills", () => {
    it("parses workflow with inline skills", () => {
      const result = workflowZ.parse({
        id: "test",
        name: "Test",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do A", skills: ["my-skill"] } },
        edges: [],
        skills: { "my-skill": { name: "My Skill", instruction: "Custom guidance here" } },
      });
      expect(result.skills?.["my-skill"]?.instruction).toBe("Custom guidance here");
    });
    it("defaults skills to empty object", () => {
      const result = workflowZ.parse({
        id: "x",
        name: "X",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do A" } },
        edges: [],
      });
      expect(result.skills).toEqual({});
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

  it("detects self-loops without max_iterations", () => {
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

  it("allows self-loops with max_iterations", () => {
    const loopy: Workflow = {
      ...validWorkflow,
      edges: [
        { from: "a", to: "a", when: "needs retry", max_iterations: 2 },
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    const errors = validateWorkflow(loopy);
    expect(errors).toEqual([]);
  });

  it("detects unbounded multi-node cycles", () => {
    const cyclic: Workflow = {
      ...validWorkflow,
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", when: "retry" }, // cycle without max_iterations
        { from: "b", to: "c" },
      ],
    };
    const errors = validateWorkflow(cyclic);
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNBOUNDED_CYCLE" }));
  });

  it("allows multi-node cycles with max_iterations", () => {
    const cyclic: Workflow = {
      ...validWorkflow,
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", when: "retry", max_iterations: 3 },
        { from: "b", to: "c" },
      ],
    };
    const errors = validateWorkflow(cyclic);
    expect(errors).toEqual([]);
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

  it("recognizes inline workflow skills as known", () => {
    const wf = {
      ...validWorkflow,
      nodes: { ...validWorkflow.nodes, a: { ...validWorkflow.nodes.a, skills: ["custom-rubric"] } },
      skills: { "custom-rubric": { instruction: "Score things 1-5" } },
    };
    const errors = validateWorkflow(wf, new Set(["github"]));
    expect(errors.filter((e) => e.code === "UNKNOWN_SKILL")).toEqual([]);
  });

  it("rejects inline skills with neither instruction nor mcp", () => {
    const wf = {
      ...validWorkflow,
      skills: { "bad-skill": { name: "Bad" } },
    };
    const errors = validateWorkflow(wf);
    expect(errors).toContainEqual(expect.objectContaining({ code: "INVALID_INLINE_SKILL" }));
  });

  it("accepts inline skills with instruction only", () => {
    const wf = {
      ...validWorkflow,
      skills: { "ok-skill": { instruction: "Do something" } },
    };
    const errors = validateWorkflow(wf);
    expect(errors.filter((e) => e.code === "INVALID_INLINE_SKILL")).toEqual([]);
  });

  it("accepts inline skills with mcp only", () => {
    const wf = {
      ...validWorkflow,
      skills: { "mcp-skill": { mcp: { command: "npx", args: ["-y", "server"] } } },
    };
    const errors = validateWorkflow(wf);
    expect(errors.filter((e) => e.code === "INVALID_INLINE_SKILL")).toEqual([]);
  });
});

// ─── JSON Schema shape tests ─────────────────────────────────────

describe("workflowJsonSchema", () => {
  it("has the correct $id", () => {
    expect(workflowJsonSchema.$id).toBe("https://spec.sweny.ai/schemas/workflow.json");
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

  it("edge items include max_iterations", () => {
    const edgeProps = (workflowJsonSchema.properties.edges.items as any).properties;
    expect(edgeProps.max_iterations).toBeDefined();
    expect(edgeProps.max_iterations.type).toBe("integer");
    expect(edgeProps.max_iterations.minimum).toBe(1);
  });

  it("node items require name and instruction", () => {
    expect((workflowJsonSchema.properties.nodes.additionalProperties as any).required).toContain("name");
    expect((workflowJsonSchema.properties.nodes.additionalProperties as any).required).toContain("instruction");
  });
});
