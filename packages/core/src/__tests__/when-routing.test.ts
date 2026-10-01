/**
 * #461: routing on deterministic `when` expressions. Schema, load-time
 * validation, and executor behavior (no harness evaluate call, fail closed).
 */
import { describe, it, expect } from "vitest";
import { execute, RouteEvaluationError } from "../executor.js";
import { parseWorkflow, validateWorkflow, workflowZ } from "../schema.js";
import { createSkillMap } from "../skills/index.js";
import { implementWorkflow, triageWorkflow } from "../workflows/index.js";
import { evaluateExpression, parseExpression } from "../when.js";
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
    expect(trace.edges).toEqual([{ from: "a", to: "c", reason: "only path", rung: "expr" }]);
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

  it("a missing field is never a silent true or false: the route falls through to the agent (#357)", async () => {
    const w = wf([
      { from: "a", to: "b", when: { expr: "!(a.label == 'safe')" }, description: "the label is not safe" },
      { from: "a", to: "c" },
    ]);
    const events: ExecutionEvent[] = [];
    const { warnings, logger } = recordingLogger();
    const asked: string[][] = [];
    const { claude, ran, evaluateCalls } = scripted({ a: { n: 1 } }, async (opts) => {
      asked.push(opts.choices.map((c) => c.description));
      return "b";
    });
    const { trace } = await run(w, claude, {}, logger, (e) => events.push(e));
    expect(ran).toEqual(["a", "b"]);
    expect(evaluateCalls()).toBe(1);
    expect(asked).toEqual([["the label is not safe", "None of the above / default path"]]);
    expect(trace.edges[0]).toMatchObject({ from: "a", to: "b", rung: "agent" });
    expect(warnings.some((m) => /field 'a.label' is missing/.test(m))).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "node:warning",
        node: "a",
        reason: expect.stringMatching(/a\.label' is missing.*falls through/),
      }),
    );
  });

  it("an expression edge without a description falls through with its expression as the condition", async () => {
    const w = wf([
      { from: "a", to: "b", when: { expr: "a.label == 'x'" } },
      { from: "a", to: "c", when: { expr: "a.label != 'x'" } },
    ]);
    const asked: string[][] = [];
    const { claude, ran } = scripted({ a: { n: 1 } }, async (opts) => {
      asked.push(opts.choices.map((c) => c.description));
      return "c";
    });
    await run(w, claude);
    expect(ran).toEqual(["a", "c"]);
    expect(asked).toEqual([["a.label == 'x'", "a.label != 'x'"]]);
  });

  it("a field of the wrong declared type reads as missing and falls through, never compared", async () => {
    const w = wf([
      { from: "a", to: "b", when: { expr: "a.n == 3" } },
      { from: "a", to: "c", when: { expr: "a.n != 3" } },
    ]);
    const { claude, ran, evaluateCalls } = scripted({ a: { n: "3" } }, async () => "b");
    await run(w, claude);
    expect(evaluateCalls()).toBe(1);
    expect(ran).toEqual(["a", "a", "b"]); // one repair request, then the agent decides
  });

  it("a dry run stops where an expression would fall through", async () => {
    const { claude, ran, evaluateCalls } = scripted({ a: { label: "x" } });
    const { results } = await run(
      wf([
        { from: "a", to: "b", when: { expr: "a.n > 0" } },
        { from: "a", to: "c", when: { expr: "a.n <= 0" } },
      ]),
      claude,
      { dryRun: true },
    );
    expect(ran).toEqual(["a"]);
    expect(results.size).toBe(1);
    expect(evaluateCalls()).toBe(0);
  });

  describe("fall-through never offers or accepts a definitely false edge (#357)", () => {
    const guardOut = {
      type: "object",
      properties: { allow: { type: "boolean" }, kind: { type: "string", enum: ["safe", "risky"] } },
      required: ["allow", "kind"],
    };
    const nodes = (extra: Record<string, Node> = {}): Record<string, Node> => ({
      a: { name: "A", instruction: "NODE_A", skills: [], output: guardOut },
      b: { name: "B", instruction: "NODE_B", skills: [] },
      c: { name: "C", instruction: "NODE_C", skills: [] },
      d: { name: "D", instruction: "NODE_D", skills: [] },
      ...extra,
    });

    it("the review's falsifier: {allow:false} twice with kind missing; the agent says danger; danger never runs", async () => {
      // b = danger (allow == true, definitely false), c = safe (kind unknown), d = default.
      const w = wf(
        [
          { from: "a", to: "b", when: { expr: "a.allow == true" }, description: "allowed" },
          { from: "a", to: "c", when: { expr: "a.kind == 'safe'" }, description: "the change is safe" },
          { from: "a", to: "d" },
        ],
        nodes(),
      );
      const offered: string[][] = [];
      const { claude, ran, evaluateCalls } = scripted({ a: { allow: false } }, async (opts) => {
        offered.push(opts.choices.map((c) => c.id));
        return "b";
      });
      const { trace } = await run(w, claude);
      expect(ran).toEqual(["a", "a", "d"]); // one repair, then the default, never b
      expect(evaluateCalls()).toBe(1);
      expect(offered).toEqual([["c", "d"]]);
      expect(trace.edges[0]).toMatchObject({ from: "a", to: "d", rung: "agent" });
    });

    it("one edge true and one unknown: only those two are offered (the default cannot be right)", async () => {
      const w = wf(
        [
          { from: "a", to: "b", when: { expr: "a.kind == 'safe'" }, description: "safe" },
          { from: "a", to: "c", when: { expr: "a.allow == true" }, description: "allowed" },
          { from: "a", to: "d" },
        ],
        nodes(),
      );
      const offered: string[][] = [];
      const { claude, ran } = scripted({ a: { allow: true } }, async (opts) => {
        offered.push(opts.choices.map((c) => c.id));
        return "c";
      });
      await run(w, claude);
      expect(offered).toEqual([["b", "c"]]);
      expect(ran[ran.length - 1]).toBe("c");
    });

    it("a model answer naming a ruled-out edge, with no default to fall back on, ends the branch", async () => {
      const ns = nodes();
      delete ns.d; // no default edge here, so no d
      const w = wf(
        [
          { from: "a", to: "b", when: { expr: "a.kind == 'safe'" } },
          { from: "a", to: "c", when: { expr: "a.allow == true" } },
        ],
        ns,
      );
      const { claude, ran } = scripted({ a: { allow: false } }, async () => "c");
      await run(w, claude);
      expect(ran).toEqual(["a", "a"]);
    });

    it("two true edges still fail closed, unknowns or not", async () => {
      const w = wf(
        [
          { from: "a", to: "b", when: { expr: "a.allow == true" } },
          { from: "a", to: "c", when: { expr: "a.allow != false" } },
          { from: "a", to: "d", when: { expr: "a.kind == 'safe'" } },
        ],
        nodes(),
      );
      const { claude } = scripted({ a: { allow: true } }, async () => "b");
      await expect(run(w, claude)).rejects.toBeInstanceOf(RouteEvaluationError);
    });
  });

  it("an invalid field is unknown, never absent: even `exists` on it is a problem", () => {
    const ast = parseExpression("exists a.url");
    expect(evaluateExpression(ast, { a: { url: { x: 1 } } })).toEqual({ value: true });
    expect(evaluateExpression(ast, { a: { url: { x: 1 } } }, { invalid: new Set(["a.url"]) })).toMatchObject({
      value: false,
      problem: expect.stringMatching(/a\.url' does not match its declared type/),
    });
    expect(evaluateExpression(parseExpression("!(exists a.url)"), { a: {} })).toEqual({ value: true });
  });

  it("does not read a failed node's data: its expressions fall through to the agent", async () => {
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
    const { claude, ran, evaluateCalls } = scripted(
      { a: { status: "failed", data: { n: 5, error: "boom" }, toolCalls: [] } },
      async () => "c",
    );
    await run(w, claude);
    expect(ran).toEqual(["a", "c"]);
    expect(evaluateCalls()).toBe(1);
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
  const investigate = (novel_count: number, highest_severity: string, fixable_count = 0) => ({
    findings: [],
    novel_count,
    fixable_count,
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
  ])("a fixable medium novel finding, test_status %s: no route asks the model (#357)", async (status, tail) => {
    // The scripted model would say "notify": the route proves it was never asked.
    const { claude, ran, evaluated } = harness(
      {
        investigate: { ...investigate(1, "medium", 1), findings: [fixable] },
        createissue: issue,
        implement: implement(status),
      },
      "notify",
    );
    await run(stripped, claude);
    expect(ran.map((r) => (r === "createissue" ? "create_issue" : r === "createpr" ? "create_pr" : r))).toEqual([
      "gather",
      "investigate",
      "create_issue",
      "implement",
      ...tail,
    ]);
    expect(evaluated).toEqual([]);
  });

  it("fixable_count 0: create_issue goes to notify (no fix attempted) with no model call", async () => {
    const { claude, ran, evaluated } = harness(
      { investigate: investigate(2, "high", 0), createissue: issue },
      "implement",
    );
    await run(stripped, claude);
    expect(ran.map((r) => (r === "createissue" ? "create_issue" : r))).toEqual([
      "gather",
      "investigate",
      "create_issue",
      "notify",
    ]);
    expect(evaluated).toEqual([]);
  });

  it("fixable_count missing twice: one repair request, then the agent decides on the description", async () => {
    const inv = { findings: [], novel_count: 2, highest_severity: "high", recommendation: "r" };
    const { claude, ran, evaluated } = harness({ investigate: inv, createissue: issue }, "notify");
    await run(stripped, claude);
    expect(ran.map((r) => (r === "createissue" ? "create_issue" : r))).toEqual([
      "gather",
      "investigate",
      "investigate",
      "create_issue",
      "notify",
    ]);
    expect(evaluated).toEqual([["implement", "notify"]]);
  });

  // The review's case: the old natural-language condition read the findings,
  // so a count that contradicts them must not route on its own.
  const fixable = {
    title: "t",
    root_cause: "r",
    severity: "high",
    is_duplicate: false,
    fix_complexity: "simple",
    fix_approach: "patch it",
  };

  it("fixable_count 0 while a finding is fixable: invalid, repaired once, then the agent decides", async () => {
    const inv = { ...investigate(1, "high", 0), findings: [fixable] };
    const { claude, ran, evaluated } = harness({ investigate: inv, createissue: issue }, "notify");
    await run(stripped, claude);
    expect(ran.filter((r) => r === "investigate")).toHaveLength(2);
    expect(evaluated).toEqual([["implement", "notify"]]);
  });

  it("fixable_count consistent with the findings routes with no model call (old and new agree)", async () => {
    const complex = { ...fixable, fix_complexity: "complex" };
    const dup = { ...fixable, is_duplicate: true };
    const noPlan = { ...fixable, fix_approach: "  " };
    for (const [findings, count, next] of [
      [[fixable], 1, "implement"],
      [[complex, dup, noPlan], 0, "notify"],
      [[fixable, complex], 1, "implement"],
    ] as const) {
      const inv = { ...investigate(findings.length, "high", count), findings: [...findings] };
      const { claude, ran, evaluated } = harness(
        { investigate: inv, createissue: issue, implement: implement("skipped") },
        "skip",
      );
      await run(stripped, claude);
      expect(ran.filter((r) => r === "investigate")).toHaveLength(1);
      expect(ran[3]).toBe(next);
      expect(evaluated).toEqual([]);
    }
  });
});

// ─── Built-in implement routing ──────────────────────────────────

describe("built-in implement routes analyze without a model call (#357)", () => {
  const stripped: Workflow = {
    ...implementWorkflow,
    nodes: Object.fromEntries(
      Object.entries(implementWorkflow.nodes).map(([id, n]) => [
        id,
        { name: n.name, instruction: `NODE_${id.toUpperCase().replace(/_/g, "")}`, skills: [], output: n.output },
      ]),
    ),
  };

  function harness(analyze: Record<string, unknown>) {
    const ran: string[] = [];
    let evaluated = 0;
    const claude: Claude = {
      async run(opts) {
        const id = /NODE_([A-Z]+)/.exec(opts.instruction)?.[1]?.toLowerCase() ?? "?";
        ran.push(id);
        return { status: "success", data: id === "analyze" ? analyze : {}, toolCalls: [] };
      },
      async evaluate() {
        evaluated++;
        return null;
      },
      async ask() {
        return "";
      },
    };
    return { claude, ran, evaluated: () => evaluated };
  }

  const analyze = (has_open_pr: unknown, risk_level: unknown, plan_is_clear: unknown) => ({
    issue_summary: "s",
    fix_plan: "p",
    ...(has_open_pr === undefined ? {} : { has_open_pr }),
    ...(risk_level === undefined ? {} : { risk_level }),
    ...(plan_is_clear === undefined ? {} : { plan_is_clear }),
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["an open PR goes to notify", analyze(true, "low", true), "notify"],
    ["low risk, clear plan goes to implement", analyze(false, "low", true), "implement"],
    ["medium risk, clear plan goes to implement", analyze(false, "medium", true), "implement"],
    ["high risk goes to skip", analyze(false, "high", true), "skip"],
    ["an unclear plan goes to skip", analyze(false, "low", false), "skip"],
  ])("%s", async (_n, data, next) => {
    const { claude, ran, evaluated } = harness(data);
    await run(stripped, claude);
    expect(ran[0]).toBe("analyze");
    expect(ran[1]).toBe(next);
    expect(evaluated()).toBe(0);
  });

  it("an open PR by existing_pr_url alone still goes to notify (the old condition's reading)", async () => {
    const { claude, ran, evaluated } = harness({
      ...analyze(false, "low", true),
      existing_pr_url: "https://github.com/o/r/pull/1",
    });
    await run(stripped, claude);
    expect(ran[1]).toBe("notify");
    expect(evaluated()).toBe(0);
  });

  it("missing once: one repair request, then expressions route with no model call", async () => {
    let calls = 0;
    const ran: string[] = [];
    let evaluated = 0;
    const claude: Claude = {
      async run(opts) {
        const id = /NODE_([A-Z]+)/.exec(opts.instruction)?.[1]?.toLowerCase() ?? "?";
        ran.push(id);
        if (id !== "analyze") return { status: "success", data: {}, toolCalls: [] };
        calls++;
        if (calls === 2) expect(opts.instruction).toMatch(/has_open_pr: required but missing/);
        return {
          status: "success",
          data: calls === 1 ? analyze(undefined, "low", true) : analyze(false, "low", true),
          toolCalls: [],
        };
      },
      async evaluate() {
        evaluated++;
        return null;
      },
      async ask() {
        return "";
      },
    };
    await run(stripped, claude);
    expect(ran.slice(0, 3)).toEqual(["analyze", "analyze", "implement"]);
    expect(evaluated).toBe(0);
  });

  it("existing_pr_url as an object twice is unknown, not absent: the agent rung, never a deterministic implement", async () => {
    const { claude, ran, evaluated } = harness({ ...analyze(false, "low", true), existing_pr_url: { url: "x" } });
    await run(stripped, claude);
    expect(ran.slice(0, 3)).toEqual(["analyze", "analyze", "skip"]);
    expect(ran).not.toContain("implement");
    expect(evaluated()).toBe(1);
  });

  it("the repair does not use a max_steps slot: analyze -> skip -> notify completes under max_steps 3", async () => {
    const { claude, ran, evaluated } = harness(analyze(false, "low", undefined));
    const { results } = await execute(
      stripped,
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger: silent,
        max_steps: 3,
      },
    );
    expect(ran).toEqual(["analyze", "analyze", "skip", "notify"]);
    expect(evaluated()).toBe(1);
    expect(results.has("notify")).toBe(true);
  });

  it("missing twice: the run continues, the agent routes on the descriptions (default edge on its failure)", async () => {
    const { claude, ran, evaluated } = harness(analyze(undefined, undefined, undefined));
    await run(stripped, claude);
    expect(ran.slice(0, 3)).toEqual(["analyze", "analyze", "skip"]);
    expect(evaluated()).toBe(1);
  });
});
