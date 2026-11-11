/**
 * The shared spend tally (#575, RFC 0002 M1, milestone 4): one run cap over a
 * map's children, settled once per attempt, live spend counted while running,
 * admission stopping at the cap, strict runs serially, per-item caps.
 */
import { describe, it, expect } from "vitest";

import { BudgetGuard, SpendTally, toLimits } from "../../budget.js";
import { execute } from "../../executor.js";
import { createMemoryChildHost } from "../../child-host.js";
import type { ChildRunHost } from "../../map.js";
import type { Claude, Node, NodeResult, NodeUsage, Workflow } from "../../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe("SpendTally", () => {
  it("starts from the run's spend, and is exhausted at the cap", () => {
    const t = new SpendTally({ tokens: 100 }, { tokens: 40, costUsd: 0 });
    expect(t.committed).toEqual({ tokens: 40, costUsd: 0 });
    expect(t.exhausted()).toBeUndefined();
    t.commit({ tokens: 60, costUsd: 0.5 }, "node");
    expect(t.exhausted()).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 100 });
    expect(t.breach).toBeUndefined();
    expect(t.signal.aborted).toBe(false);
    expect(t.children).toEqual({ node: { tokens: 60, costUsd: 0.5 } });
    expect(t.childTotal).toEqual({ tokens: 60, costUsd: 0.5 });
  });

  it("checks settled plus live spend strictly over the cap, and trips once", () => {
    const t = new SpendTally({ tokens: 100 });
    const a = t.open();
    const b = t.open();
    a.set({ tokens: 60, costUsd: 0 });
    expect(t.check()).toBeUndefined();
    b.set({ tokens: 40, costUsd: 0 });
    expect(t.check()).toBeUndefined(); // exactly at the cap is not a crossing
    expect(t.check({ tokens: 41, costUsd: 0 }, b)).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 101 });
    expect(t.signal.aborted).toBe(true);
    expect(t.breach).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 101 });
    a.set({ tokens: 90, costUsd: 0 });
    t.check();
    expect(t.breach!.spent).toBe(101);
  });

  it("drops a closed attempt's live spend, and seeds earlier generations as node spend", () => {
    const t = new SpendTally({ costUsd: 1 });
    const a = t.open();
    a.set({ tokens: 0, costUsd: 0.9 });
    a.close();
    t.seed({ tokens: 10, costUsd: 0.25 });
    t.seed({ tokens: Number.NaN, costUsd: -1 });
    expect(t.committed).toEqual({ tokens: 10, costUsd: 0.25 });
    expect(t.check({ tokens: 0, costUsd: 0.7 })).toBeUndefined();
    expect(t.check({ tokens: 0, costUsd: 0.76 })).toEqual({ scope: "run", unit: "cost_usd", limit: 1, spent: 1.01 });
  });
});

describe("a child's BudgetGuard over a tally", () => {
  it("commits settled spend to both, seeds its own prior spend locally only, and folds into the parent", () => {
    const parent = new BudgetGuard({ tokens: 500 });
    parent.commit({ tokens: 100, costUsd: 0 }, "node", true);
    const tally = parent.shareWithChildren();
    expect(tally.limits).toEqual({ tokens: 500 });
    expect(tally.committed).toEqual({ tokens: 100, costUsd: 0 });
    const child = new BudgetGuard(toLimits({ tokens: 50 }), tally);
    expect(child.ceiling).toEqual({ tokens: 50 });
    expect(child.active({})).toBe(true);
    child.seed({ tokens: 20, costUsd: 0 });
    expect(child.totals).toEqual({ tokens: 20, costUsd: 0 });
    expect(tally.committed).toEqual({ tokens: 100, costUsd: 0 });
    child.commit({ tokens: 25, costUsd: 0.1 }, "node", true);
    child.meter("judge", { inputTokens: 5, costUsd: 0.05 });
    expect(child.totals).toEqual({ tokens: 50, costUsd: 0.15000000000000002 });
    expect(tally.committed.tokens).toBe(130);
    expect(tally.children).toEqual({ node: { tokens: 25, costUsd: 0.1 }, judge: { tokens: 5, costUsd: 0.05 } });
    parent.absorb(tally.children);
    expect(parent.totals.tokens).toBe(130);
    expect(parent.breakdown()).toEqual({
      node: { tokens: 125, costUsd: 0.1, calls: 1 },
      judge: { tokens: 5, costUsd: 0.05, calls: 0 },
    });
  });

  it("is exhausted when the shared cap is, though its own cap is not", () => {
    const tally = new SpendTally({ tokens: 100 }, { tokens: 100, costUsd: 0 });
    const child = new BudgetGuard({}, tally);
    expect(child.ceiling).toEqual({ tokens: 100 });
    expect(child.runExhausted()).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 100 });
  });

  it("a live report that crosses the shared cap stops its attempt and trips the tally for every child", () => {
    const tally = new SpendTally({ tokens: 100 });
    const one = new BudgetGuard({}, tally).node({}).attempt();
    const two = new BudgetGuard({}, tally).node({}).attempt();
    one.onUsage({ inputTokens: 60 });
    expect(one.breach).toBeUndefined();
    two.onUsage({ inputTokens: 60 });
    expect(two.breach).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 120 });
    expect(two.signal.aborted).toBe(true);
    expect(tally.signal.aborted).toBe(true);
    // Settling commits each attempt once; live spend is then gone.
    two.settle();
    one.settle({ inputTokens: 70 });
    expect(tally.committed).toEqual({ tokens: 130, costUsd: 0 });
    expect(tally.check()).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 130 });
  });
});

// ─── Through the executor ────────────────────────────────────────

const CHILD = {
  entry: "draft",
  nodes: {
    draft: {
      name: "Draft",
      instruction: "Draft.",
      skills: [],
      output: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
    },
  },
  edges: [],
};

function wf(map: Partial<Node> = {}, extra: Partial<Workflow> = {}): Workflow {
  return {
    id: "p",
    name: "P",
    description: "",
    spec_version: "3",
    entry: "m",
    nodes: {
      m: {
        kind: "map",
        name: "M",
        skills: [],
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        key: "id",
        workflow: CHILD as never,
        result: "draft",
        concurrency: 2,
        ...map,
      } as Node,
    },
    edges: [],
    ...extra,
  };
}

/** Each child reports `live` while running (then waits a little), and `final` on its result. */
function spender(live: NodeUsage | undefined, final?: NodeUsage, parent: Record<string, NodeResult> = {}) {
  const started: string[] = [];
  let running = 0;
  let max = 0;
  const claude: Claude = {
    async run(req) {
      if (req.nodeId && parent[req.nodeId]) return parent[req.nodeId];
      started.push((req.context as { input: { item_key: string } }).input.item_key);
      running++;
      max = Math.max(max, running);
      try {
        if (live) req.onUsage?.(live);
        await tick(10);
        if (req.signal?.aborted) return { status: "failed", data: { error: "aborted" }, toolCalls: [] };
        return { status: "success", data: { prompt: "x" }, toolCalls: [], ...(final ? { usage: final } : {}) };
      } finally {
        running--;
      }
    },
    async evaluate() {
      throw new Error("no routing");
    },
    async ask() {
      throw new Error("no completions");
    },
  };
  return { claude, started, max: () => max };
}

const go = (
  w: Workflow,
  claude: Claude,
  extra: Record<string, unknown> = {},
  host: ChildRunHost = createMemoryChildHost(),
) => execute(w, {}, { skills: new Map(), claude, logger: silent, children: host, harnessPolicy: "default", ...extra });

describe("a budgeted map", () => {
  it("2 x 60 live against a 100 cap: no third child starts, and the map stops on the run budget", async () => {
    const { claude, started } = spender({ inputTokens: 60 });
    const res = await go(wf({}, { budget: { tokens: 100 } }), claude);
    expect(started).toEqual(["a", "b"]);
    const m = res.results.get("m")!;
    expect(m.status).toBe("failed");
    expect(m.budget).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 120 });
    expect((m.data as Record<string, unknown>).error).toBe("run budget exceeded: tokens 120 of 100");
    expect((m.data as Record<string, unknown>).budget_exceeded).toBe(true);
    expect((m.data as { items: Record<string, unknown> }).items.c).toEqual({
      status: "cancelled",
      error: "not started: the run budget is spent",
    });
    expect(m.usage).toEqual({ inputTokens: 120, costUsd: 0 });
  });

  it("warns budget_concurrent when it runs concurrently under a budget", async () => {
    const { claude, max } = spender(undefined, { inputTokens: 1 });
    const res = await go(wf({}, { budget: { tokens: 1000 } }), claude);
    expect(max()).toBe(2);
    expect(res.results.get("m")!.degraded).toEqual([
      'budget_concurrent: map node "m" runs up to 2 children at once under a run budget; the cap is checked when ' +
        "each child starts and on live reports, so concurrent children can overrun it (strict harness policy runs " +
        "them one at a time)",
    ]);
  });

  it("runs serially under strict harness policy, so admission sees settled spend before each child", async () => {
    const { claude, started, max } = spender(undefined, { inputTokens: 60 });
    const res = await go(wf({}, { budget: { tokens: 100 } }), claude, { harnessPolicy: "strict" });
    expect(max()).toBe(1);
    expect(started).toEqual(["a", "b"]);
    const m = res.results.get("m")!;
    expect(m.budget).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 120 });
    expect(m.degraded).toBeUndefined();
  });

  it("an unbudgeted map runs at its concurrency with no warning", async () => {
    const { claude, max } = spender(undefined, { inputTokens: 60 });
    const res = await go(wf(), claude, { harnessPolicy: "strict" });
    expect(max()).toBe(2);
    expect(res.results.get("m")!.status).toBe("success");
    expect(res.results.get("m")!.degraded).toBeUndefined();
  });

  it("item_budget caps each child as its own run budget", async () => {
    const { claude } = spender(undefined, { inputTokens: 60 });
    const res = await go(wf({ items: [{ id: "a" }], item_budget: { tokens: 50 } }), claude);
    const m = res.results.get("m")!;
    expect((m.data as { items: Record<string, unknown> }).items.a).toEqual({
      status: "failed",
      error: 'node "draft" failed: run budget exceeded: tokens 60 of 50',
    });
    expect(m.budget).toBeUndefined();
  });

  it("the children's spend is the run's: a later node starts from it", async () => {
    const { claude } = spender(
      undefined,
      { inputTokens: 60 },
      {
        after: { status: "success", data: {}, toolCalls: [], usage: { inputTokens: 20 } },
      },
    );
    const w = wf({ items: [{ id: "a" }, { id: "b" }] }, { budget: { tokens: 130 } });
    w.nodes.after = { name: "After", instruction: "x", skills: [] };
    w.edges = [{ from: "m", to: "after" }];
    const res = await go(w, claude);
    expect(res.results.get("m")!.status).toBe("success");
    expect(res.results.get("after")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 130, spent: 140 });
  });

  it("starts from every earlier generation's journaled spend (resume)", async () => {
    const { claude, started } = spender({ inputTokens: 20 });
    const base = createMemoryChildHost({ runId: "p" });
    const host: ChildRunHost = { ...base, spent: (refs) => ({ tokens: 30 * refs.length, costUsd: 0 }) };
    const res = await go(
      wf({ items: [{ id: "a" }, { id: "b" }, { id: "c" }], concurrency: 1 }, { budget: { tokens: 100 } }),
      claude,
      {},
      host,
    );
    // 90 seeded: the first child's live 20 crosses the cap.
    expect(started).toEqual(["a"]);
    expect(res.results.get("m")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 110 });
  });
});
