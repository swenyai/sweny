import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { execute } from "./executor.js";
import type { Workflow, ExecutionEvent, Skill, Claude } from "./types.js";
import { MockClaude, createFileSkill } from "./testing.js";
import { createSkillMap } from "./skills/index.js";
import { validateWorkflow, parseWorkflow } from "./schema.js";
import { triageWorkflow, implementWorkflow } from "./workflows/index.js";

// ─── Test fixtures ───────────────────────────────────────────────

const tmpBase = path.join(tmpdir(), "sweny-core-test");

let dirCounter = 0;
function freshDir(name: string): string {
  const dir = path.join(tmpBase, `${name}-${Date.now()}-${++dirCounter}-${randomBytes(4).toString("hex")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Minimal 3-node DAG for unit testing
const simpleWorkflow: Workflow = {
  id: "test-simple",
  name: "Simple Test",
  description: "A→B→C linear workflow",
  entry: "step-a",
  nodes: {
    "step-a": {
      name: "Step A",
      instruction: "Read the input and produce context",
      skills: ["filesystem"],
    },
    "step-b": {
      name: "Step B",
      instruction: "Process the context from step A",
      skills: ["filesystem"],
    },
    "step-c": {
      name: "Step C",
      instruction: "Write the final result",
      skills: ["filesystem"],
    },
  },
  edges: [
    { from: "step-a", to: "step-b" },
    { from: "step-b", to: "step-c" },
  ],
};

// Branching DAG for conditional routing
const branchingWorkflow: Workflow = {
  id: "test-branching",
  name: "Branching Test",
  description: "A → B or C depending on condition",
  entry: "check",
  nodes: {
    check: {
      name: "Check Input",
      instruction: "Examine the input and determine severity",
      skills: ["filesystem"],
    },
    handle_high: {
      name: "Handle High Severity",
      instruction: "Handle a high-severity alert",
      skills: ["filesystem"],
    },
    handle_low: {
      name: "Handle Low Severity",
      instruction: "Handle a low-severity alert",
      skills: [],
    },
  },
  edges: [
    { from: "check", to: "handle_high", when: "severity is high or critical" },
    { from: "check", to: "handle_low", when: "severity is low or medium" },
  ],
};

// ─── Schema validation tests ─────────────────────────────────────

describe("schema validation", () => {
  it("validates a correct workflow", () => {
    const errors = validateWorkflow(simpleWorkflow);
    expect(errors).toEqual([]);
  });

  it("detects missing entry node", () => {
    const bad = { ...simpleWorkflow, entry: "nonexistent" };
    const errors = validateWorkflow(bad);
    expect(errors).toContainEqual(expect.objectContaining({ code: "MISSING_ENTRY" }));
  });

  it("detects unknown edge targets", () => {
    const bad: Workflow = {
      ...simpleWorkflow,
      edges: [{ from: "step-a", to: "nonexistent" }],
    };
    const errors = validateWorkflow(bad);
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_EDGE_TARGET" }));
  });

  it("detects unreachable nodes", () => {
    const disconnected: Workflow = {
      ...simpleWorkflow,
      edges: [{ from: "step-a", to: "step-b" }],
      // step-c has no incoming edge
    };
    const errors = validateWorkflow(disconnected);
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNREACHABLE_NODE", nodeId: "step-c" }));
  });

  it("detects self-loops", () => {
    const loopy: Workflow = {
      ...simpleWorkflow,
      edges: [
        { from: "step-a", to: "step-a" },
        { from: "step-a", to: "step-b" },
        { from: "step-b", to: "step-c" },
      ],
    };
    const errors = validateWorkflow(loopy);
    expect(errors).toContainEqual(expect.objectContaining({ code: "SELF_LOOP", nodeId: "step-a" }));
  });

  it("detects unknown skill references", () => {
    const errors = validateWorkflow(simpleWorkflow, new Set(["github"]));
    expect(errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_SKILL", nodeId: "step-a" }));
  });

  it("validates the triage workflow", () => {
    const errors = validateWorkflow(triageWorkflow);
    expect(errors).toEqual([]);
  });

  it("validates the implement workflow", () => {
    const errors = validateWorkflow(implementWorkflow);
    expect(errors).toEqual([]);
  });

  it("parses a raw JSON workflow via Zod", () => {
    const raw = JSON.parse(JSON.stringify(simpleWorkflow));
    const parsed = parseWorkflow(raw);
    expect(parsed.id).toBe("test-simple");
    expect(parsed.nodes["step-a"].instruction).toBe("Read the input and produce context");
  });

  it("rejects invalid workflow JSON", () => {
    expect(() => parseWorkflow({ id: "" })).toThrow();
    expect(() => parseWorkflow({ id: "x", name: "x", nodes: {}, edges: [] })).toThrow(); // missing entry
  });
});

// ─── Executor tests ──────────────────────────────────────────────

describe("executor", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = freshDir("executor");
  });

  it("executes a linear workflow end-to-end", async () => {
    const fileSkill = createFileSkill(outputDir);
    const skills = createSkillMap([fileSkill]);

    // Write a fixture input file
    writeFileSync(path.join(outputDir, "input.json"), JSON.stringify({ alert: "test" }));

    const claude = new MockClaude({
      responses: {
        "step-a": {
          toolCalls: [{ tool: "fs_read_json", input: { path: "input.json" } }],
          data: { context: "loaded from file" },
        },
        "step-b": {
          data: { analysis: "processed" },
        },
        "step-c": {
          toolCalls: [
            {
              tool: "fs_write_json",
              input: { path: "result.json", data: { status: "done" } },
            },
          ],
          data: { result: "written" },
        },
      },
    });

    const events: ExecutionEvent[] = [];
    const { results } = await execute(
      simpleWorkflow,
      { alert: "test" },
      {
        skills,
        claude,
        observer: (e) => events.push(e),
        config: {},
      },
    );

    // All 3 nodes executed
    expect(results.size).toBe(3);
    expect(results.get("step-a")?.status).toBe("success");
    expect(results.get("step-b")?.status).toBe("success");
    expect(results.get("step-c")?.status).toBe("success");

    // Node A read the input file
    expect(results.get("step-a")?.data.context).toBe("loaded from file");

    // Node C wrote the result file
    expect(existsSync(path.join(outputDir, "result.json"))).toBe(true);
    const written = JSON.parse(readFileSync(path.join(outputDir, "result.json"), "utf-8"));
    expect(written.status).toBe("done");

    // Events were emitted correctly
    expect(events[0]).toEqual({ type: "workflow:start", workflow: "test-simple" });
    const nodeEnters = events.filter((e) => e.type === "node:enter");
    expect(nodeEnters).toHaveLength(3);
    expect(events[events.length - 1].type).toBe("workflow:end");
  });

  it("executes conditional branches", async () => {
    const fileSkill = createFileSkill(outputDir);
    const skills = createSkillMap([fileSkill]);

    const claude = new MockClaude({
      responses: {
        check: { data: { severity: "high" } },
        handle_high: { data: { handled: true } },
      },
      routes: {
        check: "handle_high", // Route to high severity handler
      },
    });

    const { results } = await execute(
      branchingWorkflow,
      { alert: "cpu spike" },
      {
        skills,
        claude,
        config: {},
      },
    );

    expect(results.size).toBe(2);
    expect(results.has("check")).toBe(true);
    expect(results.has("handle_high")).toBe(true);
    expect(results.has("handle_low")).toBe(false);
  });

  it("routes to alternative branch", async () => {
    const fileSkill = createFileSkill(outputDir);
    const skills = createSkillMap([fileSkill]);

    const claude = new MockClaude({
      responses: {
        check: { data: { severity: "low" } },
        handle_low: { data: { skipped: true } },
      },
      routes: {
        check: "handle_low",
      },
    });

    const { results } = await execute(
      branchingWorkflow,
      { alert: "minor" },
      {
        skills,
        claude,
        config: {},
      },
    );

    expect(results.size).toBe(2);
    expect(results.has("handle_low")).toBe(true);
    expect(results.has("handle_high")).toBe(false);
  });

  it("emits tool:call and tool:result events", async () => {
    const fileSkill = createFileSkill(outputDir);
    writeFileSync(path.join(outputDir, "data.json"), '{"key": "value"}');

    const claude = new MockClaude({
      responses: {
        "step-a": {
          toolCalls: [{ tool: "fs_read_json", input: { path: "data.json" } }],
          data: { read: true },
        },
        "step-b": { data: {} },
        "step-c": { data: {} },
      },
    });

    const events: ExecutionEvent[] = [];
    await execute(
      simpleWorkflow,
      {},
      {
        skills: createSkillMap([fileSkill]),
        claude,
        observer: (e) => events.push(e),
        config: {},
      },
    );

    const toolCalls = events.filter((e) => e.type === "tool:call");
    const toolResults = events.filter((e) => e.type === "tool:result");
    expect(toolCalls).toHaveLength(1);
    expect(toolResults).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      type: "tool:call",
      node: "step-a",
      tool: "fs_read_json",
    });
  });

  it("throws on missing entry node", async () => {
    const bad: Workflow = { ...simpleWorkflow, entry: "nonexistent" };
    const claude = new MockClaude({ responses: {} });

    await expect(execute(bad, {}, { skills: createSkillMap([]), claude, config: {} })).rejects.toThrow("Entry node");
  });

  it("throws on invalid edge reference", async () => {
    const bad: Workflow = {
      ...simpleWorkflow,
      edges: [
        { from: "step-a", to: "nonexistent" },
        { from: "step-a", to: "step-b" },
      ],
    };
    const claude = new MockClaude({ responses: {} });

    await expect(execute(bad, {}, { skills: createSkillMap([]), claude, config: {} })).rejects.toThrow("unknown node");
  });
});

// ─── File skill tests ────────────────────────────────────────────

describe("file skill", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = freshDir("fileskill");
  });

  it("reads and writes JSON", async () => {
    const skill = createFileSkill(outputDir);
    const write = skill.tools.find((t) => t.name === "fs_write_json")!;
    const read = skill.tools.find((t) => t.name === "fs_read_json")!;

    const ctx: any = { config: {}, logger: console };
    await write.handler({ path: "test.json", data: { hello: "world" } }, ctx);

    const result = await read.handler({ path: "test.json" }, ctx);
    expect(result).toEqual({ hello: "world" });
  });

  it("writes markdown", async () => {
    const skill = createFileSkill(outputDir);
    const write = skill.tools.find((t) => t.name === "fs_write_markdown")!;

    const ctx: any = { config: {}, logger: console };
    await write.handler({ path: "issues/ISSUE-1.md", content: "# Bug\n\nSomething broke" }, ctx);

    const content = readFileSync(path.join(outputDir, "issues/ISSUE-1.md"), "utf-8");
    expect(content).toContain("# Bug");
  });

  it("creates nested directories", async () => {
    const skill = createFileSkill(outputDir);
    const write = skill.tools.find((t) => t.name === "fs_write_json")!;

    const ctx: any = { config: {}, logger: console };
    await write.handler({ path: "deep/nested/file.json", data: { ok: true } }, ctx);

    expect(existsSync(path.join(outputDir, "deep/nested/file.json"))).toBe(true);
  });
});

// ─── Skill instruction injection tests ──────────────────────────

describe("skill instruction injection", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = freshDir("skill-inject");
  });

  it("injects skill instructions into the prompt", async () => {
    const instructionSkill: Skill = {
      id: "code-standards",
      name: "Code Standards",
      description: "Team conventions",
      category: "general",
      config: {},
      tools: [],
      instruction: "Always use camelCase for variable names.",
    };

    const workflow: Workflow = {
      id: "test-inject",
      name: "Inject Test",
      description: "",
      entry: "step",
      nodes: {
        step: {
          name: "Do Work",
          instruction: "Write some code.",
          skills: ["code-standards"],
        },
      },
      edges: [],
    };

    let capturedInstruction = "";
    const claude: Claude = {
      async run(opts) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "";
      },
    };

    await execute(
      workflow,
      {},
      {
        skills: createSkillMap([instructionSkill]),
        claude,
        config: {},
      },
    );

    expect(capturedInstruction).toContain("## Skill: Code Standards");
    expect(capturedInstruction).toContain("Always use camelCase for variable names.");
    expect(capturedInstruction).toContain("Write some code.");
  });

  it("injects multiple skill instructions in array order", async () => {
    const skillA: Skill = {
      id: "skill-a",
      name: "Skill A",
      description: "First",
      category: "general",
      config: {},
      tools: [],
      instruction: "AAA instruction",
    };
    const skillB: Skill = {
      id: "skill-b",
      name: "Skill B",
      description: "Second",
      category: "general",
      config: {},
      tools: [],
      instruction: "BBB instruction",
    };

    const workflow: Workflow = {
      id: "test-multi",
      name: "Multi Inject",
      description: "",
      entry: "step",
      nodes: {
        step: {
          name: "Work",
          instruction: "Do the work.",
          skills: ["skill-a", "skill-b"],
        },
      },
      edges: [],
    };

    let capturedInstruction = "";
    const claude: Claude = {
      async run(opts) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "";
      },
    };

    await execute(
      workflow,
      {},
      {
        skills: createSkillMap([skillA, skillB]),
        claude,
        config: {},
      },
    );

    const posA = capturedInstruction.indexOf("AAA instruction");
    const posB = capturedInstruction.indexOf("BBB instruction");
    const posBase = capturedInstruction.indexOf("Do the work.");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posBase);
  });

  it("allows instruction-only nodes (no tools, no error)", async () => {
    const instructionSkill: Skill = {
      id: "rubric",
      name: "Evaluation Rubric",
      description: "Scoring criteria",
      category: "general",
      config: {},
      tools: [],
      instruction: "Score quality 1-5.",
    };

    const workflow: Workflow = {
      id: "test-notools",
      name: "No Tools",
      description: "",
      entry: "judge",
      nodes: {
        judge: {
          name: "Judge",
          instruction: "Evaluate the output.",
          skills: ["rubric"],
        },
      },
      edges: [],
    };

    const claude: Claude = {
      async run() {
        return { status: "success", data: { score: 4 }, toolCalls: [] };
      },
      async evaluate() {
        return "";
      },
    };

    // Should NOT throw "none are configured"
    const { results } = await execute(
      workflow,
      {},
      {
        skills: createSkillMap([instructionSkill]),
        claude,
        config: {},
      },
    );
    expect(results.get("judge")?.status).toBe("success");
  });
});
