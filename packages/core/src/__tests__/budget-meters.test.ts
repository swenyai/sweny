/**
 * Budget metering of the executor's own completions: judge scoring, route
 * evaluation, retry reflection and the safe-output screen report usage into
 * the same run budget as node runs, under their own kind.
 *
 * Fake harnesses report usage the way an adapter's `complete()` does, through
 * `onUsage`. No test calls a model.
 */
import { describe, it, expect } from "vitest";
import { execute } from "../executor.js";
import type { ExecuteOptions } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import { BudgetGuard } from "../budget.js";
import { CLAUDE_CODE_CAPABILITIES } from "../harness/capabilities.js";
import { summarizeRun } from "../cli/run-output.js";
import { createNodeTimer } from "../cli/run-history.js";
import type { AgentHarness, HarnessCompleteRequest, HarnessRunRequest, HarnessRunResult } from "../harness/types.js";
import type { Claude, NodeUsage, Skill, Tool, Workflow } from "../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

interface Fake {
  harness: AgentHarness;
  runs: string[];
  completes: Array<"ask" | "evaluate">;
}

/** Node runs report `node`; judge (ask) and route (evaluate) completions report their own usage. */
function fake(spend: { node?: NodeUsage; judge?: NodeUsage; route?: NodeUsage }, verdict = "yes"): Fake {
  const runs: string[] = [];
  const completes: Array<"ask" | "evaluate"> = [];
  const harness: AgentHarness = {
    id: "mock",
    capabilities: CLAUDE_CODE_CAPABILITIES,
    async preflight() {
      return { ok: true, version: "test" };
    },
    async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
      runs.push(req.instruction.includes("Do a") ? "a" : req.instruction.includes("Do b") ? "b" : "c");
      return {
        status: "success",
        data: { done: true },
        toolCalls: [],
        ...(spend.node ? { usage: spend.node } : {}),
        harness: { id: "mock", version: "test" },
        degraded: [],
      };
    },
    async complete(req: HarnessCompleteRequest) {
      const purpose = req.purpose ?? "ask";
      completes.push(purpose);
      const u = purpose === "evaluate" ? spend.route : spend.judge;
      if (u) req.onUsage?.(u);
      return purpose === "evaluate" ? "b" : `VERDICT: ${verdict}\nREASONING: ok`;
    },
  };
  return { harness, runs, completes };
}

const wf = (opts: { judge?: boolean; route?: boolean; budget?: Workflow["budget"]; nodeBudget?: Workflow["budget"] }) =>
  ({
    id: "metered",
    name: "Metered",
    description: "",
    entry: "a",
    nodes: {
      a: {
        name: "A",
        instruction: "Do a",
        skills: [],
        ...(opts.nodeBudget ? { budget: opts.nodeBudget } : {}),
        ...(opts.judge ? { eval: [{ name: "j", kind: "judge", rubric: "is it good?", pass_when: "yes" }] } : {}),
      },
      b: { name: "B", instruction: "Do b", skills: [] },
      ...(opts.route ? { c: { name: "C", instruction: "Do c", skills: [] } } : {}),
    },
    edges: opts.route
      ? [
          { from: "a", to: "b", when: "the work is fine" },
          { from: "a", to: "c", when: "the work is bad" },
        ]
      : [{ from: "a", to: "b" }],
    ...(opts.budget ? { budget: opts.budget } : {}),
  }) as unknown as Workflow;

const exec = (workflow: Workflow, f: Fake, extra: Partial<ExecuteOptions> = {}) =>
  execute(
    workflow,
    {},
    {
      skills: createSkillMap([]),
      harness: f.harness,
      config: {},
      logger: silent,
      harnessPolicy: "warn",
      env: {},
      ...extra,
    },
  );

const node10 = { inputTokens: 10, outputTokens: 0 };
const judge100 = { inputTokens: 60, outputTokens: 40 };
const route50 = { inputTokens: 50, outputTokens: 0 };

describe("judge and route completions are metered", () => {
  it("reports the split by kind and folds the extras into the receipt totals", async () => {
    const f = fake({ node: node10, judge: judge100, route: route50 });
    const { results, trace } = await exec(wf({ judge: true, route: true }), f);
    expect(f.completes).toEqual(["ask", "evaluate"]);
    expect(trace.spend).toEqual({
      node: { tokens: 20, costUsd: 0, calls: 2 },
      judge: { tokens: 100, costUsd: 0, calls: 1 },
      route: { tokens: 50, costUsd: 0, calls: 1 },
    });
    const summary = summarizeRun(results, 1, false, trace);
    expect(summary.tokens).toBe(170);
    expect(summary.spend).toEqual(trace.spend);
  });

  it("a judge that crosses the run budget fails the node and stops before routing", async () => {
    const f = fake({ node: node10, judge: judge100, route: route50 });
    const { results, trace } = await exec(wf({ judge: true, route: true, budget: { tokens: 80 } }), f);
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.budget).toEqual({ scope: "run", unit: "tokens", limit: 80, spent: 110, kind: "judge" });
    expect(a.data).toMatchObject({ budget_exceeded: true });
    expect(f.completes).toEqual(["ask"]);
    expect(f.runs).toEqual(["a"]);
    expect(trace.spend?.judge?.tokens).toBe(100);
  });

  it("judge spend counts against the node's own budget", async () => {
    const f = fake({ node: node10, judge: judge100 });
    const { results } = await exec(wf({ judge: true, nodeBudget: { tokens: 50 } }), f);
    expect(results.get("a")!.budget).toEqual({ scope: "node", unit: "tokens", limit: 50, spent: 110, kind: "judge" });
    expect(f.runs).toEqual(["a"]);
  });

  it("the stop is over the total: node, judge and route together cross, and the next node does not start", async () => {
    // 10 + 100 + 50 = 160. Each part alone is under 150; no node or judge call crosses before the route.
    const f = fake({ node: node10, judge: judge100, route: route50 });
    const { results } = await exec(wf({ judge: true, route: true, budget: { tokens: 150 } }), f);
    expect(results.get("a")!.status).toBe("success");
    const b = results.get("b")!;
    expect(b.status).toBe("failed");
    expect(b.budget).toMatchObject({ scope: "run", unit: "tokens", limit: 150, spent: 160 });
    expect(f.runs).toEqual(["a"]);
  });

  it("a completion that reports no usage adds nothing", async () => {
    const f = fake({ node: node10 });
    const { trace } = await exec(wf({ judge: true, route: true, budget: { tokens: 1000 } }), f);
    expect(f.completes).toEqual(["ask", "evaluate"]);
    expect(trace.spend).toBeUndefined();
  });

  it("no judge or route call: the trace and receipt are unchanged", async () => {
    const f = fake({ node: node10 });
    const { results, trace } = await exec(wf({ budget: { tokens: 1000 } }), f);
    expect(trace.spend).toBeUndefined();
    const summary = summarizeRun(results, 1, false, trace);
    expect(summary.spend).toBeUndefined();
    expect(summary.tokens).toBe(20);
  });
});

describe("BudgetGuard.meter", () => {
  it("counts by kind, judges the breach against the totals before the report, and ignores empty usage", () => {
    const g = new BudgetGuard({ tokens: 100 });
    expect(g.meter("judge", { inputTokens: 60 })).toBeUndefined();
    expect(g.meter("route", {})).toBeUndefined();
    expect(g.meter("route", { inputTokens: 50 })).toEqual({
      scope: "run",
      unit: "tokens",
      limit: 100,
      spent: 110,
      kind: "route",
    });
    expect(g.totals.tokens).toBe(110);
    expect(g.breakdown()).toEqual({
      judge: { tokens: 60, costUsd: 0, calls: 1 },
      route: { tokens: 50, costUsd: 0, calls: 1 },
    });
    expect(g.hasMeteredCalls).toBe(true);
  });

  it("a node-scoped report counts against the node and the run", () => {
    const g = new BudgetGuard({});
    const n = g.node({ tokens: 40 });
    expect(n.meter("judge", { inputTokens: 50 })).toMatchObject({ scope: "node", spent: 50 });
    expect(g.totals.tokens).toBe(50);
    expect(n.exhausted()).toMatchObject({ scope: "node" });
  });
});

/**
 * A harness whose completions are scripted in call order: each entry is the
 * usage that completion reports and the text it answers. Purpose and prompt
 * are recorded so a test can tell judge, reflection, screen and route apart.
 */
function scripted(
  node: NodeUsage | undefined,
  calls: Array<{ usage?: NodeUsage; answer: string }>,
  nodeData: Array<Record<string, unknown>> = [],
) {
  const seen: Array<{ purpose: string; prompt: string }> = [];
  let runs = 0;
  const harness: AgentHarness = {
    id: "mock",
    capabilities: CLAUDE_CODE_CAPABILITIES,
    async preflight() {
      return { ok: true, version: "test" };
    },
    async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
      const i = runs++;
      // The agent requests the write it was told to.
      const emit = req.tools.find((t) => t.name === "emit_output");
      if (emit) await emit.handler({ type: "issue", title: "t", body: "b" }, { config: {}, logger: silent });
      return {
        status: "success",
        data: nodeData[i] ?? { done: true },
        toolCalls: [],
        ...(node ? { usage: node } : {}),
        harness: { id: "mock", version: "test" },
        degraded: [],
      };
    },
    async complete(req: HarnessCompleteRequest) {
      seen.push({ purpose: req.purpose ?? "ask", prompt: req.prompt });
      const c = calls[seen.length - 1];
      // A real completion reports after a round trip: concurrent calls have all started by then.
      await new Promise((r) => setTimeout(r, 0));
      if (!c) throw new Error(`unscripted completion #${seen.length}`);
      if (c.usage) req.onUsage?.(c.usage);
      return c.answer;
    },
  };
  return { harness, seen, runs: () => runs };
}

const t = (n: number): NodeUsage => ({ inputTokens: n, outputTokens: 0 });

function github(writes: string[]): Skill {
  const tool = (name: string, access: "read" | "write"): Tool => ({
    name,
    description: name,
    input_schema: { type: "object" },
    access,
    handler: async () => {
      if (access === "write") writes.push(name);
      return { number: 1 };
    },
  });
  return {
    id: "github",
    name: "GitHub",
    description: "",
    category: "git",
    config: {},
    tools: [tool("github_get_issue", "read"), tool("github_create_issue", "write")],
  };
}

const screened = (budget?: Workflow["budget"]) =>
  ({
    id: "screened",
    name: "Screened",
    description: "",
    entry: "report",
    nodes: { report: { name: "Report", instruction: "Report it", skills: ["github"], outputs: [{ type: "issue" }] } },
    edges: [],
    safe_outputs: { screen: true },
    ...(budget ? { budget } : {}),
  }) as unknown as Workflow;

describe("a crossing after the node ran is enforced, not just counted", () => {
  const runScreened = async (budget?: Workflow["budget"]) => {
    const writes: string[] = [];
    const h = scripted(t(10), [{ usage: t(60), answer: "ALLOW" }]);
    const { results, trace } = await execute(
      screened(budget),
      {},
      {
        skills: createSkillMap([github(writes)]),
        harness: h.harness,
        config: {},
        logger: silent,
        harnessPolicy: "warn",
        env: { GITHUB_REPOSITORY: "acme/api" },
      },
    );
    return { results, trace, writes, h };
  };

  it("control: a screen under the budget allows the write", async () => {
    const { results, writes, trace } = await runScreened({ tokens: 1000 });
    expect(results.get("report")!.status).toBe("success");
    expect(writes).toEqual(["github_create_issue"]);
    expect(trace.spend?.screen).toEqual({ tokens: 60, costUsd: 0, calls: 1 });
  });

  it("a screen that crosses the run budget vetoes the writes, fails the node and the run", async () => {
    const { results, writes, trace } = await runScreened({ tokens: 50 });
    const r = results.get("report")!;
    expect(writes).toEqual([]);
    expect(r.outputs?.[0]).toMatchObject({ status: "vetoed" });
    expect(r.status).toBe("failed");
    expect(r.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 70, kind: "screen" });
    const summary = summarizeRun(results, 1, false, trace);
    expect(summary.ok).toBe(false);
    expect(summary.budget).toMatchObject({ node: "report", scope: "run", spent: 70 });
  });

  // A route answer that names no edge, with no default edge, ends the run
  // (`next: null`). Core's evaluate() already rejects such an answer, so a
  // legacy `Claude` client whose evaluate returns it as-is reaches this path.
  const endingRoute = (budget: Workflow["budget"]) => {
    const evaluated: string[] = [];
    const claude: Claude = {
      async run() {
        return { status: "success", data: { done: true }, toolCalls: [], usage: t(10) };
      },
      async evaluate(opts) {
        evaluated.push(opts.question);
        opts.onUsage?.(t(100));
        return "nowhere";
      },
      async ask() {
        return "";
      },
    };
    return execute(
      wf({ route: true, budget }),
      {},
      { skills: createSkillMap([]), claude, config: {}, logger: silent, env: {} },
    ).then((r) => ({ ...r, evaluated }));
  };

  it("a route call that crosses the run budget and ends the run fails the node it left", async () => {
    const { results, trace, evaluated } = await endingRoute({ tokens: 50 });
    expect(evaluated).toHaveLength(1);
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 110, kind: "route" });
    expect(a.data).toMatchObject({ budget_exceeded: true });
    expect(results.has("b")).toBe(false);
    const summary = summarizeRun(results, 1, false, trace);
    expect(summary.ok).toBe(false);
    expect(summary.budget).toMatchObject({ node: "a", scope: "run" });
  });

  it("control: the same route under the budget ends the run with the node as it was", async () => {
    const { results } = await endingRoute({ tokens: 1000 });
    expect(results.get("a")!.status).toBe("success");
    expect(results.get("a")!.budget).toBeUndefined();
  });
});

describe("retry reflection is metered as reflect", () => {
  const reflecting = (budget?: Workflow["budget"]) =>
    ({
      id: "reflecting",
      name: "Reflecting",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do a",
          skills: [],
          eval: [{ name: "has_ok", kind: "value", rule: { output_required: ["ok"] } }],
          retry: { max: 1, instruction: { auto: true } },
        },
      },
      edges: [],
      ...(budget ? { budget } : {}),
    }) as unknown as Workflow;

  it("the reflection completion's usage is counted under reflect; attempts stay node", async () => {
    const h = scripted(t(10), [{ usage: t(40), answer: "try harder" }], [{ done: true }, { ok: true }]);
    const { results, trace } = await execute(
      reflecting(),
      {},
      { skills: createSkillMap([]), harness: h.harness, config: {}, logger: silent, harnessPolicy: "warn", env: {} },
    );
    expect(results.get("a")!.status).toBe("success");
    expect(h.runs()).toBe(2);
    expect(trace.spend).toEqual({
      node: { tokens: 20, costUsd: 0, calls: 2 },
      reflect: { tokens: 40, costUsd: 0, calls: 1 },
    });
    // Totals are the split's sum (both attempts), not the last node result alone.
    expect(summarizeRun(results, 1, false, trace).tokens).toBe(60);
  });

  it("no paid reflection once the node already spent its budget", async () => {
    // The attempt spends exactly the limit: not over, but nothing more may start.
    const h = scripted(t(10), [{ usage: t(40), answer: "try harder" }], [{ done: true }, { ok: true }]);
    const wfl = reflecting();
    (wfl.nodes.a as { budget?: unknown }).budget = { tokens: 10 };
    const { results } = await execute(
      wfl,
      {},
      {
        skills: createSkillMap([]),
        harness: h.harness,
        config: {},
        logger: silent,
        harnessPolicy: "warn",
        env: {},
      },
    );
    expect(h.seen).toEqual([]);
    expect(h.runs()).toBe(1);
    expect(results.get("a")!.budget).toEqual({ scope: "node", unit: "tokens", limit: 10, spent: 10 });
  });
});

describe("no paid judge once a ceiling is reached", () => {
  it("a node that spent exactly the run budget fails before its judge is asked", async () => {
    const f = fake({ node: { inputTokens: 80, outputTokens: 0 }, judge: judge100 });
    const { results } = await exec(wf({ judge: true, budget: { tokens: 80 } }), f);
    expect(f.completes).toEqual([]);
    expect(results.get("a")!.status).toBe("failed");
    expect(results.get("a")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 80, spent: 80 });
    // A refused judge is no answer: no invented parse failure in the verdicts.
    expect(JSON.stringify(results.get("a")!.evals ?? [])).not.toMatch(/parse failure/);
  });
});

describe("calls do not depend on whether a limit is set", () => {
  it("identical input gives identical calls with and without a budget", async () => {
    const runIt = async (budget?: Workflow["budget"], node?: NodeUsage) => {
      const f = fake({ ...(node ? { node } : {}), judge: judge100, route: route50 });
      return (await exec(wf({ judge: true, route: true, ...(budget ? { budget } : {}) }), f)).trace.spend;
    };
    expect(await runIt({ tokens: 100_000 }, node10)).toEqual(await runIt(undefined, node10));
    // Node runs that report nothing are not calls, limit or not.
    const unreported = await runIt({ tokens: 100_000 });
    expect(unreported).toEqual(await runIt(undefined));
    expect(unreported?.node).toBeUndefined();
  });

  it("seeded (resumed) spend counts toward the total but is not a call", () => {
    const g = new BudgetGuard({ tokens: 100 });
    g.seed({ tokens: 30, costUsd: 0 });
    expect(g.totals.tokens).toBe(30);
    expect(g.breakdown().node).toEqual({ tokens: 30, costUsd: 0, calls: 0 });
    g.seed({ tokens: 0, costUsd: 0 });
    const empty = new BudgetGuard({});
    empty.seed({ tokens: 0, costUsd: 0 });
    expect(empty.breakdown()).toEqual({});
  });
});

describe("float drift", () => {
  it("0.1 + 0.2 of a $0.30 budget is not a crossing, and the split reads 0.3", () => {
    const g = new BudgetGuard({ costUsd: 0.3 });
    expect(g.meter("judge", { costUsd: 0.1 })).toBeUndefined();
    expect(g.meter("judge", { costUsd: 0.2 })).toBeUndefined();
    expect(g.breakdown().judge?.costUsd).toBe(0.3);
    // At the ceiling, though: nothing more may start.
    expect(g.runExhausted()).toMatchObject({ unit: "cost_usd", limit: 0.3, spent: 0.3 });
    // A real crossing still stops, and reads as one.
    expect(g.meter("route", { costUsd: 0.01 })).toMatchObject({ spent: 0.31 });
  });
});

describe("trace.spend on a journal failure", () => {
  it("is refreshed when a journal write stops the run", async () => {
    const { JournalWriteError } = await import("../journal.js");
    const f = fake({ node: node10, judge: judge100 });
    const journal = {
      begin() {},
      replay() {
        return undefined;
      },
      nodeStart() {},
      nodeEnd(node: string) {
        if (node === "b") throw new JournalWriteError("disk full");
      },
      checkpoint() {},
      route() {},
      wrapWrites: (_n: string, _i: number, s: unknown) => s,
    };
    const { results, trace } = await exec(wf({ judge: true }), f, {
      journal: journal as unknown as ExecuteOptions["journal"],
    });
    expect(results.get("b")!.data).toMatchObject({ journal_failed: true });
    // The judge on `a` was the last report that synced the split; `b`'s run is in it too.
    expect(trace.spend).toEqual({
      node: { tokens: 20, costUsd: 0, calls: 2 },
      judge: { tokens: 100, costUsd: 0, calls: 1 },
    });
  });
});

describe("no executor completion starts once a ceiling is reached", () => {
  it("a skipped node cannot carry the run past a route's crossing (limit 50, agent 10, route 100)", async () => {
    // a -> s1 -> s2, both s1 and s2 skipped by `requires`, each routed by a model call.
    const skipped = { requires: { output_required: ["input.missing"], on_fail: "skip" } };
    const workflow = {
      id: "skips",
      name: "Skips",
      description: "",
      entry: "a",
      budget: { tokens: 50 },
      nodes: {
        a: { name: "A", instruction: "Do a", skills: [] },
        s1: { name: "S1", instruction: "Do s1", skills: [], ...skipped },
        s2: { name: "S2", instruction: "Do s2", skills: [], ...skipped },
        y: { name: "Y", instruction: "Do y", skills: [] },
        z: { name: "Z", instruction: "Do z", skills: [] },
      },
      edges: [
        { from: "a", to: "s1", when: "go on" },
        { from: "a", to: "y", when: "stop" },
        { from: "s1", to: "s2", when: "go on" },
        { from: "s1", to: "z", when: "stop" },
      ],
    } as unknown as Workflow;
    const h = scripted(t(10), [
      { usage: t(100), answer: "s1" },
      { usage: t(100), answer: "s2" },
    ]);
    const { results, trace } = await execute(
      workflow,
      {},
      { skills: createSkillMap([]), harness: h.harness, config: {}, logger: silent, harnessPolicy: "warn", env: {} },
    );
    expect(h.seen.map((c) => c.purpose)).toEqual(["evaluate"]);
    const s1 = results.get("s1")!;
    expect(s1.status).toBe("failed");
    expect(s1.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 110 });
    expect(results.has("s2")).toBe(false);
    const summary = summarizeRun(results, 1, false, trace);
    expect(summary.ok).toBe(false);
    expect(summary.tokens).toBe(110);
  });

  it("a skipped node with a free route on cannot end the run ok after a crossing", async () => {
    // a -(paid route, crosses)-> s1 (skipped) -(unconditional, no model call)-> s2 (skipped), then the end.
    const skipped = { requires: { output_required: ["input.missing"], on_fail: "skip" } };
    const workflow = {
      id: "skips-free",
      name: "Skips",
      description: "",
      entry: "a",
      budget: { tokens: 50 },
      nodes: {
        a: { name: "A", instruction: "Do a", skills: [] },
        s1: { name: "S1", instruction: "Do s1", skills: [], ...skipped },
        s2: { name: "S2", instruction: "Do s2", skills: [], ...skipped },
        y: { name: "Y", instruction: "Do y", skills: [] },
      },
      edges: [
        { from: "a", to: "s1", when: "go on" },
        { from: "a", to: "y", when: "stop" },
        { from: "s1", to: "s2" },
      ],
    } as unknown as Workflow;
    const h = scripted(t(10), [{ usage: t(100), answer: "s1" }]);
    const { results, trace } = await execute(
      workflow,
      {},
      { skills: createSkillMap([]), harness: h.harness, config: {}, logger: silent, harnessPolicy: "warn", env: {} },
    );
    expect(results.get("s1")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 110 });
    expect(results.has("s2")).toBe(false);
    expect(summarizeRun(results, 1, false, trace).ok).toBe(false);
  });

  it("a judge parse retry after a crossing is refused (limit 50, first judge 100, malformed)", async () => {
    const h = scripted(t(10), [
      { usage: t(100), answer: "not a verdict" },
      { usage: t(100), answer: "VERDICT: yes\nREASONING: ok" },
    ]);
    const { results, trace } = await execute(
      wf({ judge: true, budget: { tokens: 50 } }),
      {},
      { skills: createSkillMap([]), harness: h.harness, config: {}, logger: silent, harnessPolicy: "warn", env: {} },
    );
    expect(h.seen).toHaveLength(1);
    expect(results.get("a")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 110, kind: "judge" });
    expect(trace.spend?.judge).toEqual({ tokens: 100, costUsd: 0, calls: 1 });
  });

  it("a route call is refused once the run budget is spent, and the stop lands on the node it left", async () => {
    // The node spends exactly the limit: the route would be a paid call past it.
    const h = scripted(t(50), [{ usage: t(100), answer: "b" }]);
    const { results } = await execute(
      wf({ route: true, budget: { tokens: 50 } }),
      {},
      { skills: createSkillMap([]), harness: h.harness, config: {}, logger: silent, harnessPolicy: "warn", env: {} },
    );
    expect(h.seen).toEqual([]);
    expect(results.get("a")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 50 });
    expect(results.has("b")).toBe(false);
  });
});

describe("a meter record the journal cannot write stops the run", () => {
  it("the judge's node fails with the journal reason and nothing routes on", async () => {
    const { JournalWriteError } = await import("../journal.js");
    const f = fake({ node: node10, judge: judge100, route: route50 });
    const journal = {
      begin() {},
      replay() {
        return undefined;
      },
      nodeStart() {},
      nodeEnd() {},
      checkpoint() {},
      route() {},
      meter() {
        throw new JournalWriteError("disk full");
      },
      wrapWrites: (_n: string, _i: number, s: unknown) => s,
    };
    const { results } = await exec(wf({ judge: true, route: true }), f, {
      journal: journal as unknown as ExecuteOptions["journal"],
    });
    expect(results.get("a")!.data).toMatchObject({ journal_failed: true });
    expect(f.completes).toEqual(["ask"]);
    expect(f.runs).toEqual(["a"]);
  });
});

describe("round 2", () => {
  it("with a budget, judges run one at a time: three 100-token judges at a 50 limit spend 110, not 300", async () => {
    const h = scripted(t(10), [
      { usage: t(100), answer: "VERDICT: yes\nREASONING: ok" },
      { usage: t(100), answer: "VERDICT: yes\nREASONING: ok" },
      { usage: t(100), answer: "VERDICT: yes\nREASONING: ok" },
    ]);
    const base = wf({ budget: { tokens: 50 } });
    base.nodes.a.eval = ["j1", "j2", "j3"].map((name) => ({
      name,
      kind: "judge",
      rubric: "good?",
      pass_when: "yes",
    })) as never;
    const { results, trace } = await execute(
      base,
      {},
      {
        skills: createSkillMap([]),
        harness: h.harness,
        config: {},
        logger: silent,
        harnessPolicy: "warn",
        env: {},
      },
    );
    expect(h.seen).toHaveLength(1);
    expect(results.get("a")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 110, kind: "judge" });
    expect(trace.spend?.judge).toEqual({ tokens: 100, costUsd: 0, calls: 1 });
  });

  it("with no limit, live-only node usage still reaches the split", async () => {
    const h = scripted(undefined, [{ usage: t(5), answer: "VERDICT: yes\nREASONING: ok" }]);
    const run = h.harness.run.bind(h.harness);
    h.harness.run = async (req) => {
      req.onUsage?.({ inputTokens: 20, outputTokens: 0 });
      req.onUsage?.({ inputTokens: 30, outputTokens: 0 });
      return run(req);
    };
    const { trace } = await execute(
      wf({ judge: true }),
      {},
      {
        skills: createSkillMap([]),
        harness: h.harness,
        config: {},
        logger: silent,
        harnessPolicy: "warn",
        env: {},
      },
    );
    // Nodes a and b each report 30 live and no final usage.
    expect(trace.spend?.node).toEqual({ tokens: 60, costUsd: 0, calls: 2 });
  });

  it("a screen whose meter record cannot be journaled allows nothing", async () => {
    const { JournalWriteError } = await import("../journal.js");
    const writes: string[] = [];
    const h = scripted(t(10), [{ usage: t(5), answer: "ALLOW" }]);
    const journal = {
      begin() {},
      replay() {
        return undefined;
      },
      nodeStart() {},
      nodeEnd() {},
      checkpoint() {},
      route() {},
      meter() {
        throw new JournalWriteError("disk full");
      },
      wrapWrites: (_n: string, _i: number, sk: unknown) => sk,
    };
    const { results } = await execute(
      screened(),
      {},
      {
        skills: createSkillMap([github(writes)]),
        harness: h.harness,
        config: {},
        logger: silent,
        harnessPolicy: "warn",
        env: { GITHUB_REPOSITORY: "acme/api" },
        journal: journal as unknown as ExecuteOptions["journal"],
      },
    );
    expect(writes).toEqual([]);
    expect(results.get("report")!.data).toMatchObject({ journal_failed: true });
  });
});

describe("round 3", () => {
  const silentObs = () => {
    const events: Array<Record<string, unknown>> = [];
    return { events, observer: (e: unknown) => events.push(e as Record<string, unknown>) };
  };
  const endingFrom = (status: "success" | "failed", onFail?: "continue") => {
    const claude: Claude = {
      async run() {
        return status === "success"
          ? { status, data: { done: true }, toolCalls: [], usage: t(10) }
          : { status, data: { error: "agent broke" }, toolCalls: [], usage: t(10) };
      },
      async evaluate(opts) {
        opts.onUsage?.(t(100));
        return "nowhere";
      },
      async ask() {
        return "";
      },
    };
    const workflow = wf({ route: true, budget: { tokens: 50 } });
    if (onFail) (workflow.nodes.a as { on_fail?: string }).on_fail = onFail;
    const obs = silentObs();
    return execute(
      workflow,
      {},
      { skills: createSkillMap([]), claude, config: {}, logger: silent, env: {}, observer: obs.observer as never },
    ).then((r) => ({ ...r, events: obs.events }));
  };

  it("a route stop from a node that already failed keeps its own error; the budget reason has its own field", async () => {
    const { results } = await endingFrom("failed", "continue");
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.data).toMatchObject({ error: "agent broke", budget_exceeded: true });
    expect(String(a.data.budget_error)).toMatch(/run budget exceeded/);
  });

  it("after a route stop: one exit per visit, a node:amended with the failure, the trace step failed, one end route", async () => {
    const { trace, events } = await endingFrom("success");
    expect(trace.steps.filter((st) => st.node === "a").at(-1)!.status).toBe("failed");
    const exits = events.filter((e) => e.type === "node:exit" && e.node === "a");
    expect(exits).toHaveLength(1);
    const amended = events.filter((e) => e.type === "node:amended" && e.node === "a");
    expect(amended).toHaveLength(1);
    expect((amended[0].result as { status: string }).status).toBe("failed");
    // Routing announced its own end (an invalid target): no second end event.
    expect(events.filter((e) => e.type === "route" && e.from === "a" && e.to === "(end)")).toHaveLength(1);
    const timer = createNodeTimer();
    for (const e of events) timer.observer(e as never);
    expect(timer.lastResults.get("a")!.status).toBe("failed");
  });

  it("a refused route announces its own budget end, once", async () => {
    const claude: Claude = {
      async run() {
        return { status: "success", data: { done: true }, toolCalls: [], usage: t(50) };
      },
      async evaluate() {
        throw new Error("must not be called");
      },
      async ask() {
        return "";
      },
    };
    const obs = silentObs();
    await execute(
      wf({ route: true, budget: { tokens: 50 } }),
      {},
      { skills: createSkillMap([]), claude, config: {}, logger: silent, env: {}, observer: obs.observer as never },
    );
    const ends = obs.events.filter((e) => e.type === "route" && e.from === "a" && e.to === "(end)");
    expect(ends).toEqual([expect.objectContaining({ reason: "budget exceeded" })]);
  });

  it("sequential judges stop at an abort between them", async () => {
    const ac = new AbortController();
    const h = scripted(t(10), [
      { usage: t(1), answer: "VERDICT: yes\nREASONING: ok" },
      { usage: t(1), answer: "VERDICT: yes\nREASONING: ok" },
    ]);
    const complete = h.harness.complete.bind(h.harness);
    h.harness.complete = async (req) => {
      const out = await complete(req);
      ac.abort();
      return out;
    };
    const base = wf({ budget: { tokens: 1000 } });
    base.nodes.a.eval = ["j1", "j2"].map((name) => ({
      name,
      kind: "judge",
      rubric: "good?",
      pass_when: "yes",
    })) as never;
    await expect(
      execute(
        base,
        {},
        {
          skills: createSkillMap([]),
          harness: h.harness,
          config: {},
          logger: silent,
          harnessPolicy: "warn",
          env: {},
          signal: ac.signal,
        },
      ),
    ).rejects.toThrow(/aborted/);
    expect(h.seen).toHaveLength(1);
  });
});
