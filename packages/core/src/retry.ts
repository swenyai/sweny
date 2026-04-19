// ─── Retry: preamble construction for verify-failure self-healing ──
//
// Builds the preamble that gets prepended to the node instruction on retry.
// In autonomous modes ({ auto: true } or { reflect: ... }), this calls
// claude.ask to generate a diagnosis. If reflection fails or returns empty,
// falls back to the default static preamble — reflection failure never
// escalates to a workflow failure.

import type { Claude, NodeRetry, ToolCall, Logger } from "./types.js";

const DEFAULT_REFLECTION_PROMPT =
  "Briefly diagnose the failure and state your strategy for the retry. Keep your response to 2-4 sentences.";

const DEFAULT_PREAMBLE_HEADER = "## Previous attempt failed verification";

export interface BuildRetryPreambleOptions {
  retry: NodeRetry;
  verifyError: string;
  toolCalls: ToolCall[];
  nodeInstruction: string;
  claude: Claude;
  logger: Logger;
}

/**
 * Build the retry preamble for a single retry attempt.
 *
 * Resolution order:
 *   1. retry.instruction is a string         → static preamble + verify error
 *   2. retry.instruction is { auto: true }   → claude.ask(default prompt)
 *   3. retry.instruction is { reflect: "..." } → claude.ask(author prompt)
 *   4. Otherwise (omitted)                   → default preamble
 *
 * Reflection failure (throw or empty response) silently falls back to the
 * default static preamble and logs a warning.
 */
export async function buildRetryPreamble(opts: BuildRetryPreambleOptions): Promise<string> {
  const { retry, verifyError, toolCalls, nodeInstruction, claude, logger } = opts;

  const inst = retry.instruction;

  if (typeof inst === "string") {
    return `## Retry guidance\n\n${inst}\n\n${DEFAULT_PREAMBLE_HEADER}\n\n${verifyError}`;
  }

  if (inst && typeof inst === "object") {
    const reflectPrompt = "reflect" in inst ? inst.reflect : DEFAULT_REFLECTION_PROMPT;
    const askInstruction = buildReflectionPrompt(reflectPrompt, nodeInstruction, verifyError, toolCalls);
    try {
      const diagnosis = await claude.ask({ instruction: askInstruction, context: {} });
      const trimmed = diagnosis.trim();
      if (trimmed.length > 0) {
        return `## Reflection on previous attempt\n\n${trimmed}\n\n${DEFAULT_PREAMBLE_HEADER}\n\n${verifyError}`;
      }
      logger.warn("Retry reflection returned empty response; falling back to default preamble.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Retry reflection threw: ${msg}; falling back to default preamble.`);
    }
  }

  return defaultPreamble(verifyError);
}

function defaultPreamble(verifyError: string): string {
  return `${DEFAULT_PREAMBLE_HEADER}\n\n${verifyError}\n\nFix the issue and try again.`;
}

function buildReflectionPrompt(
  reflectPrompt: string,
  nodeInstruction: string,
  verifyError: string,
  toolCalls: ToolCall[],
): string {
  const summary = summarizeToolCalls(toolCalls);
  return [
    `You attempted to: ${nodeInstruction}`,
    "",
    `Verification failed with: ${verifyError}`,
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
      const status = isError(c.output) ? "error" : "ok";
      return `  - ${c.tool} (${status})`;
    })
    .join("\n");
}

function isError(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const err = (output as Record<string, unknown>).error;
  return err !== undefined && err !== null && err !== false;
}
