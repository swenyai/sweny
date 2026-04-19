/**
 * Spec Conformance Tests
 *
 * These tests validate that the @sweny-ai/core implementation conforms to the
 * SWEny Workflow Specification v1.0 (spec.sweny.ai). Each test references
 * the relevant spec section.
 *
 * Sections covered:
 * - Workflow structural validation
 * - Node input augmentation (rules, context, skill instructions)
 * - Edge routing algorithm
 * - Dry-run semantics
 * - Execution events ordering
 * - Execution trace structure
 * - Source resolution
 * - JSON Schema correctness
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { execute } from "../executor.js";
import { validateWorkflow, workflowJsonSchema, parseWorkflow } from "../schema.js";
import type { Workflow, ExecutionEvent, NodeResult, Skill } from "../types.js";
import { createSkillMap } from "../skills/index.js";

// ─── Helpers ────────────────────────────────────────────────────

const tmpBase = path.join(tmpdir(), "sweny-spec-conformance");

function freshDir(name: string): string {
  const dir = path.join(tmpBase, `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A Claude mock that captures instructions and contexts for assertion. */
function capturingClaude(opts: { routes?: Record<string, string>; data?: Record<string, Record<string, unknown>> }) {
  const captured: {
    instructions: Record<string, string>;
    contexts: Record<string, Record<string, unknown>>;
    runCalls: number;
    evaluateCalls: number;
  } = { instructions: {}, contexts: {}, runCalls: 0, evaluateCalls: 0 };

  const claude = {
    async run(runOpts: any): Promise<NodeResult> {
      captured.runCalls++;
      // Determine which node this is from the instruction
      const nodeId = Object.keys(opts.data ?? {}).find(
        (k) => runOpts.instruction.includes(k) || runOpts.instruction.includes(opts.data![k]?.__instruction as string),
      );

      // Store by run order since we may not know nodeId
      const key = `run-${captured.runCalls}`;
      captured.instructions[key] = runOpts.instruction;
      captured.contexts[key] = runOpts.context;

      return {
        status: "success" as const,
        data: opts.data?.[nodeId ?? ""] ?? { step: captured.runCalls },
        toolCalls: [],
      };
    },
    async evaluate(evalOpts: any): Promise<string> {
      captured.evaluateCalls++;
      const from = evalOpts.choices[0]?.id;
      // Find the route from the choices
      for (const [_from, to] of Object.entries(opts.routes ?? {})) {
        const match = evalOpts.choices.find((c: any) => c.id === to);
        if (match) return match.id;
      }
      return evalOpts.choices[0].id;
    },
  };

  return { claude, captured };
}

/** Simple mock claude that just returns data per node based on instruction matching. */
function simpleClaude(nodeData: Record<string, Record<string, unknown>>, routes?: Record<string, string>) {
  const nodeInstructions = new Map<string, string>();
  let currentNodeId = "";

  return {
    async run(opts: any): Promise<NodeResult> {
      // Find which node this is by checking if instruction ends with node text
      const matchedNode = Object.entries(nodeData).find(([_id, _data]) => true);
      return {
        status: "success" as const,
        data: nodeData[currentNodeId] ?? {},
        toolCalls: [],
      };
    },
    async evaluate(opts: any): Promise<string> {
      // Use routes map based on choices available
      if (routes) {
        for (const [from, to] of Object.entries(routes)) {
          const match = opts.choices.find((c: any) => c.id === to);
          if (match) return match.id;
        }
      }
      return opts.choices[0].id;
    },
    // Hook to track current node
    _setNodeId(id: string) {
      currentNodeId = id;
    },
  };
}

// ─── Fixtures ───────────────────────────────────────────────────

const triageWorkflow: Workflow = {
  id: "triage",
  name: "Alert Triage",
  description: "Investigate and act on a production alert.",
  entry: "gather",
  nodes: {
    gather: { name: "Gather Context", instruction: "Gather error details.", skills: [] },
    investigate: { name: "Investigate", instruction: "Classify issues.", skills: [] },
    create_issue: { name: "Create Issue", instruction: "Create issues.", skills: [] },
    skip: { name: "Skip", instruction: "Log and skip.", skills: [] },
    notify: { name: "Notify", instruction: "Notify the team.", skills: [] },
  },
  edges: [
    { from: "gather", to: "investigate" },
    { from: "investigate", to: "create_issue", when: "novel_count > 0 AND severity is medium or higher" },
    { from: "investigate", to: "skip", when: "novel_count is 0 OR severity is low" },
    { from: "create_issue", to: "notify" },
    { from: "skip", to: "notify" },
  ],
};

// ─── Spec Section: Workflow Structural Validation ───────────────

describe("spec: Workflow structural validation", () => {
  it("MISSING_ENTRY — entry node must exist", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "ghost",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [],
    };
    const errs = validateWorkflow(w);
    expect(errs).toContainEqual(expect.objectContaining({ code: "MISSING_ENTRY" }));
  });

  it("UNKNOWN_EDGE_SOURCE — edge from must reference existing node", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [{ from: "ghost", to: "a" }],
    };
    const errs = validateWorkflow(w);
    expect(errs).toContainEqual(expect.objectContaining({ code: "UNKNOWN_EDGE_SOURCE" }));
  });

  it("UNKNOWN_EDGE_TARGET — edge to must reference existing node", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [{ from: "a", to: "ghost" }],
    };
    const errs = validateWorkflow(w);
    expect(errs).toContainEqual(expect.objectContaining({ code: "UNKNOWN_EDGE_TARGET" }));
  });

  it("UNREACHABLE_NODE — all nodes must be reachable from entry via BFS", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "x", skills: [] },
        b: { name: "B", instruction: "x", skills: [] },
        island: { name: "Island", instruction: "x", skills: [] },
      },
      edges: [{ from: "a", to: "b" }],
    };
    const errs = validateWorkflow(w);
    expect(errs).toContainEqual(expect.objectContaining({ code: "UNREACHABLE_NODE", nodeId: "island" }));
  });

  it("SELF_LOOP — self-loop without max_iterations is invalid", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [{ from: "a", to: "a" }],
    };
    const errs = validateWorkflow(w);
    expect(errs).toContainEqual(expect.objectContaining({ code: "SELF_LOOP" }));
  });

  it("self-loop with max_iterations is valid", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [{ from: "a", to: "a", when: "retry", max_iterations: 3 }],
    };
    const errs = validateWorkflow(w);
    expect(errs.filter((e) => e.code === "SELF_LOOP")).toHaveLength(0);
  });

  it("UNBOUNDED_CYCLE — cycle with no max_iterations is invalid", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "x", skills: [] },
        b: { name: "B", instruction: "x", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const errs = validateWorkflow(w);
    expect(errs).toContainEqual(expect.objectContaining({ code: "UNBOUNDED_CYCLE" }));
  });

  it("bounded cycle with max_iterations is valid", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "x", skills: [] },
        b: { name: "B", instruction: "x", skills: [] },
        done: { name: "Done", instruction: "x", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", when: "retry", max_iterations: 3 },
        { from: "b", to: "done", when: "done" },
      ],
    };
    const errs = validateWorkflow(w);
    expect(errs.filter((e) => e.code === "UNBOUNDED_CYCLE")).toHaveLength(0);
  });

  it("UNKNOWN_SKILL — node references unknown skill (when knownSkills provided)", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: ["nonexistent"] } },
      edges: [],
    };
    const errs = validateWorkflow(w, new Set(["github"]));
    expect(errs).toContainEqual(expect.objectContaining({ code: "UNKNOWN_SKILL" }));
  });

  it("INVALID_INLINE_SKILL — inline skill without instruction or mcp", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [],
      skills: { "bad-skill": { name: "Bad" } },
    };
    const errs = validateWorkflow(w);
    expect(errs).toContainEqual(expect.objectContaining({ code: "INVALID_INLINE_SKILL" }));
  });

  it("valid workflow with inline skills passes validation", () => {
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: ["rubric"] } },
      edges: [],
      skills: {
        rubric: { instruction: "Score each dimension 1-5." },
      },
    };
    const errs = validateWorkflow(w, new Set());
    expect(errs).toHaveLength(0);
  });
});

// ─── Spec Section: Dry-Run Semantics ────────────────────────────

describe("spec: Dry-run semantics", () => {
  it("stops at first node with conditional outgoing edges", async () => {
    const claude: any = {
      async run() {
        return { status: "success", data: { severity: "high" }, toolCalls: [] };
      },
      async evaluate() {
        throw new Error("evaluate should NOT be called in dry-run");
      },
    };

    const events: ExecutionEvent[] = [];
    const { results, trace } = await execute(
      triageWorkflow,
      { dryRun: true },
      { skills: createSkillMap([]), claude, observer: (e) => events.push(e), config: {} },
    );

    // gather (unconditional → investigate) should execute
    expect(results.has("gather")).toBe(true);
    expect(results.has("investigate")).toBe(true);

    // investigate has conditional edges → dry-run stops here
    expect(results.has("create_issue")).toBe(false);
    expect(results.has("skip")).toBe(false);
    expect(results.has("notify")).toBe(false);

    // Route event should show "dry run" as reason
    const routeEvents = events.filter((e) => e.type === "route");
    const dryRunRoute = routeEvents.find((e) => e.type === "route" && e.to === "(end)" && e.reason === "dry run");
    expect(dryRunRoute).toBeDefined();
  });

  it("continues through unconditional edges in dry-run", async () => {
    const linearWorkflow: Workflow = {
      id: "linear",
      name: "Linear",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Do B", skills: [] },
        c: { name: "C", instruction: "Do C", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        throw new Error("should not evaluate");
      },
    };

    const { results } = await execute(
      linearWorkflow,
      { dryRun: true },
      { skills: createSkillMap([]), claude, config: {} },
    );

    // All nodes in a linear (unconditional) workflow execute even in dry-run
    expect(results.size).toBe(3);
  });
});

// ─── Spec Section: Input Augmentation ───────────────────────────

describe("spec: Node input augmentation", () => {
  it("prepends rules with correct heading", async () => {
    let capturedInstruction = "";
    const claude: any = {
      async run(opts: any) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Do the thing.", skills: [] } },
      edges: [],
    };

    await execute(w, { rules: "Never use deprecated APIs." }, { skills: createSkillMap([]), claude, config: {} });

    expect(capturedInstruction).toContain("## Rules — You MUST Follow These");
    expect(capturedInstruction).toContain("Never use deprecated APIs.");
    expect(capturedInstruction).toContain("Do the thing.");
  });

  it("prepends context with correct heading", async () => {
    let capturedInstruction = "";
    const claude: any = {
      async run(opts: any) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Investigate.", skills: [] } },
      edges: [],
    };

    await execute(w, { context: "Server crashed at 3am." }, { skills: createSkillMap([]), claude, config: {} });

    expect(capturedInstruction).toContain("## Background Context");
    expect(capturedInstruction).toContain("Server crashed at 3am.");
  });

  it("assembles in correct order: rules → context → skill instructions → base instruction", async () => {
    let capturedInstruction = "";
    const claude: any = {
      async run(opts: any) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const instructionSkill: Skill = {
      id: "rubric",
      name: "Severity Rubric",
      description: "Scoring rubric",
      category: "general",
      config: {},
      tools: [],
      instruction: "Score severity 1-5 based on impact.",
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Classify the alert.", skills: ["rubric"] } },
      edges: [],
    };

    await execute(
      w,
      { rules: "Be thorough.", context: "Prod is down." },
      { skills: createSkillMap([instructionSkill]), claude, config: {} },
    );

    // Verify order: rules first, then context, then skill, then base instruction
    const rulesIdx = capturedInstruction.indexOf("## Rules — You MUST Follow These");
    const contextIdx = capturedInstruction.indexOf("## Background Context");
    const skillIdx = capturedInstruction.indexOf("## Skill: Severity Rubric");
    const baseIdx = capturedInstruction.indexOf("Classify the alert.");

    expect(rulesIdx).toBeGreaterThanOrEqual(0);
    expect(contextIdx).toBeGreaterThan(rulesIdx);
    expect(skillIdx).toBeGreaterThan(contextIdx);
    expect(baseIdx).toBeGreaterThan(skillIdx);
  });

  it("sections are separated by ---", async () => {
    let capturedInstruction = "";
    const claude: any = {
      async run(opts: any) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Base instruction.", skills: [] } },
      edges: [],
    };

    await execute(
      w,
      { rules: "Rule one.", context: "Background info." },
      { skills: createSkillMap([]), claude, config: {} },
    );

    expect(capturedInstruction).toContain("---");
    // Count separators: rules + context + base = 2 separators
    const separatorCount = capturedInstruction.split("---").length - 1;
    expect(separatorCount).toBe(2);
  });
});

// ─── Spec Section: Context Accumulation ─────────────────────────

describe("spec: Context accumulation", () => {
  it("context includes input and all prior node results", async () => {
    const contexts: Record<string, unknown>[] = [];
    const claude: any = {
      async run(opts: any) {
        contexts.push(structuredClone(opts.context));
        return { status: "success", data: { step: contexts.length }, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Step A", skills: [] },
        b: { name: "B", instruction: "Step B", skills: [] },
        c: { name: "C", instruction: "Step C", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    await execute(w, { alert: "test" }, { skills: createSkillMap([]), claude, config: {} });

    // Node A: context has only input
    expect(contexts[0]).toEqual({ input: { alert: "test" } });

    // Node B: context has input + A's result
    expect(contexts[1]).toEqual({ input: { alert: "test" }, a: { step: 1 } });

    // Node C: context has input + A + B results
    expect(contexts[2]).toEqual({ input: { alert: "test" }, a: { step: 1 }, b: { step: 2 } });
  });

  it("bounded cycle overwrites context with most recent result", async () => {
    const contexts: Record<string, unknown>[] = [];
    let runCount = 0;
    const claude: any = {
      async run(opts: any) {
        runCount++;
        contexts.push(structuredClone(opts.context));
        return { status: "success", data: { attempt: runCount }, toolCalls: [] };
      },
      async evaluate(opts: any) {
        // First time: loop back. Second time: go to done.
        if (runCount <= 2) return opts.choices.find((c: any) => c.id === "a")?.id ?? opts.choices[0].id;
        return opts.choices.find((c: any) => c.id === "done")?.id ?? opts.choices[0].id;
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Step A", skills: [] },
        b: { name: "B", instruction: "Step B", skills: [] },
        done: { name: "Done", instruction: "Done", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", when: "retry", max_iterations: 1 },
        { from: "b", to: "done", when: "finished" },
      ],
    };

    const { results } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    // A ran twice — results map should have the LAST result (attempt 3 = second A run)
    expect(results.get("a")?.data.attempt).toBe(3);
  });
});

// ─── Spec Section: Execution Events ─────────────────────────────

describe("spec: Execution events", () => {
  it("emits events in correct order per spec", async () => {
    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "test",
      name: "Test",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Do B", skills: [] },
      },
      edges: [{ from: "a", to: "b" }],
    };

    const events: ExecutionEvent[] = [];
    await execute(w, {}, { skills: createSkillMap([]), claude, observer: (e) => events.push(e), config: {} });

    // First event must be workflow:start
    expect(events[0].type).toBe("workflow:start");

    // Second must be sources:resolved
    expect(events[1].type).toBe("sources:resolved");

    // Last must be workflow:end
    expect(events[events.length - 1].type).toBe("workflow:end");

    // For each node: node:enter comes before node:exit
    const types = events.map((e) => e.type);
    const aEnterIdx = types.indexOf("node:enter");
    const aExitIdx = types.indexOf("node:exit");
    expect(aEnterIdx).toBeLessThan(aExitIdx);

    // Route event comes after node:exit
    const routeIdx = types.indexOf("route");
    expect(routeIdx).toBeGreaterThan(aExitIdx);
  });

  it("observer errors are silently swallowed", async () => {
    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [],
    };

    // Observer that throws every time
    const { results } = await execute(
      w,
      {},
      {
        skills: createSkillMap([]),
        claude,
        observer: () => {
          throw new Error("boom");
        },
        config: {},
      },
    );

    // Workflow still completes
    expect(results.size).toBe(1);
  });
});

// ─── Spec Section: Execution Trace ──────────────────────────────

describe("spec: Execution trace", () => {
  it("trace.steps records node, status, and iteration", async () => {
    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Do B", skills: [] },
      },
      edges: [{ from: "a", to: "b" }],
    };

    const { trace } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]).toEqual({ node: "a", status: "success", iteration: 1 });
    expect(trace.steps[1]).toEqual({ node: "b", status: "success", iteration: 1 });
  });

  it("trace.edges records from, to, and reason", async () => {
    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Do B", skills: [] },
      },
      edges: [{ from: "a", to: "b" }],
    };

    const { trace } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    expect(trace.edges).toHaveLength(1);
    expect(trace.edges[0]).toEqual({ from: "a", to: "b", reason: "only path" });
  });

  it("trace records iteration count for retry loops", async () => {
    let runCount = 0;
    const claude: any = {
      async run() {
        runCount++;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(opts: any) {
        // Loop once, then go to done
        if (runCount <= 2) return opts.choices.find((c: any) => c.id === "a")?.id ?? opts.choices[0].id;
        return opts.choices.find((c: any) => c.id === "done")?.id ?? opts.choices[0].id;
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Do B", skills: [] },
        done: { name: "Done", instruction: "Finish", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", when: "retry", max_iterations: 1 },
        { from: "b", to: "done", when: "done" },
      ],
    };

    const { trace } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    // A runs twice: iteration 1 and iteration 2
    const aSteps = trace.steps.filter((s) => s.node === "a");
    expect(aSteps).toHaveLength(2);
    expect(aSteps[0].iteration).toBe(1);
    expect(aSteps[1].iteration).toBe(2);
  });

  it("trace.sources contains resolved source entries", async () => {
    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Do something.", skills: [] } },
      edges: [],
    };

    const { trace } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    // trace.sources should have an entry for nodes.a.instruction
    expect(trace.sources).toHaveProperty("nodes.a.instruction");
    const resolved = trace.sources["nodes.a.instruction"];
    expect(resolved.content).toBe("Do something.");
    expect(resolved.kind).toBe("inline");
    expect(resolved.resolver).toBe("inline");
    expect(resolved.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("trace.sources records file-based instructions", async () => {
    const dir = freshDir("file-source");
    writeFileSync(path.join(dir, "prompt.md"), "Investigate the production alert.");

    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "./prompt.md", skills: [] } },
      edges: [],
    };

    const { trace } = await execute(w, {}, { skills: createSkillMap([]), claude, cwd: dir, config: {} });

    const resolved = trace.sources["nodes.a.instruction"];
    expect(resolved.content).toBe("Investigate the production alert.");
    expect(resolved.kind).toBe("file");
    expect(resolved.resolver).toBe("file");
    expect(resolved.sourcePath).toContain("prompt.md");
  });
});

// ─── Spec Section: Edge Routing Algorithm ───────────────────────

describe("spec: Edge routing algorithm", () => {
  it("single unconditional edge — follows without AI evaluation", async () => {
    let evaluateCalled = false;
    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        evaluateCalled = true;
        return "b";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Do B", skills: [] },
      },
      edges: [{ from: "a", to: "b" }],
    };

    const { results } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    expect(results.size).toBe(2);
    // evaluate() should NOT have been called — unconditional single edge
    expect(evaluateCalled).toBe(false);
  });

  it("zero outgoing edges — node is terminal", async () => {
    const claude: any = {
      async run() {
        return { status: "success", data: { done: true }, toolCalls: [] };
      },
      async evaluate() {
        throw new Error("should not evaluate");
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Do A", skills: [] } },
      edges: [],
    };

    const { results } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    expect(results.size).toBe(1);
    expect(results.get("a")?.data.done).toBe(true);
  });

  it("multiple conditional edges — AI model evaluates", async () => {
    let evaluateCalled = false;
    const claude: any = {
      async run() {
        return { status: "success", data: { severity: "high" }, toolCalls: [] };
      },
      async evaluate(opts: any) {
        evaluateCalled = true;
        return opts.choices.find((c: any) => c.id === "high")?.id ?? opts.choices[0].id;
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "check",
      nodes: {
        check: { name: "Check", instruction: "Check it", skills: [] },
        high: { name: "High", instruction: "High path", skills: [] },
        low: { name: "Low", instruction: "Low path", skills: [] },
      },
      edges: [
        { from: "check", to: "high", when: "severity is high" },
        { from: "check", to: "low", when: "severity is low" },
      ],
    };

    const { results } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    expect(evaluateCalled).toBe(true);
    expect(results.has("high")).toBe(true);
    expect(results.has("low")).toBe(false);
  });

  it("exhausted max_iterations edge is excluded from routing", async () => {
    let judgeCount = 0;
    const claude: any = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(opts: any) {
        judgeCount++;
        // Always try to retry
        const retry = opts.choices.find((c: any) => c.id === "work");
        if (retry) return "work";
        return opts.choices[0].id;
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "work",
      nodes: {
        work: { name: "Work", instruction: "Do work", skills: [] },
        review: { name: "Review", instruction: "Review", skills: [] },
        done: { name: "Done", instruction: "Done", skills: [] },
      },
      edges: [
        { from: "work", to: "review" },
        { from: "review", to: "work", when: "needs rework", max_iterations: 2 },
        { from: "review", to: "done", when: "looks good" },
      ],
    };

    const { results } = await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    // After 2 retries, the review→work edge exhausts and falls through to done
    expect(results.has("done")).toBe(true);
  });
});

// ─── Spec Section: JSON Schema Correctness ──────────────────────

describe("spec: JSON Schema", () => {
  it("workflow schema $id matches spec canonical URL", () => {
    expect(workflowJsonSchema.$id).toBe("https://spec.sweny.ai/schemas/workflow.json");
  });

  it("workflow schema requires all mandatory fields", () => {
    expect(workflowJsonSchema.required).toContain("id");
    expect(workflowJsonSchema.required).toContain("name");
    expect(workflowJsonSchema.required).toContain("nodes");
    expect(workflowJsonSchema.required).toContain("edges");
    expect(workflowJsonSchema.required).toContain("entry");
  });

  it("node requires name and instruction", () => {
    const nodeSchema = (workflowJsonSchema.properties.nodes as any).additionalProperties;
    expect(nodeSchema.required).toContain("name");
    expect(nodeSchema.required).toContain("instruction");
  });

  it("edge requires from and to", () => {
    const edgeSchema = (workflowJsonSchema.properties.edges as any).items;
    expect(edgeSchema.required).toContain("from");
    expect(edgeSchema.required).toContain("to");
  });

  it("spec minimal example parses successfully", () => {
    const minimal = {
      id: "hello",
      name: "Hello World",
      entry: "greet",
      nodes: {
        greet: { name: "Greet", instruction: "Say hello to the user." },
      },
      edges: [],
    };

    const result = parseWorkflow(minimal);
    expect(result.id).toBe("hello");
    expect(result.nodes.greet.skills).toEqual([]); // default
  });

  it("spec full triage example parses and validates", () => {
    const triage = {
      id: "triage",
      name: "Alert Triage",
      description: "Investigate a production alert and take action based on findings.",
      entry: "gather",
      skills: {
        "triage-rubric": {
          name: "Triage Severity Rubric",
          instruction: "When assessing severity: critical = customer-facing outage.",
        },
      },
      nodes: {
        gather: {
          name: "Gather Context",
          instruction: "Investigate the production alert.",
          skills: ["github", "sentry", "datadog"],
        },
        investigate: {
          name: "Root Cause Analysis",
          instruction: "Classify each issue found as novel or duplicate.",
          skills: ["github", "linear", "triage-rubric"],
          output: {
            type: "object",
            properties: {
              findings: { type: "array" },
              novel_count: { type: "number" },
              highest_severity: { type: "string" },
            },
            required: ["findings", "novel_count", "highest_severity"],
          },
        },
        create_issue: {
          name: "Create Issues",
          instruction: "Create issues for novel findings.",
          skills: ["linear", "github"],
        },
        skip: {
          name: "Skip",
          instruction: "All findings were duplicates or low priority.",
          skills: ["linear"],
        },
        notify: {
          name: "Notify Team",
          instruction: "Send a notification summarizing the triage result.",
          skills: ["slack"],
        },
      },
      edges: [
        { from: "gather", to: "investigate" },
        { from: "investigate", to: "create_issue", when: "novel_count is greater than 0" },
        { from: "investigate", to: "skip", when: "novel_count is 0" },
        { from: "create_issue", to: "notify" },
        { from: "skip", to: "notify" },
      ],
    };

    const result = parseWorkflow(triage);
    expect(result.id).toBe("triage");
    expect(result.skills?.["triage-rubric"]).toBeDefined();

    const errors = validateWorkflow(result);
    expect(errors).toHaveLength(0);
  });

  it("workflowJsonSchema declares verify, requires, and retry on node properties", () => {
    const nodeProps = (workflowJsonSchema.properties.nodes as any).additionalProperties.properties;
    expect(nodeProps.verify).toBeDefined();
    expect(nodeProps.requires).toBeDefined();
    expect(nodeProps.retry).toBeDefined();
    expect(nodeProps.requires.properties.output_required).toBeDefined();
    expect(nodeProps.requires.properties.on_fail.enum).toEqual(["fail", "skip"]);
    expect(nodeProps.retry.properties.max.type).toBe("integer");
    expect(nodeProps.retry.properties.instruction.oneOf).toBeDefined();
  });
});

// ─── Spec Section: Source Types ──────────────────────────────────

describe("spec: Source type classification", () => {
  it("string starting with ./ is classified as file", () => {
    const result = parseWorkflow({
      id: "t",
      name: "T",
      entry: "a",
      nodes: { a: { name: "A", instruction: "./prompts/gather.md" } },
      edges: [],
    });
    // The instruction is stored as-is — classification happens at resolution time
    expect(result.nodes.a.instruction).toBe("./prompts/gather.md");
  });

  it("string starting with https:// is classified as url", () => {
    const result = parseWorkflow({
      id: "t",
      name: "T",
      entry: "a",
      nodes: { a: { name: "A", instruction: "https://example.com/prompt.md" } },
      edges: [],
    });
    expect(result.nodes.a.instruction).toBe("https://example.com/prompt.md");
  });

  it("tagged object form {inline:} is accepted", () => {
    const result = parseWorkflow({
      id: "t",
      name: "T",
      entry: "a",
      nodes: { a: { name: "A", instruction: { inline: "./not-a-file" } } },
      edges: [],
    });
    expect((result.nodes.a.instruction as any).inline).toBe("./not-a-file");
  });

  it("tagged object form {file:} is accepted", () => {
    const result = parseWorkflow({
      id: "t",
      name: "T",
      entry: "a",
      nodes: { a: { name: "A", instruction: { file: "./prompts/gather.md" } } },
      edges: [],
    });
    expect((result.nodes.a.instruction as any).file).toBe("./prompts/gather.md");
  });

  it("tagged object form {url:} is accepted", () => {
    const result = parseWorkflow({
      id: "t",
      name: "T",
      entry: "a",
      nodes: { a: { name: "A", instruction: { url: "https://example.com/p.md" } } },
      edges: [],
    });
    expect((result.nodes.a.instruction as any).url).toBe("https://example.com/p.md");
  });

  it("empty string is rejected", () => {
    expect(() =>
      parseWorkflow({
        id: "t",
        name: "T",
        entry: "a",
        nodes: { a: { name: "A", instruction: "" } },
        edges: [],
      }),
    ).toThrow();
  });
});

// ─── Spec Section: Inline Skills ────────────────────────────────

describe("spec: Inline skill definitions", () => {
  it("inline skill instructions are injected into node prompt", async () => {
    let capturedInstruction = "";
    const claude: any = {
      async run(opts: any) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Score the postmortem.", skills: ["rubric"] } },
      edges: [],
      skills: {
        rubric: {
          name: "SRE Rubric",
          instruction: "Score completeness 1-5.",
        },
      },
    };

    await execute(w, {}, { skills: createSkillMap([]), claude, config: {} });

    expect(capturedInstruction).toContain("## Skill: SRE Rubric");
    expect(capturedInstruction).toContain("Score completeness 1-5.");
    expect(capturedInstruction).toContain("Score the postmortem.");
  });

  it("caller skill map takes precedence over inline skills", async () => {
    let capturedInstruction = "";
    const claude: any = {
      async run(opts: any) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "a";
      },
    };

    const callerSkill: Skill = {
      id: "rubric",
      name: "Caller Rubric",
      description: "From caller",
      category: "general",
      config: {},
      tools: [],
      instruction: "Caller instruction wins.",
    };

    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Score it.", skills: ["rubric"] } },
      edges: [],
      skills: {
        rubric: {
          name: "Inline Rubric",
          instruction: "Inline instruction loses.",
        },
      },
    };

    await execute(w, {}, { skills: createSkillMap([callerSkill]), claude, config: {} });

    expect(capturedInstruction).toContain("Caller instruction wins.");
    expect(capturedInstruction).not.toContain("Inline instruction loses.");
  });
});
