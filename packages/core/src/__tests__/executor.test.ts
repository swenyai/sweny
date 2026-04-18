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

/** Same shape as linearWorkflow but with no skill requirements — for tests that
 *  don't exercise tool usage and just need a 3-node DAG. */
const skilllessWorkflow: Workflow = {
  ...linearWorkflow,
  id: "linear-no-skills",
  nodes: {
    a: { name: "A", instruction: "Do A", skills: [] },
    b: { name: "B", instruction: "Do B", skills: [] },
    c: { name: "C", instruction: "Do C", skills: [] },
  },
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
    const { results } = await execute(
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

    // Events — workflow:start fires first, then sources:resolved (per spec)
    expect(events[0]).toEqual({ type: "workflow:start", workflow: "linear" });
    expect(events[1].type).toBe("sources:resolved");
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

    const { results } = await execute(
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

    const { results } = await execute(
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

    const { results } = await execute(
      skilllessWorkflow,
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

    const { results } = await execute(
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

    // Should throw without config (uses skilllessWorkflow — no skill requirements on nodes)
    await expect(
      execute(
        skilllessWorkflow,
        {},
        {
          skills: createSkillMap([skillWithConfig]),
          claude,
        },
      ),
    ).rejects.toThrow("Missing required config");

    // Should succeed with override
    const { results } = await execute(
      skilllessWorkflow,
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

    const { results } = await execute(
      skilllessWorkflow,
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

  it("executes a retry loop with max_iterations", async () => {
    const retryWorkflow: Workflow = {
      id: "retry",
      name: "Retry",
      description: "A→B→A (retry once)→B→C",
      entry: "extract",
      nodes: {
        extract: { name: "Extract", instruction: "Extract data", skills: [] },
        judge: { name: "Judge", instruction: "Judge quality", skills: [] },
        done: { name: "Done", instruction: "Finish", skills: [] },
      },
      edges: [
        { from: "extract", to: "judge" },
        { from: "judge", to: "extract", when: "quality is low", max_iterations: 1 },
        { from: "judge", to: "done", when: "quality is high or retries exhausted" },
      ],
    };

    // Track how many times each node runs
    let extractCount = 0;
    let judgeCount = 0;

    const mockClaude: any = {
      async run(opts: any) {
        if (opts.instruction.includes("Extract")) {
          extractCount++;
          return { status: "success", data: { extracted: true, attempt: extractCount }, toolCalls: [] };
        }
        if (opts.instruction.includes("Judge")) {
          judgeCount++;
          // First judge: low quality (triggers retry). Second judge: still low but edge exhausted.
          return { status: "success", data: { quality: "low" }, toolCalls: [] };
        }
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(opts: any) {
        // Always try to route to extract (retry), but max_iterations will block it on 2nd attempt
        const retryChoice = opts.choices.find((c: any) => c.id === "extract");
        if (retryChoice) return "extract";
        return opts.choices[0].id;
      },
    };

    const { results, trace } = await execute(
      retryWorkflow,
      {},
      { skills: createSkillMap([]), claude: mockClaude, config: {} },
    );

    // extract ran twice (initial + 1 retry), judge ran twice, done ran once
    expect(extractCount).toBe(2);
    expect(judgeCount).toBe(2);
    expect(results.has("done")).toBe(true);
    // The second extract result overwrites the first
    expect(results.get("extract")?.data.attempt).toBe(2);

    // Trace captures the full execution path including loops
    expect(trace.steps).toHaveLength(5); // extract, judge, extract(retry), judge, done
    expect(trace.steps[0]).toEqual({ node: "extract", status: "success", iteration: 1 });
    expect(trace.steps[2]).toEqual({ node: "extract", status: "success", iteration: 2 });
    // Trace edges include the retry loop
    const retryEdge = trace.edges.find((e) => e.from === "judge" && e.to === "extract");
    expect(retryEdge).toBeDefined();
  });

  it("respects max_iterations=1 as single retry", async () => {
    const singleRetry: Workflow = {
      id: "single-retry",
      name: "Single Retry",
      description: "A↔B with max 1 loop",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Step A", skills: [] },
        b: { name: "B", instruction: "Step B", skills: [] },
        end: { name: "End", instruction: "End", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", when: "retry", max_iterations: 1 },
        { from: "b", to: "end", when: "done" },
      ],
    };

    let aCount = 0;

    const mockClaude: any = {
      async run(opts: any) {
        if (opts.instruction.includes("Step A")) aCount++;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(opts: any) {
        // Always try to loop back
        const retry = opts.choices.find((c: any) => c.id === "a");
        if (retry) return "a";
        return opts.choices[0].id;
      },
    };

    const { results } = await execute(singleRetry, {}, { skills: createSkillMap([]), claude: mockClaude, config: {} });

    // A runs twice (once initially, once via retry), then edge is exhausted → falls to "end"
    expect(aCount).toBe(2);
    expect(results.has("end")).toBe(true);
  });

  it("throws when a node with required skills is reached but none are configured", async () => {
    const workflowWithSkills: Workflow = {
      id: "needs-linear",
      name: "Needs Linear",
      description: "A→B where B needs linear skill",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Create a Linear issue", skills: ["linear"] },
      },
      edges: [{ from: "a", to: "b" }],
    };

    const claude = new MockClaude({
      responses: {
        a: { data: { done: true } },
        b: { data: {} },
      },
    });

    // No linear skill in the map — should throw when node B is reached
    await expect(execute(workflowWithSkills, {}, { skills: createSkillMap([]), claude, config: {} })).rejects.toThrow(
      'Node "b" requires skills [linear] but none are configured',
    );
  });

  it("does not throw for unreachable nodes with missing skills", async () => {
    const workflowWithUnreachable: Workflow = {
      id: "unreachable-skill",
      name: "Unreachable Skill",
      description: "A→C, B needs linear but is never reached",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Create issue", skills: ["linear"] },
        c: { name: "C", instruction: "Do C", skills: [] },
      },
      edges: [
        { from: "a", to: "c" },
        { from: "a", to: "b", when: "needs escalation" },
      ],
    };

    const claude = new MockClaude({
      responses: {
        a: { data: {} },
        c: { data: {} },
      },
      routes: { a: "c" },
    });

    // Node B is never reached, so missing linear skill should not cause a throw
    const { results } = await execute(workflowWithUnreachable, {}, { skills: createSkillMap([]), claude, config: {} });
    expect(results.has("a")).toBe(true);
    expect(results.has("c")).toBe(true);
    expect(results.has("b")).toBe(false);
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

    const { results } = await execute(
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

  describe("node.verify", () => {
    // Context: a create_issue node can satisfy its output schema (issueIdentifier
    // present) while never actually calling the Linear/GitHub create-issue tool.
    // The verify block catches this by requiring a real, successful tool call.
    const verifyWorkflow: Workflow = {
      id: "verify-create-issue",
      name: "Verify Create Issue",
      description: "Single node that must call linear_create_issue",
      entry: "create",
      nodes: {
        create: {
          name: "Create",
          instruction: "Create an issue",
          skills: [],
          verify: { any_tool_called: ["linear_create_issue", "github_create_issue"] },
        },
      },
      edges: [],
    };

    it("marks node failed when required tool was never called", async () => {
      const claude: any = {
        async run() {
          return {
            status: "success",
            data: { issueIdentifier: "OFF-9999", issueTitle: "hallucinated", issueUrl: "https://" },
            toolCalls: [{ tool: "linear_search_issues", input: {}, output: [] }],
          };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };

      const { results } = await execute(verifyWorkflow, {}, { skills: createSkillMap([]), claude, config: {} });
      const r = results.get("create")!;
      expect(r.status).toBe("failed");
      expect(r.data.error).toMatch(/verify failed:.*any_tool_called/s);
      expect(r.data.error).toMatch(/linear_create_issue/);
    });

    it("marks node failed when required tool erred (output.error set)", async () => {
      const claude: any = {
        async run() {
          return {
            status: "success",
            data: { issueIdentifier: "OFF-9999" },
            toolCalls: [{ tool: "linear_create_issue", input: {}, output: { error: "Linear API 403" } }],
          };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };

      const { results } = await execute(verifyWorkflow, {}, { skills: createSkillMap([]), claude, config: {} });
      expect(results.get("create")!.status).toBe("failed");
    });

    it("passes when a required tool was invoked successfully", async () => {
      const claude: any = {
        async run() {
          return {
            status: "success",
            data: { issueIdentifier: "OFF-1234" },
            toolCalls: [
              {
                tool: "linear_create_issue",
                input: { title: "t" },
                output: { issueCreate: { success: true, issue: { identifier: "OFF-1234" } } },
              },
            ],
          };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };

      const { results } = await execute(verifyWorkflow, {}, { skills: createSkillMap([]), claude, config: {} });
      expect(results.get("create")!.status).toBe("success");
    });

    it("leaves already-failed nodes alone (does not overwrite Claude errors)", async () => {
      const claude: any = {
        async run() {
          return { status: "failed", data: { error: "max_turns" }, toolCalls: [] };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };

      const { results } = await execute(verifyWorkflow, {}, { skills: createSkillMap([]), claude, config: {} });
      expect(results.get("create")!.status).toBe("failed");
      expect(results.get("create")!.data.error).toBe("max_turns");
    });
  });
});
