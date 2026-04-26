import { describe, it, expect } from "vitest";
import {
  workflowZ,
  nodeZ,
  evaluatorZ,
  evaluatorRuleZ,
  nodeRequiresZ,
  nodeRetryZ,
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

    it("accepts an eval block with a function evaluator", () => {
      const result = nodeZ.parse({
        name: "S",
        instruction: "I",
        eval: [
          {
            name: "issue_tracker_called",
            kind: "function",
            rule: { any_tool_called: ["linear_create_issue", "github_create_issue"] },
          },
        ],
      });
      expect(result.eval).toHaveLength(1);
      expect(result.eval![0]!.kind).toBe("function");
      expect(result.eval![0]!.rule!.any_tool_called).toEqual(["linear_create_issue", "github_create_issue"]);
    });

    it("rejects an eval block with empty array", () => {
      expect(() => nodeZ.parse({ name: "S", instruction: "I", eval: [] })).toThrow();
    });

    it("rejects an evaluator missing a name", () => {
      expect(() =>
        nodeZ.parse({
          name: "S",
          instruction: "I",
          eval: [{ kind: "value", rule: { output_required: ["x"] } }],
        }),
      ).toThrow();
    });

    it("rejects an evaluator with empty any_tool_called rule", () => {
      expect(() =>
        nodeZ.parse({
          name: "S",
          instruction: "I",
          eval: [{ name: "x", kind: "function", rule: { any_tool_called: [] } }],
        }),
      ).toThrow();
    });

    it("accepts a value evaluator with all_tools_called rule", () => {
      const v = evaluatorRuleZ.parse({ all_tools_called: ["a", "b"] });
      expect(v.all_tools_called).toEqual(["a", "b"]);
    });

    it("accepts a no_tool_called rule", () => {
      const v = evaluatorRuleZ.parse({ no_tool_called: ["force_push"] });
      expect(v.no_tool_called).toEqual(["force_push"]);
    });

    it("accepts an output_required rule", () => {
      const v = evaluatorRuleZ.parse({ output_required: ["prUrl", "branch"] });
      expect(v.output_required).toEqual(["prUrl", "branch"]);
    });

    it("accepts output_matches with each operator", () => {
      const v = evaluatorRuleZ.parse({
        output_matches: [
          { path: "a", equals: 1 },
          { path: "b", in: ["x", "y"] },
          { path: "c", matches: "^foo" },
        ],
      });
      expect(v.output_matches).toHaveLength(3);
    });

    it("accepts a rule combining multiple check types", () => {
      const v = evaluatorRuleZ.parse({
        any_tool_called: ["a"],
        output_required: ["x"],
        output_matches: [{ path: "x", equals: 1 }],
      });
      expect(v.any_tool_called).toBeDefined();
      expect(v.output_required).toBeDefined();
      expect(v.output_matches).toBeDefined();
    });

    it("rejects an output_matches entry with zero operators", () => {
      expect(() => evaluatorRuleZ.parse({ output_matches: [{ path: "a" }] })).toThrow();
    });

    it("rejects an output_matches entry with two operators", () => {
      expect(() => evaluatorRuleZ.parse({ output_matches: [{ path: "a", equals: 1, in: [1, 2] }] })).toThrow();
    });

    it("rejects an output_matches entry with equals + matches", () => {
      expect(() => evaluatorRuleZ.parse({ output_matches: [{ path: "a", equals: 1, matches: "^x$" }] })).toThrow();
    });

    it("rejects an output_matches entry with in + matches", () => {
      expect(() => evaluatorRuleZ.parse({ output_matches: [{ path: "a", in: [1, 2], matches: "^x$" }] })).toThrow();
    });

    it("rejects an output_matches entry with all three operators", () => {
      expect(() =>
        evaluatorRuleZ.parse({ output_matches: [{ path: "a", equals: 1, in: [1], matches: "^x$" }] }),
      ).toThrow();
    });

    it("accepts equals: null as a valid operator value", () => {
      expect(() => evaluatorRuleZ.parse({ output_matches: [{ path: "a", equals: null }] })).not.toThrow();
    });

    it("rejects an output_matches entry with empty path", () => {
      expect(() => evaluatorRuleZ.parse({ output_matches: [{ path: "", equals: 1 }] })).toThrow();
    });

    it("rejects an empty output_required array", () => {
      expect(() => evaluatorRuleZ.parse({ output_required: [] })).toThrow();
    });

    it("rejects an empty all_tools_called array", () => {
      expect(() => evaluatorRuleZ.parse({ all_tools_called: [] })).toThrow();
    });

    it("rejects an empty no_tool_called array", () => {
      expect(() => evaluatorRuleZ.parse({ no_tool_called: [] })).toThrow();
    });

    it("rejects an empty output_matches array", () => {
      expect(() => evaluatorRuleZ.parse({ output_matches: [] })).toThrow();
    });

    it("accepts a value evaluator and emits the correct kind", () => {
      const e = evaluatorZ.parse({ name: "shape", kind: "value", rule: { output_required: ["x"] } });
      expect(e.kind).toBe("value");
      expect(e.name).toBe("shape");
    });

    it("accepts a function evaluator and emits the correct kind", () => {
      const e = evaluatorZ.parse({ name: "called", kind: "function", rule: { any_tool_called: ["a"] } });
      expect(e.kind).toBe("function");
    });

    it("accepts a judge evaluator with rubric", () => {
      const e = evaluatorZ.parse({ name: "judged", kind: "judge", rubric: "is it good?", pass_when: "yes" });
      expect(e.kind).toBe("judge");
      expect(e.rubric).toBe("is it good?");
    });

    it("rejects a value evaluator missing a rule", () => {
      expect(() => evaluatorZ.parse({ name: "x", kind: "value" })).toThrow(/must declare a rule/);
    });

    it("rejects a function evaluator missing a rule", () => {
      expect(() => evaluatorZ.parse({ name: "x", kind: "function" })).toThrow(/must declare a rule/);
    });

    it("rejects a judge evaluator missing a rubric", () => {
      expect(() => evaluatorZ.parse({ name: "x", kind: "judge" })).toThrow(/must declare a rubric/);
    });

    it("rejects a judge evaluator that also declares a rule", () => {
      expect(() =>
        evaluatorZ.parse({ name: "x", kind: "judge", rubric: "ok?", rule: { output_required: ["a"] } }),
      ).toThrow(/must not declare a rule/);
    });

    it("rejects a value evaluator that also declares rubric/pass_when/model", () => {
      expect(() =>
        evaluatorZ.parse({
          name: "x",
          kind: "value",
          rule: { output_required: ["a"] },
          rubric: "stray",
        }),
      ).toThrow(/must not declare rubric/);
    });

    it("rejects an unknown kind", () => {
      expect(() => evaluatorZ.parse({ name: "x", kind: "magic", rubric: "what?" })).toThrow();
    });

    it("rejects an empty evaluator name", () => {
      expect(() => evaluatorZ.parse({ name: "", kind: "value", rule: { output_required: ["a"] } })).toThrow();
    });

    it("accepts eval_policy: all_pass on a node", () => {
      const r = nodeZ.parse({
        name: "S",
        instruction: "I",
        eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["a"] } }],
        eval_policy: "all_pass",
      });
      expect(r.eval_policy).toBe("all_pass");
    });

    it("accepts eval_policy: any_pass and weighted (reserved values)", () => {
      const r1 = nodeZ.parse({
        name: "S",
        instruction: "I",
        eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["a"] } }],
        eval_policy: "any_pass",
      });
      expect(r1.eval_policy).toBe("any_pass");
      const r2 = nodeZ.parse({
        name: "S",
        instruction: "I",
        eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["a"] } }],
        eval_policy: "weighted",
      });
      expect(r2.eval_policy).toBe("weighted");
    });

    it("rejects an unknown eval_policy", () => {
      expect(() =>
        nodeZ.parse({
          name: "S",
          instruction: "I",
          eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["a"] } }],
          eval_policy: "majority",
        }),
      ).toThrow();
    });

    it("accepts judge_model on a node", () => {
      const r = nodeZ.parse({
        name: "S",
        instruction: "I",
        eval: [{ name: "x", kind: "judge", rubric: "ok?" }],
        judge_model: "claude-haiku-4-5",
      });
      expect(r.judge_model).toBe("claude-haiku-4-5");
    });
  });

  describe("parseWorkflow legacy verify migration", () => {
    it("throws a clear migration error when a node uses the legacy verify: field", () => {
      const raw = {
        id: "wf",
        name: "wf",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do",
            verify: { any_tool_called: ["x"] },
          },
        },
        edges: [],
      };
      expect(() => parseWorkflow(raw)).toThrow(/Node "a".*verify.*renamed to 'eval:'/);
    });

    it("includes a migration guide link in the error", () => {
      const raw = {
        id: "wf",
        name: "wf",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do", verify: { output_required: ["x"] } } },
        edges: [],
      };
      expect(() => parseWorkflow(raw)).toThrow(/spec\.sweny\.ai\/nodes/);
    });

    it("names the offending node when multiple nodes are present", () => {
      const raw = {
        id: "wf",
        name: "wf",
        entry: "good",
        nodes: {
          good: { name: "Good", instruction: "Do" },
          bad: { name: "Bad", instruction: "Do", verify: { any_tool_called: ["x"] } },
        },
        edges: [{ from: "good", to: "bad" }],
      };
      expect(() => parseWorkflow(raw)).toThrow(/Node "bad"/);
    });

    it("does not trip on a workflow without verify", () => {
      const raw = {
        id: "wf",
        name: "wf",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do",
            eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["t"] } }],
          },
        },
        edges: [],
      };
      expect(() => parseWorkflow(raw)).not.toThrow();
    });
  });

  describe("nodeRequiresZ", () => {
    it("accepts output_required only", () => {
      expect(() => nodeRequiresZ.parse({ output_required: ["input.x"] })).not.toThrow();
    });

    it("accepts output_matches only", () => {
      expect(() => nodeRequiresZ.parse({ output_matches: [{ path: "input.x", equals: 1 }] })).not.toThrow();
    });

    it("accepts on_fail: 'fail'", () => {
      expect(() => nodeRequiresZ.parse({ output_required: ["input.x"], on_fail: "fail" })).not.toThrow();
    });

    it("accepts on_fail: 'skip'", () => {
      expect(() => nodeRequiresZ.parse({ output_required: ["input.x"], on_fail: "skip" })).not.toThrow();
    });

    it("rejects empty requires (no checks declared)", () => {
      expect(() => nodeRequiresZ.parse({})).toThrow();
    });

    it("rejects on_fail other than 'fail' or 'skip'", () => {
      expect(() => nodeRequiresZ.parse({ output_required: ["input.x"], on_fail: "throw" })).toThrow();
    });

    it("rejects empty output_required array", () => {
      expect(() => nodeRequiresZ.parse({ output_required: [] })).toThrow();
    });

    it("nodeZ accepts a node with requires", () => {
      expect(() =>
        nodeZ.parse({
          name: "Test",
          instruction: "Do thing",
          skills: [],
          requires: { output_required: ["input.x"] },
        }),
      ).not.toThrow();
    });
  });

  describe("nodeRetryZ", () => {
    it("accepts max alone", () => {
      expect(() => nodeRetryZ.parse({ max: 2 })).not.toThrow();
    });

    it("accepts max + string instruction", () => {
      expect(() => nodeRetryZ.parse({ max: 1, instruction: "Try harder" })).not.toThrow();
    });

    it("accepts max + { auto: true }", () => {
      expect(() => nodeRetryZ.parse({ max: 1, instruction: { auto: true } })).not.toThrow();
    });

    it("accepts max + { reflect: '...' }", () => {
      expect(() => nodeRetryZ.parse({ max: 1, instruction: { reflect: "Focus on tool calls" } })).not.toThrow();
    });

    it("rejects max: 0", () => {
      expect(() => nodeRetryZ.parse({ max: 0 })).toThrow();
    });

    it("rejects negative max", () => {
      expect(() => nodeRetryZ.parse({ max: -1 })).toThrow();
    });

    it("rejects non-integer max", () => {
      expect(() => nodeRetryZ.parse({ max: 1.5 })).toThrow();
    });

    it("rejects { auto: false }", () => {
      expect(() => nodeRetryZ.parse({ max: 1, instruction: { auto: false } })).toThrow();
    });

    it("rejects empty reflect string", () => {
      expect(() => nodeRetryZ.parse({ max: 1, instruction: { reflect: "" } })).toThrow();
    });

    it("rejects instruction with both auto and reflect", () => {
      expect(() => nodeRetryZ.parse({ max: 1, instruction: { auto: true, reflect: "x" } as any })).toThrow();
    });

    it("requires max field", () => {
      expect(() => nodeRetryZ.parse({ instruction: "x" })).toThrow();
    });

    it("nodeZ accepts a node with retry", () => {
      expect(() =>
        nodeZ.parse({
          name: "Test",
          instruction: "Do thing",
          skills: [],
          retry: { max: 2, instruction: { auto: true } },
        }),
      ).not.toThrow();
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

    it("accepts workflow_type as one of the v1 enum values", () => {
      for (const t of ["pr_review", "e2e_test", "content_generation", "monitor", "data_sync", "generic"]) {
        const result = workflowZ.parse({
          id: "x",
          name: "X",
          entry: "a",
          workflow_type: t,
          nodes: { a: { name: "A", instruction: "Do A" } },
          edges: [],
        });
        expect(result.workflow_type).toBe(t);
      }
    });

    it("treats workflow_type as optional (no value when absent)", () => {
      const result = workflowZ.parse({
        id: "x",
        name: "X",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do A" } },
        edges: [],
      });
      expect(result.workflow_type).toBeUndefined();
    });

    it("rejects an unknown workflow_type", () => {
      expect(() =>
        workflowZ.parse({
          id: "x",
          name: "X",
          entry: "a",
          workflow_type: "magic",
          nodes: { a: { name: "A", instruction: "Do A" } },
          edges: [],
        }),
      ).toThrow();
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

  it("has additionalProperties: true at top level (marketplace metadata is tolerated)", () => {
    // Round 2: relaxed from false to true. Marketplace workflows carry
    // author / category / tags alongside the schema-defined fields, read
    // by publish.ts. Inner objects (nodes, edges, skills, eval, requires)
    // stay strict — that's where drift actually matters.
    expect(workflowJsonSchema.additionalProperties).toBe(true);
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
