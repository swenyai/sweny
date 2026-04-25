// ─── Eval: value (data-shape) evaluator ──────────────────────────────
//
// Operates on `result.data`. Combines `output_required` and `output_matches`
// checks. Pure, deterministic, fast.

import type { EvaluatorRule, OutputMatch } from "../types.js";
import { resolvePath } from "./path.js";

// ─── Internals ───────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

interface CompiledMatch {
  match: OutputMatch;
  regex?: RegExp;
}

/**
 * Cap on `output_matches[].matches` source length.
 *
 * `matches` is user-supplied through workflow YAML, including marketplace
 * workflows. A pathological pattern like `(a+)+$` causes exponential
 * backtracking in V8's regex engine. Capping the source length is a cheap,
 * useful defense; well-formed regexes are tens of characters at most.
 *
 * Caveat: length alone does NOT prevent all ReDoS. A 12-char pattern like
 * `(a+)+$` is still catastrophic against the right input. Future work:
 * gate compilation through `safe-regex` or use the `re2` engine for
 * marketplace inputs. The cap closes the obvious abuse surface without
 * adding a runtime dep right now.
 */
const MAX_REGEX_SOURCE_LENGTH = 1000;

function compileMatch(m: OutputMatch): CompiledMatch {
  if (m.matches !== undefined) {
    if (m.matches.length > MAX_REGEX_SOURCE_LENGTH) {
      throw new Error(
        `regex source exceeds ${MAX_REGEX_SOURCE_LENGTH} characters (got ${m.matches.length}); ` +
          `tighten the pattern to avoid catastrophic-backtracking risk`,
      );
    }
    // Throws synchronously if the regex source is invalid; surfaced as a
    // value-evaluator failure rather than a crash because the executor catches.
    return { match: m, regex: new RegExp(m.matches) };
  }
  return { match: m };
}

function applyOperator(c: CompiledMatch, value: unknown): { ok: true } | { ok: false; reason: string } {
  const m = c.match;
  if (m.equals !== undefined) {
    if (deepEqual(value, m.equals)) return { ok: true };
    return { ok: false, reason: `equals ${formatValue(m.equals)}, got ${formatValue(value)}` };
  }
  if (m.in !== undefined) {
    if (m.in.some((x) => deepEqual(value, x))) return { ok: true };
    return {
      ok: false,
      reason: `in [${m.in.map(formatValue).join(", ")}], got ${formatValue(value)}`,
    };
  }
  if (c.regex) {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    if (c.regex.test(s)) return { ok: true };
    return { ok: false, reason: `matches /${m.matches}/, got ${formatValue(value)}` };
  }
  return { ok: false, reason: "no operator declared (zod should have caught this)" };
}

function describeOperator(c: CompiledMatch): string {
  const m = c.match;
  if (m.equals !== undefined) return `equals ${formatValue(m.equals)}`;
  if (m.in !== undefined) return `in [${m.in.map(formatValue).join(", ")}]`;
  if (m.matches !== undefined) return `matches /${m.matches}/`;
  return "no operator";
}

// ─── Public check helpers ────────────────────────────────────────────

export function checkOutputRequired(paths: string[], data: unknown): string | null {
  const failures: string[] = [];
  for (const path of paths) {
    const r = resolvePath(data, path);
    if (!r.ok) {
      failures.push(`'${path}' ${r.reason}`);
      continue;
    }
    if (r.mode === "all") {
      if (r.values.length > 0 && !r.values.every((v) => v !== null && v !== undefined)) {
        failures.push(`'${path}' resolved to null/undefined value(s)`);
      }
    } else {
      if (r.values.length === 0) {
        failures.push(`'${path}' (any:) resolved to no elements`);
      } else if (!r.values.some((v) => v !== null && v !== undefined)) {
        failures.push(`'${path}' (any:) all resolved values are null/undefined`);
      }
    }
  }
  if (failures.length === 0) return null;
  return `output_required: ${failures.join("; ")}`;
}

export function checkOutputMatches(matches: OutputMatch[], data: unknown): string | null {
  const failures: string[] = [];
  for (const m of matches) {
    let compiled: CompiledMatch;
    try {
      compiled = compileMatch(m);
    } catch (err) {
      failures.push(`'${m.path}' invalid regex /${m.matches}/: ${(err as Error).message}`);
      continue;
    }

    const r = resolvePath(data, m.path);
    if (!r.ok) {
      failures.push(`'${m.path}' ${r.reason}`);
      continue;
    }
    if (r.mode === "all") {
      if (r.values.length === 0) continue;
      const offenders: string[] = [];
      for (const v of r.values) {
        const res = applyOperator(compiled, v);
        if (!res.ok) offenders.push(formatValue(v));
      }
      if (offenders.length > 0) {
        const opDescription = describeOperator(compiled);
        failures.push(`'${m.path}' ${opDescription}, got [${offenders.join(", ")}]`);
      }
    } else {
      if (r.values.length === 0) {
        failures.push(`'${m.path}' (any:) resolved to no elements`);
        continue;
      }
      const anyOk = r.values.some((v) => applyOperator(compiled, v).ok);
      if (!anyOk) {
        const opDescription = describeOperator(compiled);
        failures.push(`'${m.path}' (any:) no element satisfies ${opDescription}`);
      }
    }
  }
  if (failures.length === 0) return null;
  return `output_matches: ${failures.join("; ")}`;
}

// ─── Evaluator entry point ───────────────────────────────────────────

/**
 * Evaluate a `value` rule against the node's `result.data`.
 *
 * Returns `{ pass: true }` when every declared check passes, otherwise
 * `{ pass: false, reasoning: <semicolon-joined failure list> }`.
 *
 * Function-rule fields (`*_tool_called`) are ignored even if present.
 */
export function evaluateValueRule(rule: EvaluatorRule, data: unknown): { pass: boolean; reasoning?: string } {
  const failures: string[] = [];

  if (rule.output_required && rule.output_required.length > 0) {
    const e = checkOutputRequired(rule.output_required, data);
    if (e) failures.push(e);
  }
  if (rule.output_matches && rule.output_matches.length > 0) {
    const e = checkOutputMatches(rule.output_matches, data);
    if (e) failures.push(e);
  }

  if (failures.length === 0) return { pass: true };
  return { pass: false, reasoning: failures.join("; ") };
}
