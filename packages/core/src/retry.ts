// ─── Retry: preamble construction for eval-failure self-healing ──────
//
// Builds the preamble that gets prepended to the node instruction on retry.
// In autonomous modes ({ auto: true } or { reflect: ... }), this calls
// claude.ask to generate a diagnosis. If reflection fails or returns empty,
// falls back to the default static preamble. Reflection failure never
// escalates to a workflow failure.

import type { Claude, EvalResult, NodeRetry, ToolCall, Logger } from "./types.js";
import { isErrorOutput } from "./eval/function.js";

const DEFAULT_REFLECTION_PROMPT =
  "Briefly diagnose the failure and state your strategy for the retry. Keep your response to 2-4 sentences.";

const DEFAULT_PREAMBLE_HEADER = "## Previous attempt failed evaluation";

export interface BuildRetryPreambleOptions {
  retry: NodeRetry;
  /**
   * Failing evaluator results from the previous attempt. Used both for the
   * structured failure list shown to the agent and as input to autonomous
   * reflection.
   */
  evalFailures: EvalResult[];
  toolCalls: ToolCall[];
  nodeInstruction: string;
  claude: Claude;
  logger: Logger;
  context: Record<string, unknown>;
}

/**
 * Build the retry preamble for a single retry attempt.
 *
 * Resolution order:
 *   1. retry.instruction is a string         → static preamble + structured failure list
 *   2. retry.instruction is { auto: true }   → claude.ask(default prompt)
 *   3. retry.instruction is { reflect: "..." } → claude.ask(author prompt)
 *   4. Otherwise (omitted)                   → default preamble
 *
 * Reflection failure (throw or empty response) silently falls back to the
 * default static preamble and logs a warning.
 */
export async function buildRetryPreamble(opts: BuildRetryPreambleOptions): Promise<string> {
  const { retry, evalFailures, toolCalls, nodeInstruction, claude, logger, context } = opts;
  const failureList = formatEvalFailures(evalFailures);

  const inst = retry.instruction;

  if (typeof inst === "string") {
    return `## Retry guidance\n\n${inst}\n\n${DEFAULT_PREAMBLE_HEADER}\n\n${failureList}`;
  }

  if (inst && typeof inst === "object") {
    const reflectPrompt =
      "reflect" in inst && typeof inst.reflect === "string" ? inst.reflect : DEFAULT_REFLECTION_PROMPT;
    const askInstruction = buildReflectionPrompt(reflectPrompt, nodeInstruction, failureList, toolCalls);
    try {
      const diagnosis = await claude.ask({ instruction: askInstruction, context });
      const trimmed = diagnosis.trim();
      if (trimmed.length > 0) {
        return `## Reflection on previous attempt\n\n${trimmed}\n\n${DEFAULT_PREAMBLE_HEADER}\n\n${failureList}`;
      }
      logger.warn("Retry reflection returned empty response; falling back to default preamble.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Retry reflection threw: ${msg}; falling back to default preamble.`);
    }
  }

  return defaultPreamble(failureList);
}

/**
 * Render a list of failing evaluator results as a structured bullet list
 * suitable for prepending to a retry instruction.
 *
 * Each entry takes the form `- name (kind): reasoning`. The list is the
 * same shape regardless of whether the originating policy is `all_pass`,
 * `any_pass`, or `weighted`.
 */
export function formatEvalFailures(failures: EvalResult[]): string {
  if (failures.length === 0) return "(no failing evaluators reported)";
  return failures.map((f) => `  - ${f.name} (${f.kind}): ${f.reasoning ?? "no reasoning"}`).join("\n");
}

function defaultPreamble(failureList: string): string {
  return `${DEFAULT_PREAMBLE_HEADER}\n\n${failureList}\n\nFix the issue and try again.`;
}

function buildReflectionPrompt(
  reflectPrompt: string,
  nodeInstruction: string,
  failureList: string,
  toolCalls: ToolCall[],
): string {
  const summary = summarizeToolCalls(toolCalls);
  return [
    `You attempted to: ${nodeInstruction}`,
    "",
    `Evaluation failed:`,
    failureList,
    "",
    `You called these tools during the failed attempt:`,
    summary,
    "",
    reflectPrompt,
  ].join("\n");
}

function summarizeToolCalls(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return "(no tools were called)";
  return toolCalls
    .map((c) => {
      const status = isErrorOutput(c.output) ? "error" : "ok";
      return `  - ${c.tool} (${status})`;
    })
    .join("\n");
}
