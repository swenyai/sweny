/**
 * Edge assertions found by mutation testing (see stryker.config.json): boundaries,
 * absent-vs-zero fields, and listener cleanup in budget.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { BudgetGuard, describeOverrun, minLimits, spendOf } from "../../budget.js";

describe("spendOf", () => {
  it("counts a lone input or output field (either one is enough)", () => {
    expect(spendOf({ inputTokens: 5 })).toStrictEqual({ tokens: 5 });
    expect(spendOf({ outputTokens: 7 })).toStrictEqual({ tokens: 7 });
  });

  it("omits tokens when neither field is a finite number", () => {
    expect(spendOf({ costUsd: 1 })).toStrictEqual({ costUsd: 1 });
    expect(spendOf({ inputTokens: Infinity, outputTokens: NaN })).toStrictEqual({});
    expect(spendOf({ inputTokens: "5" as unknown as number })).toStrictEqual({});
  });

  it("omits cost when it is not a finite number", () => {
    expect(spendOf({ inputTokens: 1, outputTokens: 2 })).toStrictEqual({ tokens: 3 });
    expect(spendOf({ inputTokens: 1, costUsd: NaN })).toStrictEqual({ tokens: 1 });
    expect(spendOf({ costUsd: 0 })).toStrictEqual({ costUsd: 0 });
  });

  it("treats a missing usage report as empty", () => {
    expect(spendOf(undefined)).toStrictEqual({});
  });
});

describe("minLimits", () => {
  it("keeps whichever side defines a unit", () => {
    expect(minLimits({ tokens: 5 }, {})).toStrictEqual({ tokens: 5 });
    expect(minLimits({}, { tokens: 5 })).toStrictEqual({ tokens: 5 });
    expect(minLimits({}, { costUsd: 2 })).toStrictEqual({ costUsd: 2 });
    expect(minLimits({ costUsd: 2 }, {})).toStrictEqual({ costUsd: 2 });
  });

  it("takes the lower value per unit, in either order", () => {
    expect(minLimits({ tokens: 3, costUsd: 9 }, { tokens: 7, costUsd: 1 })).toStrictEqual({ tokens: 3, costUsd: 1 });
    expect(minLimits({ tokens: 7 }, { tokens: 3 })).toStrictEqual({ tokens: 3 });
  });

  it("returns no keys when neither side has a limit", () => {
    expect(minLimits({}, {})).toStrictEqual({});
  });
});

describe("describeOverrun", () => {
  it("uses four decimals only below one cent", () => {
    expect(describeOverrun({ scope: "run", unit: "cost_usd", limit: 0.01, spent: 0.005 })).toBe(
      "run budget exceeded: cost_usd $0.0050 of $0.01",
    );
    expect(describeOverrun({ scope: "run", unit: "cost_usd", limit: 1.5, spent: 2.5 })).toBe(
      "run budget exceeded: cost_usd $2.50 of $1.50",
    );
  });

  it("rounds token counts to whole numbers", () => {
    expect(describeOverrun({ scope: "node", unit: "tokens", limit: 10, spent: 12.6 }, "build")).toBe(
      "node budget for 'build' exceeded: tokens 13 of 10",
    );
    expect(describeOverrun({ scope: "node", unit: "tokens", limit: 10, spent: 12 })).toBe(
      "node budget exceeded: tokens 12 of 10",
    );
  });
});

describe("BudgetGuard accounting", () => {
  it("sums token and cost spend across attempts and nodes", () => {
    const guard = new BudgetGuard({});
    const a = guard.node({});
    a.attempt().finish({ inputTokens: 1, outputTokens: 2, costUsd: 0.25 });
    a.attempt().finish({ inputTokens: 4, costUsd: 0.5 });
    expect(a.committed).toStrictEqual({ tokens: 7, costUsd: 0.75 });
    guard.node({}).attempt().finish({ costUsd: 0.25 });
    expect(guard.totals).toStrictEqual({ tokens: 7, costUsd: 1 });
  });

  it("reports an exhausted node limit at exactly the limit (>=), tagged as node scope", () => {
    const guard = new BudgetGuard({});
    const node = guard.node({ tokens: 100 });
    expect(node.exhausted()).toBeUndefined();
    // Finishing exactly at the limit is not a breach (strict > on the final check)...
    expect(node.attempt().finish({ inputTokens: 60, outputTokens: 40 })).toBeUndefined();
    // ...but no further attempt may start.
    expect(node.exhausted()).toStrictEqual({ scope: "node", unit: "tokens", limit: 100, spent: 100 });
  });

  it("falls back to the run ceiling when the node is not exhausted", () => {
    const guard = new BudgetGuard({ costUsd: 1 });
    const first = guard.node({ tokens: 1000 });
    first.attempt().finish({ costUsd: 1 });
    expect(guard.runExhausted()).toStrictEqual({ scope: "run", unit: "cost_usd", limit: 1, spent: 1 });
    const second = guard.node({});
    expect(second.exhausted()).toStrictEqual({ scope: "run", unit: "cost_usd", limit: 1, spent: 1 });
  });

  it("does not report a run as exhausted without limits", () => {
    const guard = new BudgetGuard({});
    guard.node({}).attempt().finish({ inputTokens: 1e9 });
    expect(guard.runExhausted()).toBeUndefined();
    expect(guard.node({}).exhausted()).toBeUndefined();
  });
});

describe("BudgetAttempt live enforcement", () => {
  it("aborts only when a node limit is strictly exceeded", () => {
    const node = new BudgetGuard({}).node({ tokens: 100 });
    const attempt = node.attempt();
    attempt.onUsage({ inputTokens: 100 });
    expect(attempt.signal.aborted).toBe(false);
    expect(attempt.breach).toBeUndefined();
    attempt.onUsage({ inputTokens: 101 });
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.breach).toStrictEqual({ scope: "node", unit: "tokens", limit: 100, spent: 101 });
  });

  it("aborts only when the run limit is strictly exceeded, counting earlier spend", () => {
    const guard = new BudgetGuard({ tokens: 100 });
    guard.node({}).attempt().finish({ inputTokens: 40 });
    const attempt = guard.node({}).attempt();
    attempt.onUsage({ inputTokens: 60 });
    expect(attempt.signal.aborted).toBe(false);
    attempt.onUsage({ inputTokens: 61 });
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.breach).toStrictEqual({ scope: "run", unit: "tokens", limit: 100, spent: 101 });
  });

  it("ignores reports after a stop and keeps the first breach and usage", () => {
    const attempt = new BudgetGuard({}).node({ tokens: 10 }).attempt();
    attempt.onUsage({ inputTokens: 11 });
    const breach = attempt.breach;
    attempt.onUsage({ inputTokens: 500, costUsd: 9 });
    expect(attempt.breach).toBe(breach);
    expect(attempt.lastUsage).toStrictEqual({ inputTokens: 11 });
  });

  it("never lets a partial report move spend backwards", () => {
    const guard = new BudgetGuard({});
    const attempt = guard.node({}).attempt();
    attempt.onUsage({ inputTokens: 50 });
    attempt.onUsage({ costUsd: 0.5 });
    attempt.finish(undefined);
    expect(guard.totals).toStrictEqual({ tokens: 50, costUsd: 0.5 });
  });

  it("commits the larger of live and final usage", () => {
    const guard = new BudgetGuard({});
    const attempt = guard.node({}).attempt();
    attempt.onUsage({ inputTokens: 80 });
    attempt.finish({ inputTokens: 30, costUsd: 2 });
    expect(guard.totals).toStrictEqual({ tokens: 80, costUsd: 2 });
  });

  it("flags a crossing visible only in the final usage", () => {
    const node = new BudgetGuard({}).node({ costUsd: 1 });
    expect(node.attempt().finish({ costUsd: 1 })).toBeUndefined();
    expect(new BudgetGuard({}).node({ costUsd: 1 }).attempt().finish({ costUsd: 1.5 })).toStrictEqual({
      scope: "node",
      unit: "cost_usd",
      limit: 1,
      spent: 1.5,
    });
  });
});

describe("BudgetAttempt outer signal wiring", () => {
  it("starts aborted when the outer signal already is", () => {
    const outer = new AbortController();
    outer.abort();
    expect(new BudgetGuard({}).node({}).attempt(outer.signal).signal.aborted).toBe(true);
  });

  it("follows a later outer abort once, and only until finish", () => {
    const outer = new AbortController();
    const add = vi.spyOn(outer.signal, "addEventListener");
    const remove = vi.spyOn(outer.signal, "removeEventListener");
    const attempt = new BudgetGuard({}).node({}).attempt(outer.signal);
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(attempt.signal.aborted).toBe(false);
    attempt.finish(undefined);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    outer.abort();
    expect(attempt.signal.aborted).toBe(false);
  });

  it("propagates the outer abort while the attempt is running", () => {
    const outer = new AbortController();
    const attempt = new BudgetGuard({}).node({}).attempt(outer.signal);
    outer.abort();
    expect(attempt.signal.aborted).toBe(true);
  });

  it("dispose removes the listener", () => {
    const outer = new AbortController();
    const add = vi.spyOn(outer.signal, "addEventListener");
    const remove = vi.spyOn(outer.signal, "removeEventListener");
    const attempt = new BudgetGuard({}).node({}).attempt(outer.signal);
    attempt.dispose();
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    outer.abort();
    expect(attempt.signal.aborted).toBe(false);
  });
});
