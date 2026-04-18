// ─── Verify: path resolver + check evaluators ───────────────────────
//
// Evaluates `node.verify` post-conditions after the LLM finishes.
// All checks are AND-ed; failures are aggregated into one error string.

import type { OutputMatch, ToolCall } from "./types.js";

export type Resolution = { ok: true; mode: "all" | "any"; values: unknown[] } | { ok: false; reason: string };

interface Segment {
  name: string;
  wildcard: boolean;
}

const SEGMENT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(\[\*\])?$/;

function parsePath(path: string): { mode: "all" | "any"; segments: Segment[] } | string {
  if (path.length === 0) return "empty path";

  let mode: "all" | "any" = "all";
  let body = path;
  const colon = path.indexOf(":");
  if (colon !== -1 && /^[a-z]+$/.test(path.slice(0, colon))) {
    const prefix = path.slice(0, colon);
    if (prefix === "all" || prefix === "any") {
      mode = prefix;
      body = path.slice(colon + 1);
    } else {
      return `unknown prefix '${prefix}' (expected 'all' or 'any')`;
    }
    if (body.length === 0) return "empty path after prefix";
  }

  const parts = body.split(".");
  const segments: Segment[] = [];
  for (const part of parts) {
    const m = SEGMENT_RE.exec(part);
    if (!m) return `malformed segment '${part}'`;
    segments.push({ name: m[1]!, wildcard: m[2] === "[*]" });
  }
  return { mode, segments };
}

export function resolvePath(data: unknown, path: string): Resolution {
  const parsed = parsePath(path);
  if (typeof parsed === "string") return { ok: false, reason: parsed };

  let current: unknown[] = [data];

  for (const seg of parsed.segments) {
    const next: unknown[] = [];
    for (const v of current) {
      if (v === null) return { ok: false, reason: `null encountered before segment '${seg.name}'` };
      if (typeof v !== "object") {
        return { ok: false, reason: `expected object before segment '${seg.name}', got ${typeof v}` };
      }
      const obj = v as Record<string, unknown>;
      if (!(seg.name in obj)) {
        return { ok: false, reason: `missing segment '${seg.name}'` };
      }
      const child = obj[seg.name];
      if (seg.wildcard) {
        if (!Array.isArray(child)) {
          return {
            ok: false,
            reason: `expected array at '${seg.name}', got ${child === null ? "null" : typeof child}`,
          };
        }
        for (const el of child) next.push(el);
      } else {
        next.push(child);
      }
    }
    current = next;
    if (current.length === 0) {
      return { ok: true, mode: parsed.mode, values: [] };
    }
  }

  return { ok: true, mode: parsed.mode, values: current };
}

function isErrorOutput(output: unknown): boolean {
  return !!(output && typeof output === "object" && "error" in (output as Record<string, unknown>));
}

function succeededTools(toolCalls: ToolCall[]): Set<string> {
  const names = new Set<string>();
  for (const c of toolCalls) {
    if (!isErrorOutput(c.output)) names.add(c.tool);
  }
  return names;
}

export function checkAnyToolCalled(required: string[], toolCalls: ToolCall[]): string | null {
  const succeeded = succeededTools(toolCalls);
  if (required.some((t) => succeeded.has(t))) return null;
  const called = toolCalls.map((c) => c.tool).join(", ") || "none";
  return `any_tool_called: required one of [${required.join(", ")}] to succeed, called: [${called}]`;
}

export function checkAllToolsCalled(required: string[], toolCalls: ToolCall[]): string | null {
  const succeeded = succeededTools(toolCalls);
  const missing = required.filter((t) => !succeeded.has(t));
  if (missing.length === 0) return null;
  return `all_tools_called: missing successful calls to [${missing.join(", ")}]`;
}

export function checkNoToolCalled(forbidden: string[], toolCalls: ToolCall[]): string | null {
  const calledNames = new Set(toolCalls.map((c) => c.tool));
  const violated = forbidden.filter((t) => calledNames.has(t));
  if (violated.length === 0) return null;
  return `no_tool_called: forbidden tools were invoked: [${violated.join(", ")}]`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

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

function applyOperator(m: OutputMatch, value: unknown): { ok: true } | { ok: false; reason: string } {
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
  if (m.matches !== undefined) {
    const re = new RegExp(m.matches);
    const s = typeof value === "string" ? value : JSON.stringify(value);
    if (re.test(s)) return { ok: true };
    return { ok: false, reason: `matches /${m.matches}/, got ${formatValue(value)}` };
  }
  return { ok: false, reason: "no operator declared (zod should have caught this)" };
}

export function checkOutputMatches(matches: OutputMatch[], data: unknown): string | null {
  const failures: string[] = [];
  for (const m of matches) {
    const r = resolvePath(data, m.path);
    if (!r.ok) {
      failures.push(`'${m.path}' ${r.reason}`);
      continue;
    }
    if (r.mode === "all") {
      if (r.values.length === 0) continue;
      const firstFailure = r.values
        .map((v) => applyOperator(m, v))
        .find((res): res is { ok: false; reason: string } => !res.ok);
      if (firstFailure) failures.push(`'${m.path}' ${firstFailure.reason}`);
    } else {
      if (r.values.length === 0) {
        failures.push(`'${m.path}' (any:) resolved to no elements`);
        continue;
      }
      const anyOk = r.values.some((v) => applyOperator(m, v).ok);
      if (!anyOk) {
        failures.push(`'${m.path}' (any:) no element satisfied operator`);
      }
    }
  }
  if (failures.length === 0) return null;
  return `output_matches: ${failures.join("; ")}`;
}
