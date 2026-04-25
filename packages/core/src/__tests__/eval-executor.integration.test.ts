// ─── End-to-end integration tests for the eval contract ────────────
//
// These tests run real workflows through the executor with a mock Claude
// client. They lock the published contracts that pure-unit tests can't
// fully cover:
//   - downstream nodes can read `priorNode.evals.<name>.pass`
//   - judge_budget warns at load time when the workflow exceeds it
//   - reserved eval_policy values parse but fail at runtime with a clear error
//   - judge evaluators run through the executor and populate result.evals
//   - retry preamble carries structured per-evaluator failures
//   - parseWorkflow rejects legacy verify: blocks at any scope

import { describe, it, expect, vi } from "vitest";
import { execute } from "../executor.js";
import { parseWorkflow } from "../schema.js";
import { createSkillMap } from "../skills/index.js";
import type { Claude, ExecutionEvent, Logger, NodeResult, Workflow } from "../types.js";

function silentLogger(): Logger & { warns: Array<[string, Record<string, unknown> | undefined]> } {
  const warns: Array<[string, Record<string, unknown> | undefined]> = [];
  return {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: (msg, data) => {
      warns.push([msg, data]);
    },
    warns,
  };
}

function fakeClaude(opts: {
  /** Per-node scripted result. Keyed on the substring matched against the instruction. */
  results?: Record<string, NodeResult>;
  /** Scripted ask responses (used by judges). */
  askResponses?: string[];
  /** Routing decision when claude.evaluate is called: choices[0].id by default. */
  evaluateChoice?: (choices: { id: string }[]) => string;
}): Claude & { askCalls: Array<{ instruction: string; model?: string }> } {
  const askCalls: Array<{ instruction: string; model?: string }> = [];
  let askIdx = 0;

  const claude: Claude = {
    async run(runOpts) {
      const nodeId = Object.keys(opts.results ?? {}).find((id) => runOpts.instruction.includes(id));
      const fallback: NodeResult = { status: "success", data: {}, toolCalls: [] };
      return nodeId ? opts.results![nodeId]! : fallback;
    },
    async evaluate(evalOpts) {
      if (opts.evaluateChoice) return opts.evaluateChoice(evalOpts.choices);
      return evalOpts.choices[0]?.id ?? "";
    },
    async ask(askOpts) {
      askCalls.push({ instruction: askOpts.instruction, model: askOpts.model });
      const r = opts.askResponses?.[askIdx++];
      return r ?? "VERDICT: yes\nREASONING: default mock reply";
    },
  };

  return Object.assign(claude, { askCalls });
}

// ─── Spec promise: priorNode.evals.<name>.pass is readable from context ──

describe("downstream context exposes evals from prior nodes", () => {
  it("places prior-node evals under .evals keyed by evaluator name", async () => {
    const workflow: Workflow = {
      id: "evals-context",
      name: "evals-context",
      description: "",
      entry: "first",
      nodes: {
        first: {
          name: "first",
          instruction: "first",
          skills: [],
          eval: [{ name: "shape_ok", kind: "value", rule: { output_required: ["x"] } }],
        },
        second: {
          name: "second",
          instruction: "second",
          skills: [],
        },
      },
      edges: [{ from: "first", to: "second" }],
    };

    let observedContext: Record<string, unknown> | undefined;
    const claude: Claude = {
      async run(opts) {
        if (opts.instruction.includes("second")) {
          observedContext = { ...opts.context };
        }
        if (opts.instruction.includes("first")) {
          return { status: "success", data: { x: 1 }, toolCalls: [] };
        }
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(o) {
        return o.choices[0]!.id;
      },
      async ask() {
        return "";
      },
    };

    await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });

    expect(observedContext).toBeDefined();
    const first = observedContext!.first as Record<string, unknown>;
    expect(first).toBeDefined();
    expect(first.x).toBe(1);
    const evals = first.evals as Record<string, { name: string; kind: string; pass: boolean }>;
    expect(evals).toBeDefined();
    expect(evals.shape_ok).toBeDefined();
    expect(evals.shape_ok.pass).toBe(true);
    expect(evals.shape_ok.kind).toBe("value");
  });

  it("a data-side `evals` field shadows the eval namespace (back-compat)", async () => {
    const workflow: Workflow = {
      id: "shadow",
      name: "shadow",
      description: "",
      entry: "first",
      nodes: {
        first: { name: "first", instruction: "first", skills: [] },
        second: { name: "second", instruction: "second", skills: [] },
      },
      edges: [{ from: "first", to: "second" }],
    };

    let observedContext: Record<string, unknown> | undefined;
    const claude: Claude = {
      async run(opts) {
        if (opts.instruction.includes("first")) {
          // The agent returns a literal `evals` field. Back-compat: data wins.
          return {
            status: "success",
            data: { evals: "i am a literal value" },
            toolCalls: [],
          };
        }
        if (opts.instruction.includes("second")) {
          observedContext = { ...opts.context };
        }
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(o) {
        return o.choices[0]!.id;
      },
      async ask() {
        return "";
      },
    };

    await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });
    const first = observedContext!.first as Record<string, unknown>;
    expect(first.evals).toBe("i am a literal value");
  });
});

// ─── judge_budget warning at load time ──────────────────────────────

describe("judge_budget warning", () => {
  function makeWorkflow(judgeCount: number, budget?: number): Workflow {
    const evaluators = Array.from({ length: judgeCount }, (_, i) => ({
      name: `j_${i}`,
      kind: "judge" as const,
      rubric: "is it good?",
      pass_when: "yes",
    }));
    return {
      id: "budget",
      name: "budget",
      description: "",
      entry: "n",
      nodes: { n: { name: "n", instruction: "n", skills: [], eval: evaluators } },
      edges: [],
      ...(budget !== undefined ? { judge_budget: budget } : {}),
    };
  }

  it("does not warn when judge count is at or below the budget", async () => {
    const logger = silentLogger();
    const claude = fakeClaude({
      results: { n: { status: "success", data: {}, toolCalls: [] } },
      askResponses: Array.from({ length: 50 }, () => "VERDICT: yes\nREASONING: ok"),
    });
    await execute(makeWorkflow(3, 10), {}, { skills: createSkillMap([]), claude, logger });
    const budgetWarns = logger.warns.filter(([m]) => m.includes("judge"));
    expect(budgetWarns).toHaveLength(0);
  });

  it("warns when judge count exceeds an explicit budget", async () => {
    const logger = silentLogger();
    const claude = fakeClaude({
      results: { n: { status: "success", data: {}, toolCalls: [] } },
      askResponses: Array.from({ length: 10 }, () => "VERDICT: yes\nREASONING: ok"),
    });
    await execute(makeWorkflow(5, 3), {}, { skills: createSkillMap([]), claude, logger });
    const budgetWarns = logger.warns.filter(([m]) => m.includes("judge"));
    expect(budgetWarns.length).toBeGreaterThan(0);
    expect(budgetWarns[0]![0]).toMatch(/5 judge.*budget: 3/);
  });

  it("uses default budget of 50 when none specified", async () => {
    const logger = silentLogger();
    const claude = fakeClaude({
      results: { n: { status: "success", data: {}, toolCalls: [] } },
      askResponses: Array.from({ length: 100 }, () => "VERDICT: yes\nREASONING: ok"),
    });
    await execute(makeWorkflow(51), {}, { skills: createSkillMap([]), claude, logger });
    const budgetWarns = logger.warns.filter(([m]) => m.includes("judge"));
    expect(budgetWarns.length).toBeGreaterThan(0);
    expect(budgetWarns[0]![0]).toMatch(/budget: 50/);
  });
});

// ─── eval_policy reserved values fail at runtime ────────────────────

describe("eval_policy: reserved values", () => {
  function makeWorkflow(policy: "any_pass" | "weighted"): Workflow {
    return {
      id: "reserved",
      name: "reserved",
      description: "",
      entry: "n",
      nodes: {
        n: {
          name: "n",
          instruction: "n",
          skills: [],
          eval: [{ name: "shape", kind: "value", rule: { output_required: ["x"] } }],
          eval_policy: policy,
        },
      },
      edges: [],
    };
  }

  it("any_pass at runtime surfaces a reserved-policy error", async () => {
    const claude = fakeClaude({
      results: { n: { status: "success", data: { x: 1 }, toolCalls: [] } },
    });
    await expect(
      execute(makeWorkflow("any_pass"), {}, { skills: createSkillMap([]), claude, logger: silentLogger() }),
    ).rejects.toThrow(/any_pass.*reserved in v1\.0/);
  });

  it("weighted at runtime surfaces a reserved-policy error", async () => {
    const claude = fakeClaude({
      results: { n: { status: "success", data: { x: 1 }, toolCalls: [] } },
    });
    await expect(
      execute(makeWorkflow("weighted"), {}, { skills: createSkillMap([]), claude, logger: silentLogger() }),
    ).rejects.toThrow(/weighted.*reserved in v1\.0/);
  });
});

// ─── End-to-end: judge through executor ─────────────────────────────

describe("judge evaluator runs through the executor", () => {
  it("populates NodeResult.evals with the judge verdict and reasoning", async () => {
    const workflow: Workflow = {
      id: "judge-e2e",
      name: "judge-e2e",
      description: "",
      entry: "n",
      nodes: {
        n: {
          name: "n",
          instruction: "n",
          skills: [],
          eval: [{ name: "judged", kind: "judge", rubric: "would this be good?", pass_when: "yes" }],
        },
      },
      edges: [],
    };

    const claude = fakeClaude({
      results: { n: { status: "success", data: { ok: true }, toolCalls: [] } },
      askResponses: ["VERDICT: yes\nREASONING: looks great"],
    });

    const { results } = await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });
    const r = results.get("n")!;
    expect(r.status).toBe("success");
    expect(r.evals).toHaveLength(1);
    expect(r.evals![0]!.kind).toBe("judge");
    expect(r.evals![0]!.pass).toBe(true);
    expect(r.evals![0]!.reasoning).toBe("looks great");
  });

  it("passes the resolved judge_model down to claude.ask", async () => {
    const workflow: Workflow = {
      id: "judge-model",
      name: "judge-model",
      description: "",
      entry: "n",
      judge_model: "claude-sonnet-4-6",
      nodes: {
        n: {
          name: "n",
          instruction: "n",
          skills: [],
          eval: [{ name: "j", kind: "judge", rubric: "?", pass_when: "yes" }],
        },
      },
      edges: [],
    };
    const claude = fakeClaude({
      results: { n: { status: "success", data: {}, toolCalls: [] } },
      askResponses: ["VERDICT: yes\nREASONING: ok"],
    });
    await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });
    expect(claude.askCalls[0]!.model).toBe("claude-sonnet-4-6");
  });

  it("fails the node when the judge returns the negative verdict", async () => {
    const workflow: Workflow = {
      id: "judge-fail",
      name: "judge-fail",
      description: "",
      entry: "n",
      nodes: {
        n: {
          name: "n",
          instruction: "n",
          skills: [],
          eval: [{ name: "j", kind: "judge", rubric: "?", pass_when: "yes" }],
        },
      },
      edges: [],
    };
    const claude = fakeClaude({
      results: { n: { status: "success", data: {}, toolCalls: [] } },
      askResponses: ["VERDICT: no\nREASONING: nope"],
    });
    const { results } = await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });
    const r = results.get("n")!;
    expect(r.status).toBe("failed");
    expect(r.data.error).toMatch(/eval failed.*j \(judge\): nope/s);
    expect(r.evals![0]!.pass).toBe(false);
  });
});

// ─── End-to-end: retry preamble carries structured failures ─────────

describe("retry preamble surfaces structured eval failures", () => {
  it("includes 'name (kind): reasoning' bullets for each failed evaluator", async () => {
    const workflow: Workflow = {
      id: "retry-shape",
      name: "retry-shape",
      description: "",
      entry: "n",
      nodes: {
        n: {
          name: "n",
          instruction: "n",
          skills: [],
          eval: [
            { name: "called", kind: "function", rule: { any_tool_called: ["x"] } },
            { name: "shape", kind: "value", rule: { output_required: ["missing"] } },
          ],
          retry: { max: 1 },
        },
      },
      edges: [],
    };

    const seenInstructions: string[] = [];
    const claude: Claude = {
      async run(opts) {
        seenInstructions.push(opts.instruction);
        // First attempt: empty data, no tool calls. Second attempt: provide both.
        const data = seenInstructions.length === 1 ? {} : { missing: "now-present" };
        const toolCalls =
          seenInstructions.length === 1
            ? []
            : [{ tool: "x", input: {}, output: { ok: true }, status: "success" as const }];
        return { status: "success", data, toolCalls };
      },
      async evaluate(o) {
        return o.choices[0]!.id;
      },
      async ask() {
        return "";
      },
    };

    const { results } = await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });
    expect(seenInstructions.length).toBe(2);
    const retryInstruction = seenInstructions[1]!;
    expect(retryInstruction).toMatch(/Previous attempt failed evaluation/);
    expect(retryInstruction).toContain("called (function):");
    expect(retryInstruction).toContain("shape (value):");
    expect(results.get("n")!.status).toBe("success");
  });
});

// ─── parseWorkflow guard: legacy verify rejected at any scope ───────

describe("parseWorkflow rejects legacy verify: at any scope", () => {
  it("rejects a node-level verify with a migration-pointing message", () => {
    const raw = {
      id: "wf",
      name: "wf",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", verify: { any_tool_called: ["t"] } } },
      edges: [],
    };
    expect(() => parseWorkflow(raw)).toThrow(/Node "a".*renamed to 'eval:'/);
  });

  it("rejects a top-level verify (typo / wrong scope) with a migration-pointing message", () => {
    const raw = {
      id: "wf",
      name: "wf",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x" } },
      edges: [],
      verify: { any_tool_called: ["t"] },
    };
    expect(() => parseWorkflow(raw)).toThrow(/Workflow.*renamed to 'eval:'/);
  });

  it("includes the spec link in the error message", () => {
    const raw = {
      id: "wf",
      name: "wf",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", verify: { output_required: ["x"] } } },
      edges: [],
    };
    expect(() => parseWorkflow(raw)).toThrow(/spec\.sweny\.ai\/nodes/);
  });

  it("does not warn or throw on a clean eval-shaped workflow", () => {
    const raw = {
      id: "wf",
      name: "wf",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "x",
          eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["t"] } }],
        },
      },
      edges: [],
    };
    expect(() => parseWorkflow(raw)).not.toThrow();
  });
});

// ─── pass_when single-token validation ──────────────────────────────

describe("pass_when validation", () => {
  it("rejects a pass_when value containing whitespace", () => {
    const raw = {
      id: "wf",
      name: "wf",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "x",
          eval: [{ name: "j", kind: "judge", rubric: "ok?", pass_when: "yes please" }],
        },
      },
      edges: [],
    };
    expect(() => parseWorkflow(raw)).toThrow(/pass_when must be a single whitespace-free token/);
  });

  it("accepts a single-token pass_when", () => {
    const raw = {
      id: "wf",
      name: "wf",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "x",
          eval: [{ name: "j", kind: "judge", rubric: "ok?", pass_when: "approved" }],
        },
      },
      edges: [],
    };
    expect(() => parseWorkflow(raw)).not.toThrow();
  });

  it("rejects a pass_when with a leading newline", () => {
    const raw = {
      id: "wf",
      name: "wf",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "x",
          eval: [{ name: "j", kind: "judge", rubric: "ok?", pass_when: "\nyes" }],
        },
      },
      edges: [],
    };
    expect(() => parseWorkflow(raw)).toThrow(/pass_when must be a single whitespace-free token/);
  });
});

// ─── result.evals contract ──────────────────────────────────────────

describe("NodeResult.evals contract", () => {
  it("populates evals in declaration order with one entry per evaluator", async () => {
    const workflow: Workflow = {
      id: "order",
      name: "order",
      description: "",
      entry: "n",
      nodes: {
        n: {
          name: "n",
          instruction: "n",
          skills: [],
          eval: [
            { name: "z_first", kind: "value", rule: { output_required: ["x"] } },
            { name: "a_second", kind: "function", rule: { any_tool_called: ["t"] } },
            { name: "m_third", kind: "value", rule: { output_required: ["x"] } },
          ],
        },
      },
      edges: [],
    };
    const claude = fakeClaude({
      results: {
        n: {
          status: "success",
          data: { x: 1 },
          toolCalls: [{ tool: "t", input: {}, output: { ok: true }, status: "success" }],
        },
      },
    });
    const { results } = await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });
    const r = results.get("n")!;
    expect(r.evals!.map((e) => e.name)).toEqual(["z_first", "a_second", "m_third"]);
    expect(r.evals!.every((e) => e.pass)).toBe(true);
  });

  it("caps reasoning at ~500 characters with an ellipsis", async () => {
    const workflow: Workflow = {
      id: "cap",
      name: "cap",
      description: "",
      entry: "n",
      nodes: {
        n: {
          name: "n",
          instruction: "n",
          skills: [],
          eval: [{ name: "j", kind: "judge", rubric: "?", pass_when: "yes" }],
        },
      },
      edges: [],
    };
    const longReasoning = "x".repeat(800);
    const claude = fakeClaude({
      results: { n: { status: "success", data: {}, toolCalls: [] } },
      askResponses: [`VERDICT: yes\nREASONING: ${longReasoning}`],
    });
    const { results } = await execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silentLogger() });
    const r = results.get("n")!;
    expect(r.evals![0]!.reasoning!.length).toBe(500);
    expect(r.evals![0]!.reasoning!.endsWith("…")).toBe(true);
  });
});
