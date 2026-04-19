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

    it("marks node failed when all_tools_called missing a required tool", async () => {
      const wf: Workflow = {
        id: "wf",
        name: "wf",
        description: "",
        entry: "n",
        nodes: {
          n: {
            name: "N",
            instruction: "Do",
            skills: [],
            verify: { all_tools_called: ["a", "b"] },
          },
        },
        edges: [],
      };
      const claude: any = {
        async run() {
          return {
            status: "success",
            data: {},
            toolCalls: [{ tool: "a", input: {}, output: { ok: true } }],
          };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };
      const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {} });
      const r = results.get("n")!;
      expect(r.status).toBe("failed");
      expect(r.data.error).toMatch(/verify failed.*all_tools_called.*\[b\]/s);
    });

    it("marks node failed when no_tool_called was violated", async () => {
      const wf: Workflow = {
        id: "wf",
        name: "wf",
        description: "",
        entry: "n",
        nodes: {
          n: {
            name: "N",
            instruction: "Do",
            skills: [],
            verify: { no_tool_called: ["force_push"] },
          },
        },
        edges: [],
      };
      const claude: any = {
        async run() {
          return {
            status: "success",
            data: {},
            toolCalls: [{ tool: "force_push", input: {}, output: { ok: true } }],
          };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };
      const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {} });
      const r = results.get("n")!;
      expect(r.status).toBe("failed");
      expect(r.data.error).toMatch(/verify failed.*no_tool_called.*force_push/s);
    });

    it("marks node failed when output_required is missing", async () => {
      const wf: Workflow = {
        id: "wf",
        name: "wf",
        description: "",
        entry: "n",
        nodes: {
          n: {
            name: "N",
            instruction: "Do",
            skills: [],
            verify: { output_required: ["prUrl"] },
          },
        },
        edges: [],
      };
      const claude: any = {
        async run() {
          return { status: "success", data: { branch: "main" }, toolCalls: [] };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };
      const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {} });
      const r = results.get("n")!;
      expect(r.status).toBe("failed");
      expect(r.data.error).toMatch(/verify failed.*output_required.*'prUrl'/s);
    });

    it("marks node failed when output_matches assertion fails", async () => {
      const wf: Workflow = {
        id: "wf",
        name: "wf",
        description: "",
        entry: "n",
        nodes: {
          n: {
            name: "N",
            instruction: "Do",
            skills: [],
            verify: { output_matches: [{ path: "branch", matches: "^sweny/" }] },
          },
        },
        edges: [],
      };
      const claude: any = {
        async run() {
          return { status: "success", data: { branch: "main" }, toolCalls: [] };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };
      const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {} });
      const r = results.get("n")!;
      expect(r.status).toBe("failed");
      expect(r.data.error).toMatch(/verify failed.*output_matches.*'branch'/s);
    });

    it("aggregates multiple verify failures into one error string", async () => {
      const wf: Workflow = {
        id: "wf",
        name: "wf",
        description: "",
        entry: "n",
        nodes: {
          n: {
            name: "N",
            instruction: "Do",
            skills: [],
            verify: {
              all_tools_called: ["create_pr"],
              output_required: ["prUrl"],
            },
          },
        },
        edges: [],
      };
      const claude: any = {
        async run() {
          return { status: "success", data: {}, toolCalls: [] };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };
      const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {} });
      const r = results.get("n")!;
      expect(r.status).toBe("failed");
      expect(r.data.error).toMatch(/all_tools_called/);
      expect(r.data.error).toMatch(/output_required/);
    });

    it("passes a node when every declared check passes", async () => {
      const wf: Workflow = {
        id: "wf",
        name: "wf",
        description: "",
        entry: "n",
        nodes: {
          n: {
            name: "N",
            instruction: "Do",
            skills: [],
            verify: {
              all_tools_called: ["create_pr"],
              no_tool_called: ["force_push"],
              output_required: ["prUrl"],
              output_matches: [{ path: "prUrl", matches: "^https://" }],
            },
          },
        },
        edges: [],
      };
      const claude: any = {
        async run() {
          return {
            status: "success",
            data: { prUrl: "https://github.com/x/y/pull/1" },
            toolCalls: [{ tool: "create_pr", input: {}, output: { ok: true } }],
          };
        },
        async evaluate(opts: any) {
          return opts.choices[0]?.id;
        },
      };
      const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {} });
      const r = results.get("n")!;
      expect(r.status).toBe("success");
      expect(r.data.error).toBeUndefined();
    });
  });

  describe("requires (pre-conditions)", () => {
    it("fails the node and skips the LLM when output_required is missing", async () => {
      const workflow: Workflow = {
        id: "req-fail",
        name: "Req Fail",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            requires: { output_required: ["input.missing"] },
          },
        },
        edges: [],
      };
      const claude = new MockClaude({
        responses: { a: { data: { ran: true } } },
        workflow,
      });
      const { results } = await execute(
        workflow,
        { other: 1 },
        {
          skills: createSkillMap([]),
          claude,
        },
      );
      const a = results.get("a")!;
      expect(a.status).toBe("failed");
      expect(a.data.error).toMatch(/^requires failed:/);
      expect(a.data.error).toMatch(/'input\.missing'/);
      expect(claude.executedNodes).toEqual([]); // LLM never ran
    });

    it("skips the node when on_fail: 'skip' and requires fails", async () => {
      const workflow: Workflow = {
        id: "req-skip",
        name: "Req Skip",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            requires: { output_required: ["input.missing"], on_fail: "skip" },
          },
        },
        edges: [],
      };
      const claude = new MockClaude({ responses: { a: { data: {} } }, workflow });
      const { results } = await execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude,
        },
      );
      const a = results.get("a")!;
      expect(a.status).toBe("skipped");
      expect(a.data.skipped_reason).toMatch(/requires not met/);
      expect(claude.executedNodes).toEqual([]);
    });

    it("runs the LLM when requires passes", async () => {
      const workflow: Workflow = {
        id: "req-pass",
        name: "Req Pass",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            requires: { output_required: ["input.x"] },
          },
        },
        edges: [],
      };
      const claude = new MockClaude({ responses: { a: { data: { ran: true } } }, workflow });
      const { results } = await execute(
        workflow,
        { x: 1 },
        {
          skills: createSkillMap([]),
          claude,
        },
      );
      expect(results.get("a")!.status).toBe("success");
      expect(claude.executedNodes).toEqual(["a"]);
    });

    it("resolves cross-node paths against prior node data", async () => {
      const workflow: Workflow = {
        id: "req-cross",
        name: "Req Cross",
        description: "",
        entry: "a",
        nodes: {
          a: { name: "A", instruction: "Do A", skills: [] },
          b: {
            name: "B",
            instruction: "Do B",
            skills: [],
            requires: { output_required: ["a.handle"] },
          },
        },
        edges: [{ from: "a", to: "b" }],
      };
      const claude = new MockClaude({
        responses: {
          a: { data: { handle: "ok" } },
          b: { data: { ran: true } },
        },
        workflow,
      });
      const { results } = await execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude,
        },
      );
      expect(results.get("b")!.status).toBe("success");
    });
  });

  describe("retry on verify failure", () => {
    it("retries with default preamble and succeeds on second attempt", async () => {
      const workflow: Workflow = {
        id: "retry-default",
        name: "Retry Default",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 1 },
          },
        },
        edges: [],
      };

      let callCount = 0;
      const claude: any = {
        run: async (opts: { instruction: string }) => {
          callCount++;
          if (callCount === 1) return { status: "success", data: {}, toolCalls: [] };
          // Second call sees the retry preamble in the instruction
          expect(opts.instruction).toMatch(/Previous attempt failed verification/);
          return { status: "success", data: { done: true }, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async () => "",
      };

      const { results } = await execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude,
        },
      );
      expect(callCount).toBe(2);
      const a = results.get("a")!;
      expect(a.status).toBe("success");
      expect(a.data.done).toBe(true);
    });

    it("marks failed and stops after retry exhaustion", async () => {
      const workflow: Workflow = {
        id: "retry-exhaust",
        name: "Retry Exhaust",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 2 },
          },
        },
        edges: [],
      };

      let callCount = 0;
      const claude: any = {
        run: async () => {
          callCount++;
          return { status: "success", data: {}, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async () => "",
      };

      const { results } = await execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude,
        },
      );
      expect(callCount).toBe(3); // initial + 2 retries
      const a = results.get("a")!;
      expect(a.status).toBe("failed");
      expect(a.data.error).toMatch(/output_required/);
    });

    it("includes the static preamble text in the retry instruction", async () => {
      const workflow: Workflow = {
        id: "retry-static",
        name: "Retry Static",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 1, instruction: "Try harder this time." },
          },
        },
        edges: [],
      };

      const seenInstructions: string[] = [];
      const claude: any = {
        run: async (opts: { instruction: string }) => {
          seenInstructions.push(opts.instruction);
          return seenInstructions.length === 2
            ? { status: "success", data: { done: true }, toolCalls: [] }
            : { status: "success", data: {}, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async () => "",
      };

      await execute(workflow, {}, { skills: createSkillMap([]), claude });
      expect(seenInstructions[1]).toContain("Try harder this time.");
      expect(seenInstructions[1]).toContain("Previous attempt failed verification");
    });

    it("does not retry when claude.run itself fails (non-verify failure)", async () => {
      const workflow: Workflow = {
        id: "retry-no-trigger",
        name: "No Trigger",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 3 },
          },
        },
        edges: [],
      };

      let callCount = 0;
      const claude: any = {
        run: async () => {
          callCount++;
          return { status: "failed", data: { error: "API down" }, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async () => "",
      };

      const { results } = await execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude,
        },
      );
      expect(callCount).toBe(1);
      expect(results.get("a")!.status).toBe("failed");
      expect(results.get("a")!.data.error).toBe("API down");
    });
  });

  describe("retry — autonomous reflection", () => {
    it("calls claude.ask and injects reflection into the retry preamble", async () => {
      const workflow: Workflow = {
        id: "retry-auto",
        name: "Retry Auto",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Open the PR",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 1, instruction: { auto: true } },
          },
        },
        edges: [],
      };

      const askCalls: { instruction: string; context: Record<string, unknown> }[] = [];
      const seenInstructions: string[] = [];

      const claude: any = {
        run: async (opts: { instruction: string }) => {
          seenInstructions.push(opts.instruction);
          return seenInstructions.length === 2
            ? { status: "success", data: { done: true }, toolCalls: [] }
            : { status: "success", data: {}, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async (opts: { instruction: string; context: Record<string, unknown> }) => {
          askCalls.push(opts);
          return "Diagnosis: missing the create_pr tool. Strategy: call it before returning.";
        },
      };

      await execute(workflow, {}, { skills: createSkillMap([]), claude });
      expect(askCalls).toHaveLength(1);
      expect(askCalls[0].instruction).toContain("Open the PR");
      expect(askCalls[0].instruction).toMatch(/Briefly diagnose/);
      expect(seenInstructions[1]).toContain("Diagnosis: missing the create_pr tool");
    });

    it("falls back to default preamble when claude.ask throws", async () => {
      const workflow: Workflow = {
        id: "retry-auto-fallback",
        name: "Retry Auto Fallback",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Open the PR",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 1, instruction: { auto: true } },
          },
        },
        edges: [],
      };

      const seenInstructions: string[] = [];
      const claude: any = {
        run: async (opts: { instruction: string }) => {
          seenInstructions.push(opts.instruction);
          return seenInstructions.length === 2
            ? { status: "success", data: { done: true }, toolCalls: [] }
            : { status: "success", data: {}, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async () => {
          throw new Error("network down");
        },
      };

      await execute(workflow, {}, { skills: createSkillMap([]), claude });
      expect(seenInstructions[1]).toMatch(/Previous attempt failed verification/);
    });

    it("uses the author's reflect prompt when instruction.reflect is set", async () => {
      const workflow: Workflow = {
        id: "retry-reflect",
        name: "Retry Reflect",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Open the PR",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 1, instruction: { reflect: "Focus on tool selection only." } },
          },
        },
        edges: [],
      };

      const askCalls: { instruction: string }[] = [];
      const claude: any = {
        run: async () => ({ status: "success", data: { done: true }, toolCalls: [] }),
        evaluate: async () => "x",
        ask: async (opts: { instruction: string; context: Record<string, unknown> }) => {
          askCalls.push(opts);
          return "diagnosis";
        },
      };

      // First call deliberately fails verify (output_required missing) to trigger ask.
      let callCount = 0;
      claude.run = async () => {
        callCount++;
        return callCount === 1
          ? { status: "success", data: {}, toolCalls: [] }
          : { status: "success", data: { done: true }, toolCalls: [] };
      };

      await execute(workflow, {}, { skills: createSkillMap([]), claude });
      expect(askCalls).toHaveLength(1);
      expect(askCalls[0].instruction).toContain("Focus on tool selection only.");
    });
  });

  describe("retry — trace and observer", () => {
    it("records each retry attempt as its own TraceStep with retryAttempt", async () => {
      const workflow: Workflow = {
        id: "retry-trace",
        name: "Retry Trace",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 2 },
          },
        },
        edges: [],
      };

      let callCount = 0;
      const claude: any = {
        run: async () => {
          callCount++;
          return callCount === 3
            ? { status: "success", data: { done: true }, toolCalls: [] }
            : { status: "success", data: {}, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async () => "",
      };

      const { trace } = await execute(workflow, {}, { skills: createSkillMap([]), claude });
      const aSteps = trace.steps.filter((s) => s.node === "a");
      expect(aSteps).toHaveLength(3);
      expect(aSteps[0]).toMatchObject({ node: "a", status: "failed", iteration: 1, retryAttempt: 0 });
      expect(aSteps[1]).toMatchObject({ node: "a", status: "failed", iteration: 1, retryAttempt: 1 });
      expect(aSteps[2]).toMatchObject({ node: "a", status: "success", iteration: 1, retryAttempt: 2 });
    });

    it("emits node:retry observer events with attempt and preamble", async () => {
      const workflow: Workflow = {
        id: "retry-observer",
        name: "Retry Observer",
        description: "",
        entry: "a",
        nodes: {
          a: {
            name: "A",
            instruction: "Do A",
            skills: [],
            verify: { output_required: ["done"] },
            retry: { max: 1 },
          },
        },
        edges: [],
      };

      const events: ExecutionEvent[] = [];
      let callCount = 0;
      const claude: any = {
        run: async () => {
          callCount++;
          return callCount === 2
            ? { status: "success", data: { done: true }, toolCalls: [] }
            : { status: "success", data: {}, toolCalls: [] };
        },
        evaluate: async () => "x",
        ask: async () => "",
      };

      await execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude,
          observer: (e) => events.push(e),
        },
      );

      const retryEvents = events.filter((e) => e.type === "node:retry");
      expect(retryEvents).toHaveLength(1);
      const evt = retryEvents[0] as Extract<ExecutionEvent, { type: "node:retry" }>;
      expect(evt.node).toBe("a");
      expect(evt.attempt).toBe(1);
      expect(evt.preamble).toMatch(/Previous attempt failed verification/);
      expect(evt.reason).toMatch(/output_required/);
    });

    it("omits retryAttempt on TraceStep when no retry fires", async () => {
      const workflow: Workflow = {
        id: "no-retry",
        name: "No Retry",
        description: "",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do A", skills: [] } },
        edges: [],
      };
      const claude = new MockClaude({ responses: { a: { data: { ok: true } } }, workflow });
      const { trace } = await execute(workflow, {}, { skills: createSkillMap([]), claude });
      expect(trace.steps[0].retryAttempt).toBeUndefined();
    });
  });
});
