/**
 * Edge assertions found by mutation testing (see stryker.config.json): the
 * per-kind split (`breakdown`, `meter`, `seed` by kind), what counts as a call,
 * and the float slack on the limit comparisons in budget.ts.
 */
import { describe, expect, it } from "vitest";
import { BudgetGuard, BudgetRefusal, describeOverrun } from "../../budget.js";

describe("BudgetRefusal", () => {
  it("names itself and carries the breach and its one-line description", () => {
    const breach = { scope: "run" as const, unit: "tokens" as const, limit: 10, spent: 12, kind: "judge" as const };
    const err = new BudgetRefusal(breach);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BudgetRefusal");
    expect(err.breach).toBe(breach);
    expect(err.message).toBe(describeOverrun(breach));
    expect(String(err)).toBe("BudgetRefusal: run budget exceeded: tokens 12 of 10");
  });
});

describe("limit comparisons: float slack of 1e-9", () => {
  it("a live or final crossing must clear the limit by more than the slack", () => {
    const at = new BudgetGuard({}).node({ costUsd: 1 }).attempt();
    expect(at.finish({ costUsd: 1 + 1e-9 })).toBeUndefined();
    const past = new BudgetGuard({}).node({ costUsd: 1 }).attempt();
    expect(past.finish({ costUsd: 1 + 1e-8 })).toStrictEqual({
      scope: "node",
      unit: "cost_usd",
      limit: 1,
      spent: 1.00000001,
    });
  });

  it("exhaustion counts spend within the slack below the limit as reached", () => {
    const g = new BudgetGuard({ costUsd: 1 });
    g.seed({ tokens: 0, costUsd: 1 - 1e-9 });
    expect(g.runExhausted()).toMatchObject({ scope: "run", unit: "cost_usd", limit: 1 });
    const short = new BudgetGuard({ costUsd: 1 });
    short.seed({ tokens: 0, costUsd: 1 - 1e-8 });
    expect(short.runExhausted()).toBeUndefined();
  });

  it("float noise in a summed cost never reads as over the limit", () => {
    const node = new BudgetGuard({}).node({ costUsd: 0.3 });
    node.attempt().finish({ costUsd: 0.1 });
    expect(node.attempt().finish({ costUsd: 0.2 })).toBeUndefined();
  });
});

describe("BudgetGuard.breakdown", () => {
  it("is empty before any spend", () => {
    expect(new BudgetGuard({}).breakdown()).toStrictEqual({});
  });

  it("lists every kind in SPEND_KINDS order with tokens, rounded cost and calls", () => {
    const g = new BudgetGuard({});
    g.meter("screen", { inputTokens: 1, costUsd: 0.1 });
    g.meter("reflect", { inputTokens: 2, costUsd: 0.2 });
    g.meter("route", { inputTokens: 3 });
    g.meter("judge", { outputTokens: 4, costUsd: 0.1 });
    g.meter("judge", { costUsd: 0.2 });
    g.node({}).attempt().finish({ inputTokens: 5, costUsd: 0.5 });
    const b = g.breakdown();
    expect(Object.keys(b)).toStrictEqual(["node", "judge", "route", "reflect", "screen"]);
    expect(b).toStrictEqual({
      node: { tokens: 5, costUsd: 0.5, calls: 1 },
      // 0.1 + 0.2 is 0.30000000000000004 before rounding.
      judge: { tokens: 4, costUsd: 0.3, calls: 2 },
      route: { tokens: 3, costUsd: 0, calls: 1 },
      reflect: { tokens: 2, costUsd: 0.2, calls: 1 },
      screen: { tokens: 1, costUsd: 0.1, calls: 1 },
    });
    expect(g.totals).toStrictEqual({ tokens: 15, costUsd: 0.1 + 0.2 + 0.1 + 0.2 + 0.5 });
  });
});

describe("BudgetGuard.hasMeteredCalls", () => {
  it("is false with no spend, and with node spend only", () => {
    const g = new BudgetGuard({});
    expect(g.hasMeteredCalls).toBe(false);
    g.node({}).attempt().finish({ inputTokens: 5 });
    expect(g.hasMeteredCalls).toBe(false);
  });

  it("is true once a non-node completion reported usage, beside node spend", () => {
    const g = new BudgetGuard({});
    g.node({}).attempt().finish({ inputTokens: 5 });
    g.meter("route", { inputTokens: 1 });
    expect(g.hasMeteredCalls).toBe(true);
  });

  it("is true for a metered completion alone", () => {
    const g = new BudgetGuard({});
    g.meter("screen", { costUsd: 0.01 });
    expect(g.hasMeteredCalls).toBe(true);
  });
});

describe("BudgetGuard.meter", () => {
  it("counts nothing for a missing or empty usage report", () => {
    const g = new BudgetGuard({ tokens: 1 });
    expect(g.meter("judge", undefined)).toBeUndefined();
    expect(g.meter("judge", {})).toBeUndefined();
    expect(g.meter("judge", { inputTokens: NaN })).toBeUndefined();
    expect(g.breakdown()).toStrictEqual({});
    expect(g.totals).toStrictEqual({ tokens: 0, costUsd: 0 });
    expect(g.hasMeteredCalls).toBe(false);
  });

  it("counts a cost-only report, and a tokens-only report adds zero cost", () => {
    const g = new BudgetGuard({});
    g.meter("judge", { costUsd: 0.25 });
    g.meter("judge", { inputTokens: 10 });
    expect(g.totals).toStrictEqual({ tokens: 10, costUsd: 0.25 });
    expect(g.breakdown()).toStrictEqual({ judge: { tokens: 10, costUsd: 0.25, calls: 2 } });
  });

  it("returns a run breach tagged with the completion's kind, strictly over, counting earlier spend", () => {
    const g = new BudgetGuard({ tokens: 100, costUsd: 1 });
    g.seed({ tokens: 60, costUsd: 0.5 });
    expect(g.meter("route", { inputTokens: 40 })).toBeUndefined();
    expect(g.meter("route", { costUsd: 0.5 })).toBeUndefined();
    expect(g.meter("route", { inputTokens: 1 })).toStrictEqual({
      scope: "run",
      unit: "tokens",
      limit: 100,
      spent: 101,
      kind: "route",
    });
    // The breaching report is still counted.
    expect(g.totals).toStrictEqual({ tokens: 101, costUsd: 1 });
    expect(g.breakdown().route).toStrictEqual({ tokens: 41, costUsd: 0.5, calls: 3 });
  });

  it("judges a run cost crossing against the total before the report", () => {
    const g = new BudgetGuard({ costUsd: 1 });
    g.seed({ tokens: 0, costUsd: 0.75 });
    expect(g.meter("reflect", { costUsd: 0.5 })).toStrictEqual({
      scope: "run",
      unit: "cost_usd",
      limit: 1,
      spent: 1.25,
      kind: "reflect",
    });
  });

  it("does not tag a node-kind report with a kind", () => {
    const g = new BudgetGuard({ tokens: 5 });
    expect(g.meter("node", { inputTokens: 6 })).toStrictEqual({ scope: "run", unit: "tokens", limit: 5, spent: 6 });
  });

  it("through a node visit: checks the node's own limit with its committed spend first", () => {
    const g = new BudgetGuard({ tokens: 1000, costUsd: 100 });
    const node = g.node({ tokens: 50, costUsd: 1 });
    node.attempt().finish({ inputTokens: 20, costUsd: 0.5 });
    // Exactly at the node limit is not a breach.
    expect(node.meter("judge", { inputTokens: 30 })).toBeUndefined();
    expect(node.meter("judge", { costUsd: 0.5 })).toBeUndefined();
    expect(node.meter("judge", { costUsd: 0.25 })).toStrictEqual({
      scope: "node",
      unit: "cost_usd",
      limit: 1,
      spent: 1.25,
      kind: "judge",
    });
    expect(node.committed).toStrictEqual({ tokens: 50, costUsd: 1.25 });
    expect(g.totals).toStrictEqual({ tokens: 50, costUsd: 1.25 });
    expect(g.breakdown()).toStrictEqual({
      node: { tokens: 20, costUsd: 0.5, calls: 1 },
      judge: { tokens: 30, costUsd: 0.75, calls: 3 },
    });
  });

  it("through a node visit: falls back to the run limit when the node limit holds", () => {
    const g = new BudgetGuard({ tokens: 10 });
    g.seed({ tokens: 8, costUsd: 0 });
    const node = g.node({ tokens: 100 });
    expect(node.meter("screen", { inputTokens: 3 })).toStrictEqual({
      scope: "run",
      unit: "tokens",
      limit: 10,
      spent: 11,
      kind: "screen",
    });
  });

  it("a node-limit token crossing adds the report to the visit's committed tokens", () => {
    const node = new BudgetGuard({}).node({ tokens: 10 });
    node.attempt().finish({ inputTokens: 6 });
    expect(node.meter("judge", { inputTokens: 5 })).toStrictEqual({
      scope: "node",
      unit: "tokens",
      limit: 10,
      spent: 11,
      kind: "judge",
    });
  });
});

describe("BudgetGuard.seed by kind", () => {
  it("restores each kind's spend without counting a call", () => {
    const g = new BudgetGuard({});
    g.seed({
      tokens: 999,
      costUsd: 999,
      byKind: {
        node: { tokens: 10, costUsd: 1 },
        judge: { tokens: 2, costUsd: 0.25 },
        reflect: { tokens: 3, costUsd: 0 },
        screen: { tokens: 0, costUsd: 0.5 },
      },
    });
    // The split, not the total, is what is restored.
    expect(g.totals).toStrictEqual({ tokens: 15, costUsd: 1.75 });
    expect(g.breakdown()).toStrictEqual({
      node: { tokens: 10, costUsd: 1, calls: 0 },
      judge: { tokens: 2, costUsd: 0.25, calls: 0 },
      reflect: { tokens: 3, costUsd: 0, calls: 0 },
      screen: { tokens: 0, costUsd: 0.5, calls: 0 },
    });
    expect(g.hasMeteredCalls).toBe(true);
  });

  it("drops non-finite, negative and zero fields per kind; an all-zero kind leaves no trace", () => {
    const g = new BudgetGuard({});
    g.seed({
      tokens: 0,
      costUsd: 0,
      byKind: {
        judge: { tokens: NaN, costUsd: -1 },
        route: { tokens: Infinity, costUsd: 0.5 },
      },
    });
    expect(g.breakdown()).toStrictEqual({ route: { tokens: 0, costUsd: 0.5, calls: 0 } });
    expect(g.totals).toStrictEqual({ tokens: 0, costUsd: 0.5 });
  });

  it("a total-only seed lands under node with no call", () => {
    const g = new BudgetGuard({});
    g.seed({ tokens: 7, costUsd: 0 });
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 7, costUsd: 0, calls: 0 } });
    expect(g.hasMeteredCalls).toBe(false);
  });

  it("a zero total-only seed leaves no trace", () => {
    const g = new BudgetGuard({});
    g.seed({ tokens: 0, costUsd: 0 });
    expect(g.breakdown()).toStrictEqual({});
  });

  it("a cost-only total seed still lands under node", () => {
    const g = new BudgetGuard({});
    g.seed({ tokens: 0, costUsd: 0.5 });
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 0, costUsd: 0.5, calls: 0 } });
  });

  it("seeded spend adds to later spend of the same kind", () => {
    const g = new BudgetGuard({});
    g.seed({ tokens: 0, costUsd: 0, byKind: { judge: { tokens: 5, costUsd: 0.5 } } });
    g.meter("judge", { inputTokens: 3, costUsd: 0.25 });
    expect(g.breakdown()).toStrictEqual({ judge: { tokens: 8, costUsd: 0.75, calls: 1 } });
  });
});

describe("what counts as a node call", () => {
  it("an attempt that reported nothing, live or final, leaves no trace", () => {
    const g = new BudgetGuard({});
    g.node({}).attempt().dispose();
    g.node({}).attempt().finish(undefined);
    g.node({}).attempt().finish({});
    expect(g.breakdown()).toStrictEqual({});
  });

  it("a live tokens report counts the attempt even when it settles with nothing", () => {
    const g = new BudgetGuard({});
    const a = g.node({}).attempt();
    a.onUsage({ inputTokens: 5 });
    a.dispose();
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 5, costUsd: 0, calls: 1 } });
  });

  it("a live cost report counts the attempt", () => {
    const g = new BudgetGuard({});
    const a = g.node({}).attempt();
    a.onUsage({ costUsd: 0.5 });
    a.dispose();
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 0, costUsd: 0.5, calls: 1 } });
  });

  it("a live report with zero usage still counts the call", () => {
    const g = new BudgetGuard({});
    const a = g.node({}).attempt();
    a.onUsage({ inputTokens: 0 });
    a.dispose();
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 0, costUsd: 0, calls: 1 } });
  });

  it("a live report without tokens or cost does not count", () => {
    const g = new BudgetGuard({});
    const a = g.node({}).attempt();
    a.onUsage({ cacheReadTokens: 9, numTurns: 2 });
    a.dispose();
    expect(g.breakdown()).toStrictEqual({});
  });

  it("a final tokens-only or cost-only report counts the attempt", () => {
    const g = new BudgetGuard({});
    g.node({}).attempt().finish({ outputTokens: 0 });
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 0, costUsd: 0, calls: 1 } });
    g.node({}).attempt().finish({ costUsd: 0 });
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 0, costUsd: 0, calls: 2 } });
  });

  it("settling twice counts the call once", () => {
    const g = new BudgetGuard({});
    const a = g.node({}).attempt();
    a.finish({ inputTokens: 4 });
    a.dispose();
    a.finish({ inputTokens: 40 });
    expect(g.breakdown()).toStrictEqual({ node: { tokens: 4, costUsd: 0, calls: 1 } });
    expect(g.totals).toStrictEqual({ tokens: 4, costUsd: 0 });
  });
});

describe("NodeBudget.restore", () => {
  it("adds a checkpointed visit's spend to the node's own limit only", () => {
    const g = new BudgetGuard({});
    const node = g.node({ tokens: 10, costUsd: 1 });
    node.restore({ tokens: 4, costUsd: 0.5 });
    node.restore({ tokens: 6, costUsd: 0.25 });
    expect(node.committed).toStrictEqual({ tokens: 10, costUsd: 0.75 });
    expect(g.totals).toStrictEqual({ tokens: 0, costUsd: 0 });
    expect(node.exhausted()).toStrictEqual({ scope: "node", unit: "tokens", limit: 10, spent: 10 });
  });

  it("a restored cost reaching the node limit exhausts it", () => {
    const node = new BudgetGuard({}).node({ costUsd: 1 });
    node.restore({ tokens: 0, costUsd: 0.5 });
    node.restore({ tokens: 0, costUsd: 0.5 });
    expect(node.exhausted()).toStrictEqual({ scope: "node", unit: "cost_usd", limit: 1, spent: 1 });
  });

  it("ignores non-finite and negative fields", () => {
    const node = new BudgetGuard({}).node({});
    node.restore({ tokens: 3, costUsd: 0.5 });
    node.restore({ tokens: -2, costUsd: -0.25 });
    node.restore({ tokens: Infinity, costUsd: NaN });
    node.restore({ tokens: NaN, costUsd: Infinity });
    expect(node.committed).toStrictEqual({ tokens: 3, costUsd: 0.5 });
  });
});
