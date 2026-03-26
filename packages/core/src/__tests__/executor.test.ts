import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { execute } from "../executor.js";
import type { Workflow, ExecutionEvent } from "../types.js";
import { MockClaude, createFileSkill } from "../testing.js";
import { createSkillMap } from "../skills/index.js";

// ─── Fixtures ────────────────────────────────────────────────────

const tmpBase = path.join(tmpdir(), "sweny-executor-test");

function freshDir(name: string): string {
  const dir = path.join(tmpBase, `${name}-${Date.now()}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

const linearWorkflow: Workflow = {
  id: "linear",
  name: "Linear",
  description: "A→B→C",
  entry: "a",
  nodes: {
    a: { name: "A", instruction: "Do A", skills: ["filesystem"] },
    b: { name: "B", instruction: "Do B", skills: ["filesystem"] },
    c: { name: "C", instruction: "Do C", skills: ["filesystem"] },
  },
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

const branchingWorkflow: Workflow = {
  id: "branching",
  name: "Branching",
  description: "A → B or C",
  entry: "check",
  nodes: {
    check: { name: "Check", instruction: "Check severity", skills: [] },
    high: { name: "High", instruction: "Handle high", skills: [] },
    low: { name: "Low", instruction: "Handle low", skills: [] },
  },
  edges: [
    { from: "check", to: "high", when: "severity is high" },
    { from: "check", to: "low", when: "severity is low" },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────

describe("executor", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = freshDir("exec");
  });

  it("executes a linear workflow end-to-end", async () => {
    const fileSkill = createFileSkill(outputDir);
    writeFileSync(path.join(outputDir, "input.json"), JSON.stringify({ alert: "test" }));

    const claude = new MockClaude({
      responses: {
        a: {
          toolCalls: [{ tool: "fs_read_json", input: { path: "input.json" } }],
          data: { context: "loaded" },
        },
        b: { data: { processed: true } },
        c: {
          toolCalls: [{ tool: "fs_write_json", input: { path: "out.json", data: { done: true } } }],
          data: { written: true },
        },
      },
    });

    const events: ExecutionEvent[] = [];
    const results = await execute(
      linearWorkflow,
      { alert: "test" },
      {
        skills: createSkillMap([fileSkill]),
        claude,
        observer: (e) => events.push(e),
        config: {},
      },
    );

    expect(results.size).toBe(3);
    expect(results.get("a")?.status).toBe("success");
    expect(results.get("b")?.status).toBe("success");
    expect(results.get("c")?.status).toBe("success");

    // Verify file was written
    expect(existsSync(path.join(outputDir, "out.json"))).toBe(true);

    // Events
    expect(events[0]).toEqual({ type: "workflow:start", workflow: "linear" });
    expect(events.filter((e) => e.type === "node:enter")).toHaveLength(3);
    expect(events[events.length - 1].type).toBe("workflow:end");
  });

  it("executes conditional branches", async () => {
    const claude = new MockClaude({
      workflow: branchingWorkflow,
      responses: {
        check: { data: { severity: "high" } },
        high: { data: { handled: true } },
      },
      routes: { check: "high" },
    });

    const results = await execute(
      branchingWorkflow,
      { alert: "cpu" },
      {
        skills: createSkillMap([]),
        claude,
        config: {},
      },
    );

    expect(results.size).toBe(2);
    expect(results.has("check")).toBe(true);
    expect(results.has("high")).toBe(true);
    expect(results.has("low")).toBe(false);
  });

  it("routes to alternative branch", async () => {
    const claude = new MockClaude({
      workflow: branchingWorkflow,
      responses: {
        check: { data: { severity: "low" } },
        low: { data: { skipped: true } },
      },
      routes: { check: "low" },
    });

    const results = await execute(
      branchingWorkflow,
      { alert: "minor" },
      {
        skills: createSkillMap([]),
        claude,
        config: {},
      },
    );

    expect(results.size).toBe(2);
    expect(results.has("low")).toBe(true);
    expect(results.has("high")).toBe(false);
  });

  it("emits tool:call and tool:result events", async () => {
    const fileSkill = createFileSkill(outputDir);
    writeFileSync(path.join(outputDir, "data.json"), '{"key": "value"}');

    const claude = new MockClaude({
      responses: {
        a: {
          toolCalls: [{ tool: "fs_read_json", input: { path: "data.json" } }],
          data: { read: true },
        },
        b: { data: {} },
        c: { data: {} },
      },
    });

    const events: ExecutionEvent[] = [];
    await execute(
      linearWorkflow,
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
    expect(toolCalls[0]).toMatchObject({ type: "tool:call", node: "a", tool: "fs_read_json" });
  });

  it("observer errors do not crash the workflow", async () => {
    const claude = new MockClaude({
      responses: {
        a: { data: {} },
        b: { data: {} },
        c: { data: {} },
      },
    });

    const results = await execute(
      linearWorkflow,
      {},
      {
        skills: createSkillMap([]),
        claude,
        observer: () => {
          throw new Error("observer boom");
        },
        config: {},
      },
    );

    // Workflow completed despite observer throwing
    expect(results.size).toBe(3);
  });

  it("throws on missing entry node", async () => {
    const bad: Workflow = { ...linearWorkflow, entry: "nonexistent" };
    const claude = new MockClaude({ responses: {} });

    await expect(execute(bad, {}, { skills: createSkillMap([]), claude, config: {} })).rejects.toThrow("Entry node");
  });

  it("throws on invalid edge reference", async () => {
    const bad: Workflow = {
      ...linearWorkflow,
      edges: [
        { from: "a", to: "ghost" },
        { from: "a", to: "b" },
      ],
    };
    const claude = new MockClaude({ responses: {} });

    await expect(execute(bad, {}, { skills: createSkillMap([]), claude, config: {} })).rejects.toThrow("unknown node");
  });

  it("handles single-node workflow (entry = terminal)", async () => {
    const singleNode: Workflow = {
      id: "single",
      name: "Single",
      description: "",
      entry: "only",
      nodes: { only: { name: "Only", instruction: "Do it", skills: [] } },
      edges: [],
    };

    const claude = new MockClaude({
      responses: { only: { data: { result: "done" } } },
    });

    const results = await execute(
      singleNode,
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
      },
    );

    expect(results.size).toBe(1);
    expect(results.get("only")?.data.result).toBe("done");
  });

  it("passes prior node results as context", async () => {
    let capturedContext: Record<string, unknown> = {};

    const mockClaude: any = {
      async run(opts: any) {
        capturedContext = opts.context;
        return { status: "success", data: { step: "done" }, toolCalls: [] };
      },
      async evaluate(opts: any) {
        return opts.choices[0].id;
      },
    };

    const twoStep: Workflow = {
      id: "two",
      name: "Two",
      description: "",
      entry: "first",
      nodes: {
        first: { name: "First", instruction: "First step", skills: [] },
        second: { name: "Second", instruction: "Second step", skills: [] },
      },
      edges: [{ from: "first", to: "second" }],
    };

    await execute(
      twoStep,
      { original: true },
      {
        skills: createSkillMap([]),
        claude: mockClaude,
        config: {},
      },
    );

    // Second node should have first node's result in context
    expect(capturedContext).toHaveProperty("first");
    expect(capturedContext).toHaveProperty("input");
  });

  it("resolves config from env vars and overrides", async () => {
    // This tests that config resolution works (skill with required config)
    const skillWithConfig: any = {
      id: "needs-config",
      name: "Needs Config",
      description: "test",
      config: {
        MY_KEY: { description: "A key", required: true, env: "MY_KEY_ENV" },
      },
      tools: [],
    };

    const claude = new MockClaude({
      responses: { a: { data: {} }, b: { data: {} }, c: { data: {} } },
    });

    // Should throw without config
    await expect(
      execute(
        linearWorkflow,
        {},
        {
          skills: createSkillMap([skillWithConfig]),
          claude,
        },
      ),
    ).rejects.toThrow("Missing required config");

    // Should succeed with override
    const results = await execute(
      linearWorkflow,
      {},
      {
        skills: createSkillMap([skillWithConfig]),
        claude,
        config: { MY_KEY: "provided" },
      },
    );
    expect(results.size).toBe(3);
  });

  it("handles failed node results", async () => {
    const claude = new MockClaude({
      responses: {
        a: { status: "failed", data: { error: "something broke" } },
        b: { data: {} },
        c: { data: {} },
      },
    });

    const results = await execute(
      linearWorkflow,
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
      },
    );

    // All nodes still execute (executor doesn't short-circuit on failure)
    expect(results.get("a")?.status).toBe("failed");
  });

  it("validates route choice falls back on invalid Claude response", async () => {
    // Create a claude mock that returns an invalid route
    const badRouteClaude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "nonexistent_node"; // invalid target
      },
    };

    const results = await execute(
      branchingWorkflow,
      {},
      {
        skills: createSkillMap([]),
        claude: badRouteClaude,
        config: {},
      },
    );

    // Should still complete — falls back to first valid edge target
    expect(results.size).toBe(2);
  });
});
