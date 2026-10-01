/**
 * Spend budgets (#449): token and cost ceilings per node and per run.
 *
 * Pure and browser-safe. `budget: { tokens, cost_usd }` on a node caps one visit
 * to that node (every retry attempt included); on the workflow it caps the whole
 * run, and is the ceiling for every node. The CLI's `--max-tokens` and
 * `--max-cost` tighten the run ceiling further (the lowest wins).
 *
 * Tokens are input + output tokens as the harness reports them (cache reads and
 * writes are not counted, matching the run receipt). Cost is the harness's own
 * reported USD, never estimated. Only agent node runs are counted: judge,
 * routing and retry-reflection completions report no usage and are not metered.
 *
 * Enforcement, per unit the harness can report:
 * - live: the harness calls `onUsage` during the node; crossing a limit aborts
 *   the attempt's signal, which stops the agent (harness cancel).
 * - between nodes: usage on the finished result is checked; a crossing fails the
 *   node, and the run halts before the next node starts.
 */

import type { NodeUsage } from "./types.js";

/** The `budget` field of a node or workflow. */
export interface Budget {
  /** Max input + output tokens. */
  tokens?: number;
  /** Max reported cost in USD. */
  cost_usd?: number;
}

/** Spend limits in the units the executor works in. Absent = unlimited. */
export interface SpendLimits {
  tokens?: number;
  costUsd?: number;
}

export interface Spend {
  tokens: number;
  costUsd: number;
}

export type BudgetUnit = "tokens" | "cost_usd";

/** Recorded on the node whose spend crossed a budget (`NodeResult.budget`). */
export interface BudgetOverrun {
  /** Which ceiling was crossed: the node's own, or the run's. */
  scope: "node" | "run";
  unit: BudgetUnit;
  limit: number;
  /** Spend at the moment of the stop (live) or at the end of the node. */
  spent: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function toLimits(b: Budget | undefined): SpendLimits {
  return {
    ...(b?.tokens !== undefined ? { tokens: b.tokens } : {}),
    ...(b?.cost_usd !== undefined ? { costUsd: b.cost_usd } : {}),
  };
}

/** The tighter of two limit sets, per unit. */
export function minLimits(a: SpendLimits, b: SpendLimits): SpendLimits {
  const pick = (x?: number, y?: number) => (x === undefined ? y : y === undefined ? x : Math.min(x, y));
  const tokens = pick(a.tokens, b.tokens);
  const costUsd = pick(a.costUsd, b.costUsd);
  return { ...(tokens !== undefined ? { tokens } : {}), ...(costUsd !== undefined ? { costUsd } : {}) };
}

export function hasLimits(l: SpendLimits): boolean {
  return l.tokens !== undefined || l.costUsd !== undefined;
}

/** Tokens and cost a usage report carries. A field the harness did not report stays undefined. */
export function spendOf(u: NodeUsage | undefined): { tokens?: number; costUsd?: number } {
  if (!u) return {};
  const tokens =
    isNum(u.inputTokens) || isNum(u.outputTokens) ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0) : undefined;
  return { ...(tokens !== undefined ? { tokens } : {}), ...(isNum(u.costUsd) ? { costUsd: u.costUsd } : {}) };
}

function over(spent: number, limit: number | undefined, strictlyOver: boolean): boolean {
  if (limit === undefined) return false;
  return strictlyOver ? spent > limit : spent >= limit;
}

function breachOf(
  scope: "node" | "run",
  limits: SpendLimits,
  spent: Spend,
  strictlyOver: boolean,
): BudgetOverrun | undefined {
  if (over(spent.tokens, limits.tokens, strictlyOver)) {
    return { scope, unit: "tokens", limit: limits.tokens!, spent: spent.tokens };
  }
  if (over(spent.costUsd, limits.costUsd, strictlyOver)) {
    return { scope, unit: "cost_usd", limit: limits.costUsd!, spent: spent.costUsd };
  }
  return undefined;
}

/** One line for the log, the node's `data.error` and the receipt. */
export function describeOverrun(o: BudgetOverrun, nodeId?: string): string {
  const fmt = (n: number) =>
    o.unit === "cost_usd" ? `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}` : String(Math.round(n));
  const what = o.scope === "run" ? "run budget" : `node budget${nodeId ? ` for '${nodeId}'` : ""}`;
  return `${what} exceeded: ${o.unit} ${fmt(o.spent)} of ${fmt(o.limit)}`;
}

/**
 * Tracks spend for one run. `node()` opens a visit to a node; `attempt()` opens
 * one agent run inside it. Spend is committed when an attempt finishes.
 */
export class BudgetGuard {
  private spent: Spend = { tokens: 0, costUsd: 0 };

  constructor(readonly runLimits: SpendLimits) {}

  get totals(): Spend {
    return { ...this.spent };
  }

  /** True when any limit exists at all, so the executor can skip the machinery. */
  active(nodeLimits: SpendLimits): boolean {
    return hasLimits(this.runLimits) || hasLimits(nodeLimits);
  }

  /** The run ceiling is already reached: no further attempt may start. */
  runExhausted(): BudgetOverrun | undefined {
    return breachOf("run", this.runLimits, this.spent, false);
  }

  node(nodeLimits: SpendLimits): NodeBudget {
    return new NodeBudget(this, nodeLimits);
  }

  /** @internal */
  commit(s: Spend): void {
    this.spent = { tokens: this.spent.tokens + s.tokens, costUsd: this.spent.costUsd + s.costUsd };
  }
}

export class NodeBudget {
  private spent: Spend = { tokens: 0, costUsd: 0 };

  constructor(
    private readonly guard: BudgetGuard,
    readonly limits: SpendLimits,
  ) {}

  /** A limit is already reached before the next attempt (a retry after a spend-heavy attempt, or a spent run). */
  exhausted(): BudgetOverrun | undefined {
    return breachOf("node", this.limits, this.spent, false) ?? this.guard.runExhausted();
  }

  attempt(outer?: AbortSignal): BudgetAttempt {
    return new BudgetAttempt(this.guard, this, outer);
  }

  /** @internal */
  get committed(): Spend {
    return this.spent;
  }

  /** @internal */
  commit(s: Spend): void {
    this.spent = { tokens: this.spent.tokens + s.tokens, costUsd: this.spent.costUsd + s.costUsd };
    this.guard.commit(s);
  }
}

/** One agent run. Its `signal` is the caller's signal plus a budget stop. */
export class BudgetAttempt {
  private readonly controller = new AbortController();
  private live: Spend = { tokens: 0, costUsd: 0 };
  private liveUsage: NodeUsage | undefined;
  private stopped: BudgetOverrun | undefined;
  private readonly onOuterAbort = () => this.controller.abort();

  constructor(
    private readonly guard: BudgetGuard,
    private readonly node: NodeBudget,
    private readonly outer?: AbortSignal,
  ) {
    if (outer?.aborted) this.controller.abort();
    else outer?.addEventListener("abort", this.onOuterAbort, { once: true });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The breach that stopped this attempt live, if any. */
  get breach(): BudgetOverrun | undefined {
    return this.stopped;
  }

  /** Latest usage the harness reported during the run (cumulative for the attempt). */
  get lastUsage(): NodeUsage | undefined {
    return this.liveUsage;
  }

  /** Handed to the harness as `onUsage`. Reports are cumulative for this attempt. */
  readonly onUsage = (u: NodeUsage): void => {
    if (this.stopped) return;
    this.liveUsage = { ...this.liveUsage, ...u };
    const s = spendOf(u);
    // Reports are cumulative; never let a partial report move spend backwards.
    this.live = {
      tokens: Math.max(this.live.tokens, s.tokens ?? 0),
      costUsd: Math.max(this.live.costUsd, s.costUsd ?? 0),
    };
    const b = this.check(this.live);
    if (b) {
      this.stopped = b;
      this.controller.abort();
    }
  };

  private check(attempt: Spend): BudgetOverrun | undefined {
    const n = this.node.committed;
    const r = this.guard.totals;
    return (
      breachOf(
        "node",
        this.node.limits,
        { tokens: n.tokens + attempt.tokens, costUsd: n.costUsd + attempt.costUsd },
        true,
      ) ??
      breachOf(
        "run",
        this.guard.runLimits,
        { tokens: r.tokens + attempt.tokens, costUsd: r.costUsd + attempt.costUsd },
        true,
      )
    );
  }

  /**
   * The attempt is over. Commit its spend (the larger of what the result
   * reports and what was seen live) and return the breach, if any: the live
   * stop, else a crossing visible only in the final usage.
   */
  finish(finalUsage: NodeUsage | undefined): BudgetOverrun | undefined {
    this.outer?.removeEventListener("abort", this.onOuterAbort);
    const f = spendOf(finalUsage);
    const spent: Spend = {
      tokens: Math.max(this.live.tokens, f.tokens ?? 0),
      costUsd: Math.max(this.live.costUsd, f.costUsd ?? 0),
    };
    const b = this.stopped ?? this.check(spent);
    this.node.commit(spent);
    return b;
  }

  /** Release the outer-signal listener when the run threw before `finish`. */
  dispose(): void {
    this.outer?.removeEventListener("abort", this.onOuterAbort);
  }
}
