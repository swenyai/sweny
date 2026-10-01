/**
 * #449: per-node and per-run token and cost budgets.
 *
 * Fake agents report usage the way a real harness does: live, through
 * `onUsage`, or only on the finished result. No test calls a model.
 */
import { describe, it, expect } from "vitest";
import { execute } from "../executor.js";
import type { ExecuteOptions } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import { BudgetGuard, describeOverrun, minLimits, toLimits } from "../budget.js";
import { budgetGate } from "../harness/policy.js";
import { CLAUDE_CODE_CAPABILITIES, CODEX_CAPABILITIES, ACP_CAPABILITIES } from "../harness/capabilities.js";
import { loadAndValidateWorkflow } from "../loader.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import { summarizeRun, formatReceipt, WORKFLOW_RUN_OPTIONS } from "../cli/run-output.js";
import { parseSpendFlags } from "../cli/workflow-input.js";
import type { AgentHarness, HarnessCapabilities, HarnessRunRequest, HarnessRunResult } from "../harness/types.js";
import type { Claude, NodeResult, NodeUsage, Workflow } from "../types.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** What one fake node run does. */
interface Script {
  /** Cumulative usage reports sent through `onUsage` while running. */
  live?: NodeUsage[];
  /** After the live reports, wait until the run is aborted (a long-running agent). */
  hang?: boolean;
  /** Usage on the finished result. */
  final?: NodeUsage;
  data?: Record<string, unknown>;
}

function scripted(byNode: Record<string, Script[]>) {
  const calls: { node: string; req: HarnessRunRequest }[] = [];
  const counters: Record<string, number> = {};
  const run = async (req: HarnessRunRequest): Promise<NodeResult> => {
    const node = Object.keys(byNode).find((n) => req.instruction.includes(`Do ${n}`));
    if (!node) throw new Error(`no script for: ${req.instruction}`);
    calls.push({ node, req });
    const i = (counters[node] = (counters[node] ?? -1) + 1);
    const scripts = byNode[node];
    const s = scripts[Math.min(i, scripts.length - 1)];
    for (const u of s.live ?? []) req.onUsage?.(u);
    if (s.hang && !req.signal?.aborted) {
      await new Promise<void>((resolve) => req.signal?.addEventListener("abort", () => resolve(), { once: true }));
    }
    if (s.hang) {
      // A cancelled agent reports no usage of its own.
      return { status: "failed", data: { error: "aborted" }, toolCalls: [] };
    }
    return {
      status: "success",
      data: s.data ?? { done: true },
      toolCalls: [],
      ...(s.final ? { usage: s.final } : {}),
    };
  };
  return { calls, run };
}

/** A harness with declared capabilities, over a scripted run. */
function harnessOf(caps: HarnessCapabilities, run: (req: HarnessRunRequest) => Promise<NodeResult>): AgentHarness {
  return {
    id: "mock",
    capabilities: caps,
    async preflight() {
      return { ok: true, version: "test" };
    },
    async run(req): Promise<HarnessRunResult> {
      return { ...(await run(req)), harness: { id: "mock", version: "test" }, degraded: [] };
    },
    async complete() {
      return null;
    },
  };
}

const wf = (over: Partial<Workflow> = {}, nodeOver: Record<string, object> = {}): Workflow => ({
  id: "budgeted",
  name: "Budgeted",
  description: "",
  entry: "a",
  nodes: {
    a: { name: "A", instruction: "Do a", skills: [], ...(nodeOver.a ?? {}) },
    b: { name: "B", instruction: "Do b", skills: [], ...(nodeOver.b ?? {}) },
  },
  edges: [{ from: "a", to: "b" }],
  ...over,
});

const exec = (workflow: Workflow, harness: AgentHarness, extra: Partial<ExecuteOptions> = {}) =>
  execute(
    workflow,
    {},
    { skills: createSkillMap([]), harness, config: {}, logger: silent, harnessPolicy: "warn", env: {}, ...extra },
  );

describe("spend budgets (#449)", () => {
  it("a mid-node overrun cancels the agent, fails the node and skips the rest", async () => {
    const { calls, run } = scripted({
      a: [
        {
          live: [
            { inputTokens: 40, outputTokens: 10 },
            { inputTokens: 90, outputTokens: 20 },
          ],
          hang: true,
        },
      ],
      b: [{}],
    });
    const { results } = await exec(
      wf({}, { a: { budget: { tokens: 100 } } }),
      harnessOf(CLAUDE_CODE_CAPABILITIES, run),
    );

    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.budget).toEqual({ scope: "node", unit: "tokens", limit: 100, spent: 110 });
    expect(a.data).toMatchObject({ budget_exceeded: true });
    expect(String(a.data.error)).toContain("node budget exceeded for 'a': tokens 110 of 100");
    // The cancelled agent reported no usage: the last live report stands in.
    expect(a.usage).toMatchObject({ inputTokens: 90, outputTokens: 20 });
    // The agent was told to stop through its signal, and node b never ran.
    expect(calls[0].req.signal?.aborted).toBe(true);
    expect(results.has("b")).toBe(false);
    expect(calls.map((c) => c.node)).toEqual(["a"]);
  });

  it("fail_soft and on_fail: continue do not swallow a budget stop", async () => {
    for (const soften of [{ fail_soft: true }, { on_fail: "continue" }]) {
      const { calls, run } = scripted({
        a: [{ live: [{ inputTokens: 200, outputTokens: 0 }], hang: true }],
        b: [{}],
      });
      const { results } = await exec(
        wf({}, { a: { budget: { tokens: 100 }, ...soften } }),
        harnessOf(CLAUDE_CODE_CAPABILITIES, run),
      );
      expect(results.get("a")!.status).toBe("failed");
      expect(results.has("b")).toBe(false);
      expect(calls.map((c) => c.node)).toEqual(["a"]);
    }
  });

  it("a between-node overrun (usage only on the result) stops the run before the next node", async () => {
    const { calls, run } = scripted({ a: [{ final: { inputTokens: 80, outputTokens: 40 } }], b: [{}] });
    const { results } = await exec(wf({ budget: { tokens: 100 } }), harnessOf(CODEX_CAPABILITIES, run));

    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.budget).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 120 });
    expect(results.has("b")).toBe(false);
    expect(calls.map((c) => c.node)).toEqual(["a"]);
  });

  it("a spent run budget stops the next node before it starts, without a model call", async () => {
    // Exactly at the limit is not an overrun, but nothing is left for node b.
    const { calls, run } = scripted({ a: [{ final: { inputTokens: 60, outputTokens: 40 } }], b: [{}] });
    const { results } = await exec(wf({ budget: { tokens: 100 } }), harnessOf(CLAUDE_CODE_CAPABILITIES, run));

    expect(results.get("a")!.status).toBe("success");
    const b = results.get("b")!;
    expect(b.status).toBe("failed");
    expect(b.budget).toMatchObject({ scope: "run", unit: "tokens", limit: 100, spent: 100 });
    expect(calls.map((c) => c.node)).toEqual(["a"]);
  });

  it("the CLI run ceiling tightens the workflow's: the lowest wins", async () => {
    const { run } = scripted({ a: [{ final: { inputTokens: 40, outputTokens: 20 } }], b: [{}] });
    const { results } = await exec(wf({ budget: { tokens: 1000 } }), harnessOf(CLAUDE_CODE_CAPABILITIES, run), {
      budget: { tokens: 50 },
    });
    expect(results.get("a")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 50, spent: 60 });
  });

  it("cost budgets use reported cost and never estimate", async () => {
    const { calls, run } = scripted({ a: [{ final: { costUsd: 0.75 } }], b: [{ final: { costUsd: 0.5 } }] });
    const { results } = await exec(wf({ budget: { cost_usd: 1 } }), harnessOf(CLAUDE_CODE_CAPABILITIES, run));
    expect(results.get("a")!.status).toBe("success");
    const b = results.get("b")!;
    expect(b.status).toBe("failed");
    expect(b.budget).toEqual({ scope: "run", unit: "cost_usd", limit: 1, spent: 1.25 });
    expect(String(b.data.error)).toContain("run budget exceeded: cost_usd $1.25 of $1.00");
    expect(calls).toHaveLength(2);
  });

  it("a cost budget stops a node mid-run on a harness that reports cost live (ACP)", async () => {
    const { calls, run } = scripted({ a: [{ live: [{ costUsd: 0.4 }, { costUsd: 1.1 }], hang: true }], b: [{}] });
    const { results } = await exec(wf({}, { a: { budget: { cost_usd: 1 } } }), harnessOf(ACP_CAPABILITIES, run));
    expect(results.get("a")!.budget).toEqual({ scope: "node", unit: "cost_usd", limit: 1, spent: 1.1 });
    expect(calls[0].req.signal?.aborted).toBe(true);
  });

  it("a cost budget on a tokens-only harness degrades (warn): the node runs and says it is unenforced", async () => {
    const { calls, run } = scripted({ a: [{ final: { inputTokens: 1, outputTokens: 1 } }], b: [{}] });
    const { results } = await exec(wf({}, { a: { budget: { cost_usd: 1 } } }), harnessOf(CODEX_CAPABILITIES, run), {
      harnessPolicy: "warn",
    });
    const a = results.get("a")!;
    expect(a.status).toBe("success");
    expect(a.degraded?.some((d) => d.startsWith("budget_cost_usd:"))).toBe(true);
    expect(calls.map((c) => c.node)).toEqual(["a", "b"]);
  });

  it("a cost budget on a tokens-only harness is refused under strict policy, before any spend", async () => {
    const { calls, run } = scripted({ a: [{}], b: [{}] });
    const { results } = await exec(wf({ budget: { cost_usd: 1 } }), harnessOf(CODEX_CAPABILITIES, run), {
      harnessPolicy: "strict",
    });
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.data).toMatchObject({ refused: true });
    expect(String(a.data.error)).toMatch(/strict policy: budget_cost_usd/);
    expect(calls).toHaveLength(0);
  });

  it("a harness that reports usage only at the end is enforced between nodes and says budget_live", async () => {
    const notLive: HarnessCapabilities = {
      ...CODEX_CAPABILITIES,
      usage: { tokens: true, costUsd: true, live: false },
    };
    const { run } = scripted({ a: [{ final: { inputTokens: 10, outputTokens: 5 } }], b: [{}] });
    const { results } = await exec(wf({ budget: { tokens: 1000 } }), harnessOf(notLive, run), {
      harnessPolicy: "strict",
    });
    const a = results.get("a")!;
    expect(a.status).toBe("success");
    expect(a.degraded?.some((d) => d.startsWith("budget_live:"))).toBe(true);
  });

  it("retry attempts count toward the node budget, and an exhausted node starts no further attempt", async () => {
    const { calls, run } = scripted({
      a: [{ final: { inputTokens: 40, outputTokens: 20 }, data: {} }],
      b: [{}],
    });
    const workflow = wf(
      {},
      {
        a: {
          budget: { tokens: 100 },
          eval: [{ name: "shape", kind: "value", rule: { output_required: ["done"] } }],
          retry: { max: 3 },
        },
      },
    );
    const { results } = await exec(workflow, harnessOf(CLAUDE_CODE_CAPABILITIES, run));
    const a = results.get("a")!;
    // Attempt 1: 60 of 100. Attempt 2: 120, over. No attempt 3.
    expect(calls.filter((c) => c.node === "a")).toHaveLength(2);
    expect(a.status).toBe("failed");
    expect(a.budget).toEqual({ scope: "node", unit: "tokens", limit: 100, spent: 120 });
    expect(results.has("b")).toBe(false);
  });

  it("a node's budget is per visit: a loop revisit starts from zero", async () => {
    const { calls, run } = scripted({
      a: [{ final: { inputTokens: 40, outputTokens: 20 } }],
      b: [{ final: { inputTokens: 1, outputTokens: 1 } }],
    });
    const workflow: Workflow = {
      id: "loop",
      name: "Loop",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do a", skills: [], budget: { tokens: 100 } },
        b: { name: "B", instruction: "Do b", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", max_iterations: 1 },
      ],
    };
    const { results } = await exec(workflow, harnessOf(CLAUDE_CODE_CAPABILITIES, run));
    // Two visits of 60 each: over 100 together, fine per visit.
    expect(calls.map((c) => c.node)).toEqual(["a", "b", "a", "b"]);
    expect(results.get("a")!.status).toBe("success");
  });

  it("no budget: the agent gets the caller's own signal and no onUsage (back-compat)", async () => {
    const { calls, run } = scripted({ a: [{}], b: [{}] });
    const controller = new AbortController();
    const { results } = await exec(wf(), harnessOf(CLAUDE_CODE_CAPABILITIES, run), { signal: controller.signal });
    expect(results.get("b")!.status).toBe("success");
    for (const c of calls) {
      expect(c.req.signal).toBe(controller.signal);
      expect(c.req.onUsage).toBeUndefined();
    }
  });

  it("the caller's abort still reaches an agent that runs under a budget", async () => {
    const { calls, run } = scripted({ a: [{ hang: true }], b: [{}] });
    const controller = new AbortController();
    const p = exec(wf({ budget: { tokens: 1000 } }), harnessOf(CLAUDE_CODE_CAPABILITIES, run), {
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    const { results } = await p;
    // A caller abort is not a budget stop: the node fails without a budget record.
    expect(results.get("a")!.status).toBe("failed");
    expect(results.get("a")!.budget).toBeUndefined();
    expect(calls[0].req.signal?.aborted).toBe(true);
  });

  it("works over a legacy Claude object too (no capabilities: enforced on what it reports)", async () => {
    const { run } = scripted({ a: [{ final: { inputTokens: 80, outputTokens: 40 } }], b: [{}] });
    const claude = { run, evaluate: async () => null, ask: async () => "" } as unknown as Claude;
    const { results } = await execute(
      wf({ budget: { tokens: 100 } }),
      {},
      { skills: createSkillMap([]), claude, config: {}, logger: silent },
    );
    expect(results.get("a")!.budget?.scope).toBe("run");
  });

  it("the run receipt shows the overrun", async () => {
    const { run } = scripted({ a: [{ final: { inputTokens: 80, outputTokens: 40 } }], b: [{}] });
    const { results } = await exec(wf({ budget: { tokens: 100 } }), harnessOf(CLAUDE_CODE_CAPABILITIES, run));
    const summary = summarizeRun(results, 1000);
    expect(summary.ok).toBe(false);
    expect(summary.budget).toEqual({ node: "a", scope: "run", unit: "tokens", limit: 100, spent: 120 });
    expect(formatReceipt(summary)).toContain("budget exceeded: tokens 120 of 100 (run, at node a)");
  });
});

describe("BudgetGuard", () => {
  it("reports are cumulative and never move spend backwards", () => {
    const guard = new BudgetGuard({ tokens: 100 });
    const attempt = guard.node({}).attempt();
    attempt.onUsage({ inputTokens: 50, outputTokens: 20 });
    attempt.onUsage({ inputTokens: 10 }); // a partial, smaller report
    expect(attempt.breach).toBeUndefined();
    expect(attempt.signal.aborted).toBe(false);
    attempt.onUsage({ inputTokens: 90, outputTokens: 20 });
    expect(attempt.breach).toMatchObject({ scope: "run", unit: "tokens", limit: 100, spent: 110 });
    expect(attempt.signal.aborted).toBe(true);
  });

  it("the caller's signal aborts the attempt's signal, and a finished attempt stops listening", () => {
    const guard = new BudgetGuard({ tokens: 100 });
    const outer = new AbortController();
    const a = guard.node({}).attempt(outer.signal);
    outer.abort();
    expect(a.signal.aborted).toBe(true);
    const b = guard.node({}).attempt(new AbortController().signal);
    expect(b.finish(undefined)).toBeUndefined();
  });

  it("commits the larger of live and final spend, so a cancelled agent still counts", () => {
    const guard = new BudgetGuard({});
    const node = guard.node({ costUsd: 5 });
    const a = node.attempt();
    a.onUsage({ costUsd: 2 });
    a.finish(undefined);
    expect(guard.totals).toEqual({ tokens: 0, costUsd: 2 });
  });

  it("describes an overrun in one line", () => {
    expect(describeOverrun({ scope: "run", unit: "cost_usd", limit: 1, spent: 1.25 })).toBe(
      "run budget exceeded: cost_usd $1.25 of $1.00",
    );
    expect(describeOverrun({ scope: "node", unit: "tokens", limit: 100, spent: 110.4 }, "a")).toBe(
      "node budget exceeded for 'a': tokens 110 of 100",
    );
  });

  it("minLimits takes the lower value per unit", () => {
    expect(minLimits(toLimits({ tokens: 10, cost_usd: 5 }), toLimits({ tokens: 20 }))).toEqual({
      tokens: 10,
      costUsd: 5,
    });
  });
});

describe("budgetGate", () => {
  const limits = { tokens: 100, costUsd: 1 };

  it("Claude Code: tokens are live, cost is checked between nodes (budget_live, never refused)", () => {
    const r = budgetGate(CLAUDE_CODE_CAPABILITIES, limits, true);
    expect(r.refuse).toBeUndefined();
    expect(r.degraded).toHaveLength(1);
    expect(r.degraded[0]).toMatch(/^budget_live: .*cost_usd/);
    expect(r.degraded[0]).not.toMatch(/tokens/);
  });

  it("Claude Code with a token budget only is fully live", () => {
    expect(budgetGate(CLAUDE_CODE_CAPABILITIES, { tokens: 100 }, true)).toEqual({ degraded: [] });
  });

  it("Codex: cost cannot be reported. Warn degrades, strict refuses", () => {
    const warn = budgetGate(CODEX_CAPABILITIES, { costUsd: 1 }, false);
    expect(warn.refuse).toBeUndefined();
    expect(warn.degraded[0]).toMatch(/^budget_cost_usd:/);
    const strict = budgetGate(CODEX_CAPABILITIES, { costUsd: 1 }, true);
    expect(strict.refuse).toMatch(/^strict policy: budget_cost_usd/);
  });

  it("Codex: tokens arrive only when the node ends", () => {
    const r = budgetGate(CODEX_CAPABILITIES, { tokens: 100 }, true);
    expect(r.refuse).toBeUndefined();
    expect(r.degraded[0]).toMatch(/^budget_live: .*tokens/);
  });

  it("ACP: tokens cannot be reported, cost is live", () => {
    expect(budgetGate(ACP_CAPABILITIES, { costUsd: 1 }, true)).toEqual({ degraded: [] });
    expect(budgetGate(ACP_CAPABILITIES, { tokens: 1 }, true).refuse).toMatch(/budget_tokens/);
  });

  it("no limits, nothing to report", () => {
    expect(budgetGate(CODEX_CAPABILITIES, {}, true)).toEqual({ degraded: [] });
  });
});

describe("budget schema", () => {
  const base = {
    id: "w",
    name: "W",
    entry: "a",
    nodes: { a: { name: "A", instruction: "do a", skills: [] } },
    edges: [],
  };

  it("accepts a budget on the workflow and on a node", () => {
    const parsed = parseWorkflow({
      ...base,
      budget: { tokens: 1000, cost_usd: 2.5 },
      nodes: { a: { name: "A", instruction: "do a", skills: [], budget: { cost_usd: 1 } } },
    });
    expect(parsed.budget).toEqual({ tokens: 1000, cost_usd: 2.5 });
    expect(parsed.nodes.a.budget).toEqual({ cost_usd: 1 });
  });

  it.each([{}, { tokens: 0 }, { tokens: 1.5 }, { cost_usd: 0 }, { cost_usd: -1 }, { tokens: 5, extra: 1 }])(
    "rejects the invalid budget %j",
    (budget) => {
      expect(() => parseWorkflow({ ...base, budget })).toThrow();
    },
  );

  it("a node budget above the workflow's is BUDGET_CEILING, per unit", () => {
    const workflow = parseWorkflow({
      ...base,
      budget: { tokens: 100, cost_usd: 1 },
      nodes: {
        a: { name: "A", instruction: "do a", skills: [], budget: { tokens: 200, cost_usd: 5 } },
      },
    });
    const errors = validateWorkflow(workflow).filter((e) => e.code === "BUDGET_CEILING");
    expect(errors).toHaveLength(2);
    expect(errors[0].nodeId).toBe("a");
  });

  it("a node may narrow, and may set a unit the workflow does not cap", () => {
    const workflow = parseWorkflow({
      ...base,
      budget: { tokens: 100 },
      nodes: { a: { name: "A", instruction: "do a", skills: [], budget: { tokens: 50, cost_usd: 9 } } },
    });
    expect(validateWorkflow(workflow).filter((e) => e.code === "BUDGET_CEILING")).toHaveLength(0);
  });

  it("loads from YAML", () => {
    const dir = mkdtempSync(join(tmpdir(), "sweny-budget-"));
    const file = join(dir, "wf.yml");
    writeFileSync(
      file,
      `id: demo
name: Demo
entry: a
budget: { tokens: 5000 }
nodes:
  a: { name: A, instruction: do a, skills: [], budget: { cost_usd: 0.5 } }
edges: []
`,
    );
    try {
      const r = loadAndValidateWorkflow(file);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.workflow.budget).toEqual({ tokens: 5000 });
        expect(r.workflow.nodes.a.budget).toEqual({ cost_usd: 0.5 });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("--max-tokens and --max-cost", () => {
  it("are registered on `workflow run`", () => {
    const flags = WORKFLOW_RUN_OPTIONS.map(([f]) => f);
    expect(flags).toContain("--max-tokens <n>");
    expect(flags).toContain("--max-cost <usd>");
  });

  it("parse into a run budget, and absent flags mean no ceiling", () => {
    expect(parseSpendFlags(undefined, undefined)).toBeUndefined();
    expect(parseSpendFlags("50000", undefined)).toEqual({ tokens: 50000 });
    expect(parseSpendFlags(undefined, "2.50")).toEqual({ cost_usd: 2.5 });
    expect(parseSpendFlags("100", "0.1")).toEqual({ tokens: 100, cost_usd: 0.1 });
  });

  it.each([
    ["abc", undefined, /--max-tokens/],
    ["0", undefined, /--max-tokens/],
    ["1.5", undefined, /--max-tokens/],
    ["-5", undefined, /--max-tokens/],
    [undefined, "free", /--max-cost/],
    [undefined, "0", /--max-cost/],
    [undefined, "", /--max-cost/],
  ])("rejects junk loudly (%s, %s)", (tokens, cost, message) => {
    expect(() => parseSpendFlags(tokens, cost)).toThrow(message);
  });
});
