// ─── Eval: judge (LLM-as-judge) evaluator ────────────────────────────
//
// Calls a small Claude model with the node's data, the node's tool-call
// trace, and the author's rubric. Parses a verdict token and a short
// reasoning paragraph from a structured response.
//
// Cost: one model call per judge evaluator per node attempt. Judges are
// expected to use a small fast model (default `claude-haiku-4-5`); the
// reasoning is capped at ~500 chars before it lands on EvalResult so a
// chatty judge doesn't bloat the trace.
//
// Latency: a judge adds one round-trip per node beyond the main LLM call.
// For a typical 4-node workflow with 2 judges per node, that's 8 extra
// calls per run. The workflow-level `judge_budget` (default 50) gives
// authors a load-time warning when the total stretches past expected.

import type { Claude, Evaluator, NodeResult, ToolCall } from "../types.js";

export interface JudgeOptions {
  /** Resolved judge model (evaluator > node > workflow > package default). */
  model: string;
}

interface ParsedResponse {
  verdict: string | null;
  reasoning: string | null;
}

/**
 * Build the structured judge prompt.
 *
 * The prompt format is fixed so the parser can rely on it. Model authors
 * MUST NOT change the section markers without updating {@link parseJudgeResponse}
 * in lockstep.
 */
export function buildJudgePrompt(evaluator: Evaluator, result: NodeResult): string {
  const passWhen = evaluator.pass_when ?? "yes";
  const failWhen = passWhen === "yes" ? "no" : `not_${passWhen}`;

  return [
    `You are a judge evaluator. Read the rubric, the node's result data, and`,
    `the tool-call trace, then decide whether the result satisfies the rubric.`,
    ``,
    `## Rubric`,
    ``,
    evaluator.rubric ?? "(no rubric provided)",
    ``,
    `## Node result data`,
    ``,
    "```json",
    JSON.stringify(result.data ?? {}, null, 2),
    "```",
    ``,
    `## Tool calls`,
    ``,
    summarizeToolCalls(result.toolCalls ?? []),
    ``,
    `## Output format`,
    ``,
    `Respond with EXACTLY two lines, in this order, and nothing else:`,
    ``,
    `VERDICT: <${passWhen}|${failWhen}>`,
    `REASONING: <one paragraph, max 3 sentences, explaining the verdict>`,
    ``,
    `If the rubric passes vacuously (e.g. a conditional clause does not`,
    `apply to this result), respond with VERDICT: ${passWhen} and a brief`,
    `note in REASONING.`,
  ].join("\n");
}

function summarizeToolCalls(calls: ToolCall[]): string {
  if (calls.length === 0) return "(no tools were called)";
  return calls
    .map((c) => {
      const status = c.status ?? (looksLikeError(c.output) ? "error" : "success");
      const inputPreview = preview(c.input);
      const outputPreview = preview(c.output);
      return `- ${c.tool} [${status}] input=${inputPreview} output=${outputPreview}`;
    })
    .join("\n");
}

function looksLikeError(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const err = (output as Record<string, unknown>).error;
  return err !== undefined && err !== null && err !== false;
}

/** Compact JSON preview. Caps long values to keep the prompt short. */
function preview(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (!s) return "<empty>";
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

/**
 * Parse a judge response into `{ verdict, reasoning }`.
 *
 * Format expected:
 *   VERDICT: <token>
 *   REASONING: <text...>
 *
 * Lines may have any leading whitespace. Reasoning may span multiple lines
 * (everything after the `REASONING:` marker is consumed). Returns null
 * fields when the markers are missing.
 */
export function parseJudgeResponse(text: string): ParsedResponse {
  const verdictMatch = /VERDICT\s*:\s*(\S+)/i.exec(text);
  const reasoningMatch = /REASONING\s*:\s*([\s\S]*)$/i.exec(text);

  const verdict = verdictMatch ? verdictMatch[1]!.trim().toLowerCase() : null;
  const reasoning = reasoningMatch ? reasoningMatch[1]!.trim() : null;

  return { verdict, reasoning };
}

const PARSE_FAILURE_REASONING = "judge parse failure: model response did not contain a parseable VERDICT line";

/**
 * Run a single judge evaluator against a node result.
 *
 * Resolves a verdict by calling the judge model, parsing VERDICT/REASONING,
 * and comparing the verdict to `pass_when` (default `yes`). On parse
 * failure, retries the call once. If the retry also fails to parse,
 * returns `pass: false` with a "judge parse failure" reasoning instead of
 * throwing, so a single flaky model response doesn't halt the workflow.
 */
export async function evaluateJudge(
  evaluator: Evaluator,
  result: NodeResult,
  claude: Claude,
  opts: JudgeOptions,
): Promise<{ pass: boolean; reasoning?: string }> {
  const passWhen = (evaluator.pass_when ?? "yes").toLowerCase();
  const prompt = buildJudgePrompt(evaluator, result);

  for (let attempt = 0; attempt < 2; attempt++) {
    let response: string;
    try {
      response = await claude.ask({
        instruction: prompt,
        context: {},
        model: opts.model,
      });
    } catch {
      // Treat throws as parse failure for retry purposes; the second attempt
      // either succeeds or surfaces the same path through the same channel.
      continue;
    }

    const parsed = parseJudgeResponse(response);
    if (parsed.verdict === null) continue;

    const pass = parsed.verdict === passWhen;
    return {
      pass,
      reasoning: parsed.reasoning ?? undefined,
    };
  }

  return { pass: false, reasoning: PARSE_FAILURE_REASONING };
}
