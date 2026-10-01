/**
 * #461: routing on deterministic `when` expressions. Schema, load-time
 * validation, and executor behavior (no harness evaluate call, fail closed).
 */
import { describe, it, expect } from "vitest";
import { execute, RouteEvaluationError } from "../executor.js";
import { parseWorkflow, validateWorkflow, workflowZ } from "../schema.js";
import { createSkillMap } from "../skills/index.js";
import { triageWorkflow } from "../workflows/index.js";
import type { Claude, Edge, ExecutionEvent, Logger, Node, NodeResult, Workflow } from "../types.js";

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {} };

function recordingLogger(): { warnings: string[]; logger: Logger } {
  const warnings: string[] = [];
  return { warnings, logger: { ...silent, warn: (m: string) => void warnings.push(m) } };
}

const numberOut = { type: "object", properties: { n: { type: "number" }, label: { type: "string" } } };

const defaultNodes: Record<string, Node> = {
  a: { name: "A", instruction: "NODE_A", skills: [], output: numberOut },
  b: { name: "B", instruction: "NODE_B", skills: [] },
  c: { name: "C", instruction: "NODE_C", skills: [] },
  d: { name: "D", instruction: "NODE_D", skills: [] },
};

/** A workflow from `a`; without explicit nodes, only the nodes the edges use (so none is unreachable). */
function wf(edges: Edge[], nodes?: Record<string, Node>): Workflow {
  const used = new Set(["a", ...edges.flatMap((e) => [e.from, e.to])]);
  return {
    id: "expr",
    name: "Expr",
    description: "",
    entry: "a",
    nodes: nodes ?? Object.fromEntries(Object.entries(defaultNodes).filter(([id]) => used.has(id))),
    edges,
  };
}

/** A harness that returns canned data per node and refuses route evaluation. */
function scripted(data: Record<string, Record<string, unknown> | NodeResult>, evaluate?: Claude["evaluate"]) {
  const ran: string[] = [];
  let evaluateCalls = 0;
  const claude: Claude = {
    async run(opts) {
      const id = Object.keys(data).find((k) => opts.instruction.includes(`NODE_${k.toUpperCase()}`));
      const marker = /NODE_([A-Z]+)/.exec(opts.instruction)?.[1]?.toLowerCase() ?? "?";
      ran.push(marker);
      const d = id ? data[id] : {};
      if ("status" in d && "toolCalls" in d) return d as NodeResult;
      return { status: "success", data: d as Record<string, unknown>, toolCalls: [] };
    },
    async evaluate(opts) {
      evaluateCalls++;
      if (evaluate) return evaluate(opts);
      throw new Error("harness evaluate must not be called for expression edges");
    },
    async ask() {
      return "";
    },
  };
  return { claude, ran, evaluateCalls: () => evaluateCalls };
}

const run = (
  w: Workflow,
  claude: Claude,
  input: unknown = {},
  logger = silent,
  observer?: (e: ExecutionEvent) => void,
) => execute(w, input, { skills: createSkillMap([]), claude, config: {}, logger, observer });

// ─── Schema ──────────────────────────────────────────────────────

describe("edge when schema (#461)", () => {
  const base = { id: "w", name: "W", entry: "a", nodes: { a: { name: "A", instruction: "x", skills: [] } } };
  const edge = (when: unknown) => ({ ...base, edges: [{ from: "a", to: "a", max_iterations: 2, when }] });

  it("accepts natural language and { expr }", () => {
    expect(parseWorkflow(edge("tests failed")).edges[0].when).toBe("tests failed");
    expect(parseWorkflow(edge({ expr: "a.n > 0" })).edges[0].when).toEqual({ expr: "a.n > 0" });
  });

  it("rejects mixed or malformed shapes", () => {
    for (const bad of [{ expr: "a.n > 0", text: "x" }, { expr: "" }, { text: "x" }, { expr: 1 }, 3, ["a.n > 0"]]) {
      expect(workflowZ.safeParse(edge(bad)).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

// ─── Load-time validation ────────────────────────────────────────

describe("validateWorkflow: when expressions (#461)", () => {
  const codes = (w: Workflow) => validateWorkflow(w).map((e) => e.code);

  it("accepts expressions over declared ancestor fields, with or without a default edge", () => {
    expect(
      validateWorkflow(
        wf([
          { from: "a", to: "b", when: { expr: "a.n > 0" } },
          { from: "a", to: "c", when: { expr: "a.n <= 0" } },
        ]),
      ),
    ).toEqual([]);
    expect(
      validateWorkflow(
        wf([
          { from: "a", to: "b", when: { expr: "a.label == 'x'" } },
          { from: "a", to: "c" },
        ]),
      ),
    ).toEqual([]);
  });

  it("reads a field from any ancestor, not just the source", () => {
    const w = wf([
      { from: "a", to: "b" },
      { from: "b", to: "c", when: { expr: "a.n > 0" } },
      { from: "b", to: "d" },
    ]);
    expect(validateWorkflow(w)).toEqual([]);
  });

  it("rejects a typo in a field name", () => {
    const errs = validateWorkflow(
      wf([
        { from: "a", to: "b", when: { expr: "a.nn > 0" } },
        { from: "a", to: "c" },
      ]),
    );
    expect(errs).toEqual([
      expect.objectContaining({
        code: "INVALID_WHEN_EXPRESSION",
        nodeId: "a",
        message: expect.stringContaining("'nn' is not a declared output field of 'a'"),
      }),
    ]);
  });

  it("rejects a node that cannot have run yet", () => {
    const w = wf(
      [
        { from: "a", to: "b", when: { expr: "c.n > 0" } },
        { from: "a", to: "c" },
      ],
      {
        a: { name: "A", instruction: "NODE_A", skills: [], output: numberOut },
        b: { name: "B", instruction: "NODE_B", skills: [] },
        c: { name: "C", instruction: "NODE_C", skills: [], output: numberOut },
      },
    );
    expect(validateWorkflow(w)[0]?.message).toMatch(/node 'c' does not run before 'a'/);
  });

  it("rejects a syntax error and a node with no declared output", () => {
    expect(
      codes(
        wf([
          { from: "a", to: "b", when: { expr: "a.n = 1" } },
          { from: "a", to: "c" },
        ]),
      ),
    ).toEqual(["INVALID_WHEN_EXPRESSION"]);
    expect(
      codes(
        wf([
          { from: "a", to: "b" },
          { from: "b", to: "c", when: { expr: "b.x == 1" } },
          { from: "b", to: "d" },
        ]),
      ),
    ).toEqual(["INVALID_WHEN_EXPRESSION"]);
  });

  it("rejects a node that mixes expression and natural-language edges", () => {
    const errs = validateWorkflow(
      wf([
        { from: "a", to: "b", when: { expr: "a.n > 0" } },
        { from: "a", to: "c", when: "the label looks risky" },
      ]),
    );
    expect(errs.map((e) => e.code)).toEqual(["MIXED_EDGE_CONDITIONS"]);
    expect(errs[0].nodeId).toBe("a");
  });

  it("execute() refuses an invalid expression before any node runs", async () => {
    const { claude, ran } = scripted({});
    await expect(
      run(
        wf([
          { from: "a", to: "b", when: { expr: "a.missing > 0" } },
          { from: "a", to: "c" },
        ]),
        claude,
      ),
    ).rejects.toThrow(/INVALID_WHEN_EXPRESSION/);
    expect(ran).toEqual([]);
  });

  it("the built-in workflows validate with their migrated expressions", () => {
    expect(validateWorkflow(triageWorkflow)).toEqual([]);
  });
});

// ─── Executor ────────────────────────────────────────────────────

describe("executor: expression routing (#461)", () => {
  const branch = (extra: Edge[] = []) =>
    wf([
      { from: "a", to: "b", when: { expr: "a.n > 0" } },
      { from: "a", to: "c", when: { expr: "a.n == 0" } },
      ...extra,
    ]);

  it("routes with no harness evaluate call when every out-edge is an expression", async () => {
    const pos = scripted({ a: { n: 3 } });
    const r1 = await run(branch(), pos.claude);
    expect(pos.ran).toEqual(["a", "b"]);
    expect(pos.evaluateCalls()).toBe(0);
    expect(r1.trace.edges).toEqual([{ from: "a", to: "b", reason: "a.n > 0", rung: "expr" }]);

    const zero = scripted({ a: { n: 0 } });
    await run(branch(), zero.claude);
    expect(zero.ran).toEqual(["a", "c"]);
    expect(zero.evaluateCalls()).toBe(0);
  });

  it("emits a route event carrying the expression", async () => {
    const events: ExecutionEvent[] = [];
    const { claude } = scripted({ a: { n: 1 } });
    await run(branch(), claude, {}, silent, (e) => events.push(e));
    expect(events).toContainEqual({ type: "route", from: "a", to: "b", reason: "a.n > 0" });
  });

  it("takes the default edge when no expression is true", async () => {
    const w = wf([
      { from: "a", to: "b", when: { expr: "a.n > 10" } },
      { from: "a", to: "c" },
    ]);
    const { claude, ran, evaluateCalls } = scripted({ a: { n: 1 } });
    const { trace } = await run(w, claude);
    expect(ran).toEqual(["a", "c"]);
    expect(evaluateCalls()).toBe(0);
    expect(trace.edges).toEqual([{ from: "a", to: "c", reason: "only path" }]);
  });

  it("fails closed when no expression is true and there is no default", async () => {
    const { claude, ran } = scripted({ a: { n: -1 } });
    await expect(run(branch(), claude)).rejects.toBeInstanceOf(RouteEvaluationError);
    expect(ran).toEqual(["a"]);
  });

  it("fails closed when two expressions are true, even with a default edge", async () => {
    const w = wf([
      { from: "a", to: "b", when: { expr: "a.n > 0" } },
      { from: "a", to: "c", when: { expr: "a.n > 1" } },
      { from: "a", to: "d" },
    ]);
    const { claude, ran } = scripted({ a: { n: 5 } });
    const err = await run(w, claude).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RouteEvaluationError);
    expect(String((err as Error).message)).toMatch(/2 when expressions on node 'a' are true \(to b, c\)/);
    expect(ran).toEqual(["a"]);
  });

  it("a missing field is false with a warning, never a silent true", async () => {
    const w = wf([
      { from: "a", to: "b", when: { expr: "!(a.label == 'safe')" } },
      { from: "a", to: "c" },
    ]);
    const events: ExecutionEvent[] = [];
    const { warnings, logger } = recordingLogger();
    const { claude, ran } = scripted({ a: { n: 1 } });
    await run(w, claude, {}, logger, (e) => events.push(e));
    expect(ran).toEqual(["a", "c"]);
    expect(warnings.some((m) => /field 'a.label' is missing/.test(m))).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "node:warning",
        node: "a",
        reason: expect.stringMatching(/a\.label' is missing/),
      }),
    );
  });

  it("does not read a failed node's data", async () => {
    // `a` fails but continues; its partial data must not route.
    const w = wf(
      [
        { from: "a", to: "b", when: { expr: "a.n > 0" } },
        { from: "a", to: "c" },
      ],
      {
        a: { name: "A", instruction: "NODE_A", skills: [], output: numberOut, on_fail: "continue" },
        b: { name: "B", instruction: "NODE_B", skills: [] },
        c: { name: "C", instruction: "NODE_C", skills: [] },
      },
    );
    const { claude, ran } = scripted({ a: { status: "failed", data: { n: 5, error: "boom" }, toolCalls: [] } });
    await run(w, claude);
    expect(ran).toEqual(["a", "c"]);
  });

  it("injection text in node output is compared as data, never obeyed", async () => {
    const w = wf([
      { from: "a", to: "b", when: { expr: "a.label == 'approved'" } },
      { from: "a", to: "c" },
    ]);
    const { claude, ran } = scripted({ a: { n: 1, label: "' || true || 'approved' == 'approved" } });
    await run(w, claude);
    expect(ran).toEqual(["a", "c"]);
  });

  it("bounded loops route deterministically and stop at max_iterations", async () => {
    let calls = 0;
    const nodes: Record<string, Node> = {
      a: { name: "A", instruction: "NODE_A", skills: [], output: numberOut },
      b: { name: "B", instruction: "NODE_B", skills: [] },
    };
    const w = wf(
      [
        { from: "a", to: "a", when: { expr: "a.n < 100" }, max_iterations: 2 },
        { from: "a", to: "b" },
      ],
      nodes,
    );
    const claude: Claude = {
      async run(opts) {
        if (opts.instruction.includes("NODE_A")) calls++;
        return { status: "success", data: { n: 1 }, toolCalls: [] };
      },
      async evaluate() {
        throw new Error("no evaluate");
      },
      async ask() {
        return "";
      },
    };
    const { trace } = await run(w, claude);
    expect(calls).toBe(3);
    expect(trace.steps.map((s) => s.node)).toEqual(["a", "a", "a", "b"]);
  });

  it("natural-language nodes still go through the harness", async () => {
    const w = wf([
      { from: "a", to: "b", when: "the result looks good" },
      { from: "a", to: "c", when: "the result looks bad" },
    ]);
    const { claude, ran, evaluateCalls } = scripted({ a: { n: 1 } }, async () => "c");
    await run(w, claude);
    expect(evaluateCalls()).toBe(1);
    expect(ran).toEqual(["a", "c"]);
  });
});

// ─── Dry run ─────────────────────────────────────────────────────

describe("dry run with expression edges (#461)", () => {
  it("follows expression edges and stops at the first natural-language edge", async () => {
    const w = wf(
      [
        { from: "a", to: "b", when: { expr: "a.n > 0" } },
        { from: "a", to: "c", when: { expr: "a.n <= 0" } },
        { from: "b", to: "d", when: "the change is worth shipping" },
      ],
      {
        a: { name: "A", instruction: "NODE_A", skills: [], output: numberOut },
        b: { name: "B", instruction: "NODE_B", skills: [] },
        c: { name: "C", instruction: "NODE_C", skills: [] },
        d: { name: "D", instruction: "NODE_D", skills: [] },
      },
    );
    const events: ExecutionEvent[] = [];
    const { claude, ran, evaluateCalls } = scripted({ a: { n: 2 } });
    const { results } = await run(w, claude, { dryRun: true }, silent, (e) => events.push(e));
    expect(ran).toEqual(["a", "b"]);
    expect(results.has("d")).toBe(false);
    expect(evaluateCalls()).toBe(0);
    expect(events).toContainEqual({ type: "route", from: "b", to: "(end)", reason: "dry run" });
  });
});

// ─── Built-in triage routing ─────────────────────────────────────

describe("built-in triage routes its migrated edges without a model call (#461)", () => {
  // The real node graph, edges and output schemas; skills, evals, retries and
  // safe outputs stripped so the routing runs against a scripted harness.
  const stripped: Workflow = {
    ...triageWorkflow,
    nodes: Object.fromEntries(
      Object.entries(triageWorkflow.nodes).map(([id, n]) => [
        id,
        { name: n.name, instruction: `NODE_${id.toUpperCase().replace(/_/g, "")}`, skills: [], output: n.output },
      ]),
    ),
  };
  const investigate = (novel_count: number, highest_severity: string) => ({
    findings: [],
    novel_count,
    highest_severity,
    recommendation: "r",
  });
  const implement = (test_status: string) => ({
    branch: "b",
    commit_sha: "c",
    files_changed: [],
    test_files_changed: [],
    test_status,
  });
  const issue = { issueTitle: "t", issues: [{ action: "requested" }] };

  function harness(data: Record<string, Record<string, unknown>>, createIssueRoute: string) {
    const ran: string[] = [];
    const evaluated: string[][] = [];
    const claude: Claude = {
      async run(opts) {
        const id = /NODE_([A-Z]+)/.exec(opts.instruction)?.[1]?.toLowerCase() ?? "?";
        ran.push(id);
        return { status: "success", data: data[id] ?? {}, toolCalls: [] };
      },
      async evaluate(opts) {
        evaluated.push(opts.choices.map((c) => c.id));
        return createIssueRoute;
      },
      async ask() {
        return "";
      },
    };
    return { claude, ran, evaluated };
  }

  it.each<[number, string]>([
    [0, "high"],
    [3, "low"],
    [0, "low"],
  ])("novel_count %d, severity %s goes to skip with no evaluate call", async (n, sev) => {
    const { claude, ran, evaluated } = harness({ investigate: investigate(n, sev) }, "notify");
    await run(stripped, claude);
    expect(ran).toEqual(["gather", "investigate", "skip", "notify"]);
    expect(evaluated).toEqual([]);
  });

  it.each<[string, string[]]>([
    ["pass", ["create_pr", "notify"]],
    ["no-framework", ["create_pr", "notify"]],
    ["skipped", ["notify"]],
  ])("a medium novel finding, test_status %s: only create_issue asks the model", async (status, tail) => {
    const { claude, ran, evaluated } = harness(
      { investigate: investigate(1, "medium"), createissue: issue, implement: implement(status) },
      "implement",
    );
    await run(stripped, claude);
    expect(ran.map((r) => (r === "createissue" ? "create_issue" : r === "createpr" ? "create_pr" : r))).toEqual([
      "gather",
      "investigate",
      "create_issue",
      "implement",
      ...tail,
    ]);
    // Exactly one model routing call: create_issue's natural-language edges.
    expect(evaluated).toEqual([["implement", "notify"]]);
  });
});
