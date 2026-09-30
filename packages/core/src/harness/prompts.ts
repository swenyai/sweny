/**
 * Harness-agnostic prompts: `ask()` and `evaluate()` build the prompt in core
 * and run it over `harness.complete()`. The strings are byte-identical to what
 * `ClaudeClient.ask` / `ClaudeClient.evaluate` built before the harness seam
 * (#330); prompts.test.ts pins them against the old builders.
 */

import type { Claude, Logger } from "../types.js";
import { consoleLogger } from "../types.js";
import { fenceUntrustedJson } from "../untrusted.js";
import type { AgentHarness } from "./types.js";

/** Legacy `Claude` objects wrapped by `claudeCompat()`, so their own ask/evaluate still win. */
const LEGACY = new WeakMap<AgentHarness, Claude>();

/** @internal Registers the legacy object behind a compat harness. */
export function registerLegacyClaude(harness: AgentHarness, claude: Claude): void {
  LEGACY.set(harness, claude);
}

/** @internal The legacy `Claude` behind a compat harness, if any. */
export function legacyClaudeOf(harness: AgentHarness): Claude | undefined {
  return LEGACY.get(harness);
}

/** The `ask` prompt: the instruction, then the fenced context when there is any. */
export function buildAskPrompt(instruction: string, context: Record<string, unknown>): string {
  return [instruction, Object.keys(context).length > 0 ? `\nContext:\n${fenceUntrustedJson(context, "context")}` : ""]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the prompt used by `evaluate()` to pick a routing edge.
 *
 * Extracted as a pure function so the prompt body can be unit tested without
 * spinning up an SDK query. The body is part of the routing contract: workflow
 * authors and downstream maintainers rely on the model leaning on structured
 * fields rather than prose narrative when picking an edge, especially in the
 * fallback case where a source node did not declare an `output` schema (the
 * executor's schema-strict filter only kicks in when a schema is present;
 * see `buildRouteEvalEntry` in executor.ts).
 *
 * Any change to this prompt should keep:
 *   - The three "Evaluation rules" pointing the model at structured fields
 *     and away from prose narrative.
 *   - A terminal directive to return ONLY the choice ID.
 */
export function buildEvaluatePrompt(
  question: string,
  context: Record<string, unknown>,
  choices: { id: string; description: string }[],
): string {
  const choiceList = choices.map((c) => `- "${c.id}": ${c.description}`).join("\n");
  return [
    question,
    `\nContext:\n${fenceUntrustedJson(context, "context")}`,
    `\nChoices:\n${choiceList}`,
    `\nEvaluation rules:`,
    `1. Read each choice's condition literally and match against the structured fields in the context (e.g. status, counts, enum values, boolean flags).`,
    `2. Ignore prose narrative fields ("summary", free-form rationale, conversational commentary). They are not the contract.`,
    `3. When a field's value contradicts what a prose field claims, trust the field's value.`,
    `4. A field whose value is explicitly null means the source node DECLARED that field but did NOT emit a value. Treat null as "unknown" and do NOT match it against any specific value (do not match "is 0", "is N", "is true", "is false", or "is undefined" against a null field). Prefer a default/fallback edge when the field needed for a decision is null.`,
    `\nRespond with ONLY the choice ID, nothing else.`,
  ].join("\n");
}

/**
 * Single-completion free-text query (retry reflection, judge scoring).
 * A failed completion is the empty string, same as before the seam.
 */
export async function ask(
  harness: AgentHarness,
  opts: {
    instruction: string;
    context: Record<string, unknown>;
    model?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const legacy = legacyClaudeOf(harness);
  if (legacy) return legacy.ask(opts);
  const { instruction, context, model, timeoutMs, signal } = opts;
  const response = await harness.complete({
    prompt: buildAskPrompt(instruction, context),
    model,
    timeoutMs,
    signal,
    purpose: "ask",
  });
  return (response ?? "").trim();
}

/**
 * Route evaluation: pick one of N choices. Fails closed: null when the
 * completion failed or the answer names no valid choice.
 */
export async function evaluate(
  harness: AgentHarness,
  opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
    timeoutMs?: number;
    signal?: AbortSignal;
  },
  logger?: Logger,
): Promise<string | null> {
  const legacy = legacyClaudeOf(harness);
  if (legacy) return legacy.evaluate(opts);
  const log = logger ?? harness.logger ?? consoleLogger;
  const { question, context, choices, timeoutMs, signal } = opts;
  const response = await harness.complete({
    prompt: buildEvaluatePrompt(question, context, choices),
    timeoutMs,
    signal,
    purpose: "evaluate",
  });

  // The adapter already logged why; fail closed with no decision.
  if (response === null) return null;

  const text = response.trim().replace(/^["']|["']$/g, "");
  const validIds = choices.map((c) => c.id);

  // Exact match
  if (validIds.includes(text)) return text;

  // Fuzzy: look for an ID embedded in the response
  const match = validIds.find((id) => text.includes(id));
  if (match) return match;

  // Fail closed. An unparseable answer is not a decision. Returning
  // validIds[0] here is the fail-open bug: on a node with a single
  // conditional out-edge, the "first choice" is always that edge, so a
  // garbled model answer would always take it. Signal no-decision instead.
  log.warn(`Could not parse route choice from: "${text.slice(0, 100)}". Failing closed (no route decision).`);
  return null;
}
