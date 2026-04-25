// ─── Eval: dispatcher + aggregation ──────────────────────────────────
//
// `evaluateAll(...)` runs every declared evaluator and returns a structured
// list of EvalResults. `aggregateEval(...)` collapses that list into a
// single pass/fail under the node's eval_policy. v1 implements `all_pass`.

import type { Claude, EvalPolicy, EvalResult, Evaluator, NodeResult, Workflow, Node } from "../types.js";
import { evaluateValueRule } from "./value.js";
import { evaluateFunctionRule, type ToolAliases } from "./function.js";
import { evaluateJudge } from "./judge.js";

export type { ToolAliases } from "./function.js";

/** Reasoning cap, matching the spec's ~500-character ceiling. */
const MAX_REASONING_LENGTH = 500;

/** Default judge model when neither evaluator nor node nor workflow specify one. */
const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";

function capReasoning(reasoning: string | undefined): string | undefined {
  if (!reasoning) return undefined;
  if (reasoning.length <= MAX_REASONING_LENGTH) return reasoning;
  return reasoning.slice(0, MAX_REASONING_LENGTH - 1) + "…";
}

function resolveJudgeModel(evaluator: Evaluator, node: Node | undefined, workflow: Workflow | undefined): string {
  return evaluator.model ?? node?.judge_model ?? workflow?.judge_model ?? DEFAULT_JUDGE_MODEL;
}

export interface EvaluateAllOptions {
  /** Tool-name aliases from the loaded skills. Used by `function` evaluators only. */
  aliases?: ToolAliases;
  /** Optional Claude client. Required when any evaluator has kind: "judge". */
  claude?: Claude;
  /** The node being evaluated. Used to resolve per-node `judge_model` overrides. */
  node?: Node;
  /** The workflow being executed. Used to resolve workflow-level `judge_model` overrides. */
  workflow?: Workflow;
}

/**
 * Run every declared evaluator against the node's result and return one
 * {@link EvalResult} per evaluator, in declaration order.
 *
 * The function never throws on a failing rule (failures become
 * `{ pass: false, reasoning }` results). It DOES throw if the underlying
 * judge implementation throws (e.g. v1.0 judge stub) so the executor can
 * surface the error clearly at the call site.
 */
export async function evaluateAll(
  evaluators: Evaluator[] | undefined,
  result: NodeResult,
  opts: EvaluateAllOptions = {},
): Promise<EvalResult[]> {
  if (!evaluators || evaluators.length === 0) return [];

  const out: EvalResult[] = [];
  for (const e of evaluators) {
    if (e.kind === "value") {
      const verdict = evaluateValueRule(e.rule ?? {}, result.data);
      out.push({
        name: e.name,
        kind: "value",
        pass: verdict.pass,
        reasoning: capReasoning(verdict.reasoning),
      });
    } else if (e.kind === "function") {
      const verdict = evaluateFunctionRule(e.rule ?? {}, result.toolCalls, opts.aliases);
      out.push({
        name: e.name,
        kind: "function",
        pass: verdict.pass,
        reasoning: capReasoning(verdict.reasoning),
      });
    } else if (e.kind === "judge") {
      if (!opts.claude) {
        throw new Error(`evaluator '${e.name}' is kind: judge but no Claude client was provided to evaluateAll`);
      }
      const model = resolveJudgeModel(e, opts.node, opts.workflow);
      const verdict = await evaluateJudge(e, result, opts.claude, { model });
      out.push({
        name: e.name,
        kind: "judge",
        pass: verdict.pass,
        reasoning: capReasoning(verdict.reasoning),
      });
    }
  }
  return out;
}

export interface AggregateOutcome {
  /** Whether the node passed under the configured policy. */
  pass: boolean;
  /**
   * Structured failure message for the executor when `pass` is false.
   * Format: header line + one bulleted line per failing evaluator.
   * Suitable as input to {@link buildRetryPreamble}.
   */
  error?: string;
  /** Direct access to the failed evaluator results, in declaration order. */
  failures: EvalResult[];
}

/**
 * Collapse a list of {@link EvalResult}s into a single pass/fail under the
 * node's `eval_policy`. v1 implements `all_pass`. Other policies are
 * accepted at parse time but rejected here so users get a clear error.
 */
export function aggregateEval(results: EvalResult[], policy: EvalPolicy = "all_pass"): AggregateOutcome {
  if (results.length === 0) return { pass: true, failures: [] };

  if (policy === "all_pass") {
    const failures = results.filter((r) => !r.pass);
    if (failures.length === 0) return { pass: true, failures: [] };
    const lines = failures.map((f) => `  - ${f.name} (${f.kind}): ${f.reasoning ?? "no reasoning"}`);
    return {
      pass: false,
      error: `eval failed (policy: all_pass):\n${lines.join("\n")}`,
      failures,
    };
  }

  throw new Error(
    `eval_policy '${policy}' is reserved in v1.0 but not yet implemented; use 'all_pass' (default) for v1.0 workflows`,
  );
}
