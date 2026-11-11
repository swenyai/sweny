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
 * reported USD, never estimated. Every model completion the executor itself
 * makes is counted too, under its own `kind` (see {@link SpendKind}): judge
 * scoring, route evaluation, retry reflection and the safe-output screen. A
 * completion counts when its harness reports usage for it; one that reports
 * none adds nothing (the same as a node run without usage). The run totals
 * and the stop are over all kinds together, across a resume too; the split is
 * `trace.spend`. Once a ceiling is reached no further executor completion
 * starts. The decision model (`route_by: decider`) is not metered.
 *
 * Enforcement, per unit the harness can report:
 * - live: the harness calls `onUsage` during the node; crossing a limit aborts
 *   the attempt's signal, which stops the agent (harness cancel).
 * - between nodes: usage on the finished result is checked; a crossing fails the
 *   node, and the run halts before the next node starts.
 * - across a resume: the run journal records each attempt's spend (live and
 *   final), and each metered completion (judge, route, reflection, screen)
 *   as its own record; `sweny workflow resume` seeds the run total with all
 *   of it, split by kind.
 *
 * Map children (#575): every child run has its own guard (its item cap,
 * `item_budget`) over one {@link SpendTally} shared by the map. A settled
 * spend is committed once to the child's own counters and once to the tally;
 * the run cap is checked against the tally's committed spend plus every
 * running attempt's live spend; a crossing aborts the tally's signal, which
 * every running child sees. What this promises, and no more: no child
 * attempt starts once settled spend has reached the cap. Live reports are
 * lower bounds and some units arrive only at the end, so concurrent children
 * can overrun the cap; `strict` harness policy runs a budgeted map serially.
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

/** Spend restored on a resume: the total, and its split by kind when the journal has one. */
export interface SeedSpend extends Spend {
  byKind?: Partial<Record<SpendKind, Spend>>;
}

/** What a unit of spend paid for. `node` is an agent node run; the rest are the executor's own completions. */
export type SpendKind = "node" | "judge" | "route" | "reflect" | "screen";

/** The order kinds are listed in, wherever the split is shown. */
export const SPEND_KINDS: readonly SpendKind[] = ["node", "judge", "route", "reflect", "screen"];

/** Spend of one {@link SpendKind}. `calls` counts the completions that reported usage. */
export interface KindSpend extends Spend {
  calls: number;
}

/** Spend by kind. A kind with no reported usage is absent. */
export type SpendBreakdown = Partial<Record<SpendKind, KindSpend>>;

export type BudgetUnit = "tokens" | "cost_usd";

/** Recorded on the node whose spend crossed a budget (`NodeResult.budget`). */
export interface BudgetOverrun {
  /** Which ceiling was crossed: the node's own, or the run's. */
  scope: "node" | "run";
  unit: BudgetUnit;
  limit: number;
  /** Spend at the moment of the stop (live) or at the end of the node. */
  spent: number;
  /** The executor completion whose spend crossed it (judge, route, ...). Absent for a node run. */
  kind?: SpendKind;
}

/**
 * Thrown into an executor completion (judge, route, reflection, screen) the
 * budget refuses: a ceiling was already reached, so the call is not made.
 * Callers that swallow a failed completion (a judge's parse retry) must let
 * this one through, so a refusal is never mistaken for a model answer.
 */
export class BudgetRefusal extends Error {
  constructor(readonly breach: BudgetOverrun) {
    super(describeOverrun(breach));
    this.name = "BudgetRefusal";
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Slack for comparing accumulated floats: 0.1 + 0.2 is 0.30000000000000004,
 * which must not read as over a $0.30 limit. Far below a token or a cent.
 */
const EPSILON = 1e-9;

/** Cost as shown: accumulated float noise rounded off (10 decimal places). */
const roundCost = (n: number): number => Math.round(n * 1e10) / 1e10;

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
  // Count only finite fields: a NaN beside a real count must not turn the sum into NaN,
  // which no limit compares as crossed (the run would pass its budget without stopping).
  const inTokens = isNum(u.inputTokens) ? u.inputTokens : undefined;
  const outTokens = isNum(u.outputTokens) ? u.outputTokens : undefined;
  const tokens = inTokens !== undefined || outTokens !== undefined ? (inTokens ?? 0) + (outTokens ?? 0) : undefined;
  return { ...(tokens !== undefined ? { tokens } : {}), ...(isNum(u.costUsd) ? { costUsd: u.costUsd } : {}) };
}

function over(spent: number, limit: number | undefined, strictlyOver: boolean): boolean {
  if (limit === undefined) return false;
  return strictlyOver ? spent > limit + EPSILON : spent >= limit - EPSILON;
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
    return { scope, unit: "cost_usd", limit: limits.costUsd!, spent: roundCost(spent.costUsd) };
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

const ZERO: Spend = { tokens: 0, costUsd: 0 };
const plus = (a: Spend, b: Spend): Spend => ({ tokens: a.tokens + b.tokens, costUsd: a.costUsd + b.costUsd });

/** One running attempt's live spend, registered with a {@link SpendTally}. */
export interface LiveSpend {
  /** The attempt's cumulative live spend so far. */
  set(s: Spend): void;
  /** The attempt settled (or ended): its spend is committed, or was never reported. */
  close(): void;
}

/**
 * The spend a map's children share (#575): one run cap over the parent's
 * spend before the map, every earlier generation's journaled spend, every
 * settled child attempt, and every running attempt's live spend. A crossing
 * trips it once: {@link signal} aborts and {@link breach} names the crossing.
 */
export class SpendTally {
  private spent: Spend;
  private readonly kids = new Map<SpendKind, Spend>();
  private readonly live = new Set<{ s: Spend }>();
  private readonly controller = new AbortController();
  private stop: BudgetOverrun | undefined;

  /** `base`: what the run spent before the map (the parent's totals). */
  constructor(
    readonly limits: SpendLimits,
    base: Spend = ZERO,
  ) {
    this.spent = { ...base };
  }

  /** Aborts when the tally trips: every running child sees it. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The crossing that tripped the tally, if any. */
  get breach(): BudgetOverrun | undefined {
    return this.stop;
  }

  /** Settled spend: the base, earlier generations and settled child attempts. */
  get committed(): Spend {
    return { ...this.spent };
  }

  /** What the children spent (earlier generations included), by kind: what the parent folds in after the map. */
  get children(): Partial<Record<SpendKind, Spend>> {
    return Object.fromEntries([...this.kids].map(([k, v]) => [k, { ...v }]));
  }

  /** The children's total (earlier generations included). */
  get childTotal(): Spend {
    return [...this.kids.values()].reduce(plus, ZERO);
  }

  /** Spend earlier generations journaled (resume): counted against the cap, never a call. */
  seed(s: Spend): void {
    const ok = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
    this.commit({ tokens: ok(s.tokens), costUsd: ok(s.costUsd) }, "node");
  }

  /** The cap is already reached: no child attempt may start. */
  exhausted(): BudgetOverrun | undefined {
    return breachOf("run", this.limits, this.spent, false);
  }

  /** Register one running attempt's live spend. */
  open(): LiveSpend {
    const entry = { s: { ...ZERO } };
    this.live.add(entry);
    const handle: LiveSpend = {
      set: (s) => {
        entry.s = { ...s };
      },
      close: () => {
        this.live.delete(entry);
      },
    };
    this.entries.set(handle, entry);
    return handle;
  }

  /**
   * Settled plus live spend, plus `extra` in place of `self`'s live spend,
   * strictly over a limit: the tally trips and the crossing is returned.
   */
  check(extra: Spend = ZERO, self?: LiveSpend): BudgetOverrun | undefined {
    const skip = self ? this.entries.get(self) : undefined;
    let total = plus(this.spent, extra);
    for (const e of this.live) if (e !== skip) total = plus(total, e.s);
    const b = breachOf("run", this.limits, total, true);
    if (b) this.trip(b);
    return b;
  }

  private readonly entries = new WeakMap<LiveSpend, { s: Spend }>();

  /** @internal A settled spend of a child (once per attempt or completion). */
  commit(s: Spend, kind: SpendKind): void {
    this.spent = plus(this.spent, s);
    this.kids.set(kind, plus(this.kids.get(kind) ?? ZERO, s));
  }

  private trip(b: BudgetOverrun): void {
    if (this.stop) return;
    this.stop = b;
    this.controller.abort(new BudgetRefusal(b));
  }
}

/**
 * Tracks spend for one run. `node()` opens a visit to a node; `attempt()` opens
 * one agent run inside it. Spend is committed once, when an attempt settles.
 * A map child's guard also commits to the map's shared {@link SpendTally}.
 */
export class BudgetGuard {
  private spent: Spend = { tokens: 0, costUsd: 0 };
  private kinds = new Map<SpendKind, KindSpend>();

  constructor(
    readonly runLimits: SpendLimits,
    readonly tally?: SpendTally,
  ) {}

  /** The tightest run cap: this run's own, and a map child's shared cap. */
  get ceiling(): SpendLimits {
    return this.tally ? minLimits(this.runLimits, this.tally.limits) : this.runLimits;
  }

  /** A tally for a map visit of this run: its cap, starting from what the run spent so far. */
  shareWithChildren(): SpendTally {
    return new SpendTally(this.ceiling, this.totals);
  }

  /** Fold a map's children's spend into this run, by kind (seeded spend: not calls). */
  absorb(byKind: Partial<Record<SpendKind, Spend>>): void {
    for (const k of SPEND_KINDS) {
      const v = byKind[k];
      if (v) this.commitLocal(v, k, false);
    }
  }

  get totals(): Spend {
    return { ...this.spent };
  }

  /**
   * Spend by kind, in {@link SPEND_KINDS} order. Resumed spend is restored
   * under its kind; a journal without meter records seeds `node` only.
   */
  breakdown(): SpendBreakdown {
    const out: SpendBreakdown = {};
    for (const k of SPEND_KINDS) {
      const v = this.kinds.get(k);
      if (v) out[k] = { tokens: v.tokens, costUsd: roundCost(v.costUsd), calls: v.calls };
    }
    return out;
  }

  /** True once any completion other than a node run reported usage. */
  get hasMeteredCalls(): boolean {
    return [...this.kinds.keys()].some((k) => k !== "node");
  }

  /**
   * Count one executor completion (judge, route, ...) against the run. Usage
   * with no tokens and no cost counts nothing. Returns the breach this report
   * caused, judged against the totals before it, like a live node report.
   */
  meter(kind: SpendKind, usage: NodeUsage | undefined, nodeBudget?: NodeBudget): BudgetOverrun | undefined {
    const u = spendOf(usage);
    if (u.tokens === undefined && u.costUsd === undefined) return undefined;
    const s: Spend = { tokens: u.tokens ?? 0, costUsd: u.costUsd ?? 0 };
    const r = this.spent;
    const breach =
      (nodeBudget
        ? breachOf(
            "node",
            nodeBudget.limits,
            { tokens: nodeBudget.committed.tokens + s.tokens, costUsd: nodeBudget.committed.costUsd + s.costUsd },
            true,
          )
        : undefined) ??
      breachOf("run", this.runLimits, { tokens: r.tokens + s.tokens, costUsd: r.costUsd + s.costUsd }, true) ??
      this.tally?.check(s);
    if (breach && kind !== "node") breach.kind = kind;
    if (nodeBudget) nodeBudget.commit(s, kind, true);
    else this.commit(s, kind, true);
    return breach;
  }

  /** True when any limit exists at all, so the executor can skip the machinery. */
  active(nodeLimits: SpendLimits): boolean {
    return hasLimits(this.ceiling) || hasLimits(nodeLimits);
  }

  /** The run ceiling (or a map's shared one) is already reached: no further attempt may start. */
  runExhausted(): BudgetOverrun | undefined {
    return breachOf("run", this.runLimits, this.spent, false) ?? this.tally?.exhausted();
  }

  node(nodeLimits: SpendLimits): NodeBudget {
    return new NodeBudget(this, nodeLimits);
  }

  /**
   * Spend the run made before this process (a resumed run's journaled usage
   * and metered completions). Counted against the run ceiling like any other
   * spend, so a crash never resets the whole-run budget. Restored under its
   * kind when the journal has the split (a journal written before meter
   * records existed has node spend only). Seeded spend is not a call: `calls`
   * is unchanged.
   */
  seed(s: SeedSpend): void {
    const ok = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
    // Seeded spend is this run's own: a map child's never reaches the tally (the parent seeds that).
    if (!s.byKind) {
      this.commitLocal({ tokens: ok(s.tokens), costUsd: ok(s.costUsd) }, "node", false);
      return;
    }
    for (const k of SPEND_KINDS) {
      const v = s.byKind[k];
      if (v) this.commitLocal({ tokens: ok(v.tokens), costUsd: ok(v.costUsd) }, k, false);
    }
  }

  /**
   * @internal `counted`: this commit is one completion that reported usage, so
   * `calls` goes up. A commit that is not (seeded spend, an attempt that
   * reported nothing) adds its spend only, and a zero one leaves no trace, so
   * the split is the same with and without a limit.
   */
  commit(s: Spend, kind: SpendKind, counted: boolean): void {
    this.commitLocal(s, kind, counted);
    this.tally?.commit(s, kind);
  }

  private commitLocal(s: Spend, kind: SpendKind, counted: boolean): void {
    this.spent = { tokens: this.spent.tokens + s.tokens, costUsd: this.spent.costUsd + s.costUsd };
    const k = this.kinds.get(kind);
    if (!k && !counted && s.tokens === 0 && s.costUsd === 0) return;
    const prev = k ?? { tokens: 0, costUsd: 0, calls: 0 };
    this.kinds.set(kind, {
      tokens: prev.tokens + s.tokens,
      costUsd: prev.costUsd + s.costUsd,
      calls: prev.calls + (counted ? 1 : 0),
    });
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

  /**
   * Spend this visit made before a resume (a checkpointed visit's journaled
   * spend). It counts against the node's own limit only: the run total
   * already holds it from the seed.
   */
  restore(s: Spend): void {
    const ok = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
    this.spent = { tokens: this.spent.tokens + ok(s.tokens), costUsd: this.spent.costUsd + ok(s.costUsd) };
  }

  /** @internal */
  get committed(): Spend {
    return this.spent;
  }

  /** Count one executor completion made during this visit (judge, retry reflection, screen). */
  meter(kind: SpendKind, usage: NodeUsage | undefined): BudgetOverrun | undefined {
    return this.guard.meter(kind, usage, this);
  }

  /** @internal See {@link BudgetGuard.commit}. */
  commit(s: Spend, kind: SpendKind, counted: boolean): void {
    this.spent = { tokens: this.spent.tokens + s.tokens, costUsd: this.spent.costUsd + s.costUsd };
    this.guard.commit(s, kind, counted);
  }
}

/** One agent run. Its `signal` is the caller's signal plus a budget stop. */
export class BudgetAttempt {
  private readonly controller = new AbortController();
  private live: Spend = { tokens: 0, costUsd: 0 };
  private liveUsage: NodeUsage | undefined;
  /** A live report carried tokens or cost. */
  private liveReported = false;
  private stopped: BudgetOverrun | undefined;
  private settled: { breach: BudgetOverrun | undefined } | undefined;
  private readonly onOuterAbort = () => this.controller.abort();
  /** A map child's attempt (#575): its live spend counts toward the shared tally until it settles. */
  private readonly shared: LiveSpend | undefined;

  constructor(
    private readonly guard: BudgetGuard,
    private readonly node: NodeBudget,
    private readonly outer?: AbortSignal,
  ) {
    if (outer?.aborted) this.controller.abort();
    else outer?.addEventListener("abort", this.onOuterAbort, { once: true });
    this.shared = guard.tally?.open();
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
    if (s.tokens !== undefined || s.costUsd !== undefined) this.liveReported = true;
    // Reports are cumulative; never let a partial report move spend backwards.
    this.live = {
      tokens: Math.max(this.live.tokens, s.tokens ?? 0),
      costUsd: Math.max(this.live.costUsd, s.costUsd ?? 0),
    };
    this.shared?.set(this.live);
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
      ) ??
      this.guard.tally?.check(attempt, this.shared)
    );
  }

  /**
   * The attempt is over: commit its spend exactly once (#549). The spend is the
   * larger of `finalUsage` and what was seen live, per unit. The breach (the
   * live stop, else a crossing visible only in the final usage) is judged
   * against the totals before this commit. Later calls change nothing and
   * return the first call's breach, so the executor settles as soon as the
   * harness returns, before any fallible work, and every exit path may settle
   * again without double counting.
   */
  settle(finalUsage?: NodeUsage): BudgetOverrun | undefined {
    if (this.settled) return this.settled.breach;
    this.outer?.removeEventListener("abort", this.onOuterAbort);
    const f = spendOf(finalUsage);
    const spent: Spend = {
      tokens: Math.max(this.live.tokens, f.tokens ?? 0),
      costUsd: Math.max(this.live.costUsd, f.costUsd ?? 0),
    };
    const breach = this.stopped ?? this.check(spent);
    this.settled = { breach };
    this.shared?.close();
    // A call only when the attempt reported usage, live or final: an attempt
    // that reported none is not counted, the same as without a limit.
    this.node.commit(spent, "node", this.liveReported || f.tokens !== undefined || f.costUsd !== undefined);
    return breach;
  }

  /** Settle with the attempt's final usage and return the breach, if any. */
  finish(finalUsage: NodeUsage | undefined): BudgetOverrun | undefined {
    return this.settle(finalUsage);
  }

  /**
   * Every exit path ends here: an attempt that threw still commits what it
   * reported live. A no-op once settled.
   */
  dispose(): void {
    this.settle();
  }
}
