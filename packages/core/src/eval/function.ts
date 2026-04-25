// ─── Eval: function (trace-shape) evaluator ──────────────────────────
//
// Operates on the node's tool-call trace. Accepts an alias map so a workflow
// rule can reference a canonical tool name and match against an equivalent
// MCP tool name. Each skill owns its own alias map; core stays vendor-neutral.

import type { EvaluatorRule, ToolCall } from "../types.js";

// ─── Tool-call success heuristic ─────────────────────────────────────

/**
 * Legacy output-shape heuristic: a tool call "succeeded" when its output
 * does not carry a non-null `error` field. Kept as a fallback for ToolCall
 * records that predate the explicit `status` field (hand-constructed in
 * tests, older runtimes). The Claude runtime now sets `status` directly.
 */
export function isErrorOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const err = (output as Record<string, unknown>).error;
  return err !== undefined && err !== null && err !== false;
}

/**
 * A tool call is considered successful when:
 *   - explicit `status === "success"`, OR
 *   - no explicit status AND output does not look like an error.
 *
 * `status` is authoritative. It's the only signal we have for external MCP
 * tools whose structured output isn't exposed to the workflow runtime.
 */
function didSucceed(c: ToolCall): boolean {
  if (c.status === "error") return false;
  if (c.status === "success") return true;
  return !isErrorOutput(c.output);
}

function succeededTools(toolCalls: ToolCall[]): Set<string> {
  const names = new Set<string>();
  for (const c of toolCalls) {
    if (didSucceed(c)) names.add(c.tool);
  }
  return names;
}

function calledList(toolCalls: ToolCall[]): string {
  return toolCalls.map((c) => c.tool).join(", ") || "none";
}

// ─── Alias expansion ─────────────────────────────────────────────────
//
// Tool aliases are supplied by the caller (the executor builds them from the
// loaded skills via `buildToolAliases`). Core knows nothing about Linear,
// GitHub, or any other vendor; each skill owns its own MCP name mapping.
// When no alias map is provided, checks fall back to strict name equality.

export type ToolAliases = ReadonlyMap<string, ReadonlySet<string>>;

function expandAliases(name: string, aliases?: ToolAliases): ReadonlySet<string> {
  return aliases?.get(name) ?? new Set([name]);
}

function anyAliasIn(name: string, set: Set<string>, aliases?: ToolAliases): boolean {
  for (const alias of expandAliases(name, aliases)) {
    if (set.has(alias)) return true;
  }
  return false;
}

// ─── Public check helpers ────────────────────────────────────────────

export function checkAnyToolCalled(required: string[], toolCalls: ToolCall[], aliases?: ToolAliases): string | null {
  const succeeded = succeededTools(toolCalls);
  if (required.some((t) => anyAliasIn(t, succeeded, aliases))) return null;
  return `any_tool_called: required one of [${required.join(", ")}] to succeed, called: [${calledList(toolCalls)}]`;
}

export function checkAllToolsCalled(required: string[], toolCalls: ToolCall[], aliases?: ToolAliases): string | null {
  const succeeded = succeededTools(toolCalls);
  const missing = required.filter((t) => !anyAliasIn(t, succeeded, aliases));
  if (missing.length === 0) return null;
  return `all_tools_called: missing successful calls to [${missing.join(", ")}], called: [${calledList(toolCalls)}]`;
}

export function checkNoToolCalled(forbidden: string[], toolCalls: ToolCall[], aliases?: ToolAliases): string | null {
  const calledNames = new Set(toolCalls.map((c) => c.tool));
  const violated = forbidden.filter((t) => anyAliasIn(t, calledNames, aliases));
  if (violated.length === 0) return null;
  return `no_tool_called: forbidden tools were invoked: [${violated.join(", ")}], called: [${calledList(toolCalls)}]`;
}

// ─── Evaluator entry point ───────────────────────────────────────────

/**
 * Evaluate a `function` rule against the node's tool-call trace.
 *
 * Returns `{ pass: true }` when every declared check passes, otherwise
 * `{ pass: false, reasoning: <semicolon-joined failure list> }`.
 *
 * Value-rule fields (`output_required` / `output_matches`) are ignored
 * even if present.
 */
export function evaluateFunctionRule(
  rule: EvaluatorRule,
  toolCalls: ToolCall[],
  aliases?: ToolAliases,
): { pass: boolean; reasoning?: string } {
  const failures: string[] = [];

  if (rule.any_tool_called && rule.any_tool_called.length > 0) {
    const e = checkAnyToolCalled(rule.any_tool_called, toolCalls, aliases);
    if (e) failures.push(e);
  }
  if (rule.all_tools_called && rule.all_tools_called.length > 0) {
    const e = checkAllToolsCalled(rule.all_tools_called, toolCalls, aliases);
    if (e) failures.push(e);
  }
  if (rule.no_tool_called && rule.no_tool_called.length > 0) {
    const e = checkNoToolCalled(rule.no_tool_called, toolCalls, aliases);
    if (e) failures.push(e);
  }

  if (failures.length === 0) return { pass: true };
  return { pass: false, reasoning: failures.join("; ") };
}
