// Property-based and adversarial tests for spend budgets (budget.ts): for any
// stream of usage reports the run stops at the first crossing, the spend
// recorded at the stop is at or past the budget, and a run never goes past a
// budget without stopping.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  BudgetGuard,
  hasLimits,
  minLimits,
  spendOf,
  type BudgetOverrun,
  type Spend,
  type SpendLimits,
} from "../../budget.js";
import type { NodeUsage } from "../../types.js";
import { params } from "./config.js";

// ─── Generators ──────────────────────────────────────────────────

const limitsArb: fc.Arbitrary<SpendLimits> = fc.record({
  tokens: fc.option(fc.integer({ min: 0, max: 120 }), { nil: undefined }),
  costUsd: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
});

/** A number a harness might report: mostly ordinary, sometimes missing, negative, NaN or infinite. */
const reported = (min: number, max: number): fc.Arbitrary<number | undefined> =>
  fc.oneof(
    { weight: 8, arbitrary: fc.integer({ min, max }) },
    { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) },
    { weight: 1, arbitrary: fc.constant(undefined) },
  );

const usageArb: fc.Arbitrary<NodeUsage> = fc.record({
  inputTokens: reported(-5, 40),
  outputTokens: reported(-5, 40),
  costUsd: reported(-2, 20),
});

// ─── Reference model ─────────────────────────────────────────────

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** What one report adds, counting only finite fields. */
function modelSpend(u: NodeUsage | undefined): Spend {
  return {
    tokens: (fin(u?.inputTokens) ? u!.inputTokens! : 0) + (fin(u?.outputTokens) ? u!.outputTokens! : 0),
    costUsd: fin(u?.costUsd) ? u!.costUsd! : 0,
  };
}

const maxSpend = (a: Spend, b: Spend): Spend => ({
  tokens: Math.max(a.tokens, b.tokens),
  costUsd: Math.max(a.costUsd, b.costUsd),
});

/** First ceiling a spend is over: node tokens, node cost, run tokens, run cost. */
function modelBreach(
  node: SpendLimits,
  run: SpendLimits,
  n: Spend,
  r: Spend,
  strict: boolean,
): BudgetOverrun | undefined {
  const over = (s: number, l: number | undefined): boolean => l !== undefined && (strict ? s > l : s >= l);
  if (over(n.tokens, node.tokens)) return { scope: "node", unit: "tokens", limit: node.tokens!, spent: n.tokens };
  if (over(n.costUsd, node.costUsd)) return { scope: "node", unit: "cost_usd", limit: node.costUsd!, spent: n.costUsd };
  if (over(r.tokens, run.tokens)) return { scope: "run", unit: "tokens", limit: run.tokens!, spent: r.tokens };
  if (over(r.costUsd, run.costUsd)) return { scope: "run", unit: "cost_usd", limit: run.costUsd!, spent: r.costUsd };
  return undefined;
}

const valueOf = (s: Spend, unit: BudgetOverrun["unit"]): number => (unit === "tokens" ? s.tokens : s.costUsd);

// ─── Properties ──────────────────────────────────────────────────

describe("budget: one attempt over an arbitrary usage stream", () => {
  it("stops at the first strict crossing, ignores everything after, and commits at least the budget", () => {
    fc.assert(
      fc.property(
        limitsArb,
        limitsArb,
        fc.array(usageArb, { maxLength: 8 }),
        fc.option(usageArb, { nil: undefined }),
        (nodeLimits, runLimits, events, finalUsage) => {
          const guard = new BudgetGuard(runLimits);
          const nb = guard.node(nodeLimits);
          const attempt = nb.attempt();

          // Reference: live spend is the running maximum of what was reported (reports are cumulative).
          let live: Spend = { tokens: 0, costUsd: 0 };
          let last: NodeUsage | undefined;
          let stopped: BudgetOverrun | undefined;
          for (const u of events) {
            attempt.onUsage(u);
            if (stopped) continue;
            last = { ...last, ...u };
            live = maxSpend(live, modelSpend(u));
            stopped = modelBreach(nodeLimits, runLimits, live, live, true);
          }

          // Never stops early, never runs past: the attempt stopped exactly when the model says.
          expect(attempt.breach).toEqual(stopped);
          expect(attempt.signal.aborted).toBe(stopped !== undefined);
          expect(attempt.lastUsage).toEqual(last);
          if (stopped) {
            expect(stopped.spent).toBeGreaterThan(stopped.limit);
          }

          // Finishing commits the larger of what was seen live and what the result reports.
          const spent = maxSpend(live, modelSpend(finalUsage));
          const breach = attempt.finish(finalUsage);
          expect(breach).toEqual(stopped ?? modelBreach(nodeLimits, runLimits, spent, spent, true));
          expect(guard.totals).toEqual(spent);
          expect(nb.committed).toEqual(spent);

          // Recorded spend at the stop is at or past the budget that stopped it.
          if (breach) {
            const recorded = breach.scope === "node" ? nb.committed : guard.totals;
            expect(valueOf(recorded, breach.unit)).toBeGreaterThanOrEqual(breach.limit);
          } else {
            // No stop means no ceiling was passed.
            for (const l of [nodeLimits, runLimits]) {
              if (l.tokens !== undefined) expect(spent.tokens).toBeLessThanOrEqual(l.tokens);
              if (l.costUsd !== undefined) expect(spent.costUsd).toBeLessThanOrEqual(l.costUsd);
            }
          }

          // The next attempt may not start once a ceiling is reached (non-strict).
          expect(guard.runExhausted()).toEqual(modelBreach({}, runLimits, spent, spent, false));
          expect(nb.exhausted()).toEqual(modelBreach(nodeLimits, runLimits, spent, spent, false));
        },
      ),
      params(500),
    );
  });

  it("a NaN or infinite field in a report never poisons accounting: the other fields still stop the run", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        fc.integer({ min: 1, max: 50 }),
        (bad, limit) => {
          const guard = new BudgetGuard({ tokens: limit });
          const attempt = guard.node({}).attempt();
          attempt.onUsage({ inputTokens: bad, outputTokens: 1 });
          attempt.onUsage({ inputTokens: bad, outputTokens: limit + 1 });
          expect(attempt.breach).toMatchObject({ scope: "run", unit: "tokens", limit });
          expect(attempt.signal.aborted).toBe(true);
        },
      ),
      params(30),
    );
  });
});

describe("budget: a run of nodes and attempts", () => {
  const attemptArb = fc.record({
    events: fc.array(usageArb, { maxLength: 4 }),
    final: fc.option(usageArb, { nil: undefined }),
  });
  const nodeArb = fc.record({ limits: limitsArb, attempts: fc.array(attemptArb, { minLength: 1, maxLength: 3 }) });

  it("the run stops only once a ceiling is reached, and never finishes past one without stopping", () => {
    fc.assert(
      fc.property(limitsArb, fc.array(nodeArb, { minLength: 1, maxLength: 4 }), (runLimits, nodes) => {
        const guard = new BudgetGuard(runLimits);
        let stoppedAt: { node: number; committed: Spend } | undefined;

        outer: for (let n = 0; n < nodes.length; n++) {
          const node = nodes[n];
          const nb = guard.node(node.limits);
          // The executor refuses to start a node on a spent run, and an attempt on a spent node.
          if (guard.runExhausted()) {
            stoppedAt = { node: n, committed: nb.committed };
            break;
          }
          for (const a of node.attempts) {
            if (nb.exhausted()) {
              stoppedAt = { node: n, committed: nb.committed };
              break outer;
            }
            const attempt = nb.attempt();
            for (const u of a.events) {
              attempt.onUsage(u);
              if (attempt.signal.aborted) break;
            }
            const breach = attempt.finish(a.final);
            if (breach) {
              stoppedAt = { node: n, committed: nb.committed };
              break outer;
            }
            // The attempt may have stopped live: it must have said so.
            expect(attempt.signal.aborted).toBe(attempt.breach !== undefined);
          }
        }

        const totals = guard.totals;
        const reached = (spent: Spend, l: SpendLimits): boolean =>
          (l.tokens !== undefined && spent.tokens >= l.tokens) ||
          (l.costUsd !== undefined && spent.costUsd >= l.costUsd);
        const past = (spent: Spend, l: SpendLimits): boolean =>
          (l.tokens !== undefined && spent.tokens > l.tokens) || (l.costUsd !== undefined && spent.costUsd > l.costUsd);

        if (stoppedAt) {
          // Never stops early: something was actually reached (the run's, or the stopping node's own).
          expect(reached(totals, runLimits) || reached(stoppedAt.committed, nodes[stoppedAt.node].limits)).toBe(true);
        } else {
          // Never runs past without stopping: nothing exceeded any ceiling.
          expect(past(totals, runLimits)).toBe(false);
        }
      }),
      params(400),
    );
  });
});

describe("budget: helpers", () => {
  it("minLimits is the per-unit minimum: commutative, associative, idempotent, never looser than either side", () => {
    fc.assert(
      fc.property(limitsArb, limitsArb, limitsArb, (a, b, c) => {
        const ab = minLimits(a, b);
        expect(ab).toEqual(minLimits(b, a));
        expect(minLimits(ab, c)).toEqual(minLimits(a, minLimits(b, c)));
        expect(minLimits(a, a)).toEqual(a);
        for (const unit of ["tokens", "costUsd"] as const) {
          for (const side of [a, b]) {
            if (side[unit] !== undefined) {
              expect(ab[unit]).toBeDefined();
              expect(ab[unit]!).toBeLessThanOrEqual(side[unit]!);
            }
          }
        }
        expect(hasLimits(ab)).toBe(hasLimits(a) || hasLimits(b));
      }),
      params(200),
    );
  });

  it("spendOf reports only finite numbers and never counts cache tokens", () => {
    fc.assert(
      fc.property(usageArb, fc.integer({ min: 0, max: 1000 }), (u, cache) => {
        const s = spendOf({ ...u, cacheReadTokens: cache, cacheCreationTokens: cache });
        if (s.tokens !== undefined) expect(Number.isNaN(s.tokens)).toBe(false);
        if (s.costUsd !== undefined) expect(Number.isFinite(s.costUsd)).toBe(true);
        expect(s.tokens).toEqual(spendOf(u).tokens);
        // Defined exactly when a token field was a finite number.
        expect(s.tokens !== undefined).toBe(fin(u.inputTokens) || fin(u.outputTokens));
        if (s.tokens !== undefined) expect(s.tokens).toBe(modelSpend(u).tokens);
      }),
      params(200),
    );
  });
});
