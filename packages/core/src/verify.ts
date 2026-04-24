// ─── Verify: path resolver + check evaluators ───────────────────────
//
// Evaluates `node.verify` post-conditions after the LLM finishes.
// All checks are AND-ed; failures are aggregated into one error string.

import type { NodeResult, NodeVerify, OutputMatch, ToolCall } from "./types.js";

export type Resolution = { ok: true; mode: "all" | "any"; values: unknown[] } | { ok: false; reason: string };

interface Segment {
  name: string;
  wildcard: boolean;
}

const SEGMENT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(\[\*\])?$/;
const PREFIX_RE = /^([a-z]+):/;

function parsePath(path: string): { mode: "all" | "any"; segments: Segment[] } | string {
  if (path.length === 0) return "empty path";

  let mode: "all" | "any" = "all";
  let body = path;
  const prefixMatch = PREFIX_RE.exec(path);
  if (prefixMatch) {
    const prefix = prefixMatch[1]!;
    if (prefix !== "all" && prefix !== "any") {
      return `unknown prefix '${prefix}' (expected 'all' or 'any')`;
    }
    mode = prefix;
    body = path.slice(prefixMatch[0].length);
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

// Legacy output-shape heuristic: a tool call "succeeded" when its output
// does not carry a non-null `error` field. Kept as a fallback for ToolCall
// records that predate the explicit `status` field (hand-constructed in
// tests, older runtimes). The Claude runtime now sets `status` directly.
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

// Tool aliases: first-party SWEny skill tool names ↔ their MCP-server equivalents.
//
// When an external MCP server is wired for the same provider a skill covers
// (e.g. the Linear HTTP MCP server alongside the `linear` skill), both sets of
// tools are presented to the agent and the agent may pick either. The calls
// are functionally equivalent — same backend, same effect — but the names
// differ, so a verify rule that lists one will fail when the agent picked the
// other. These aliases let either call satisfy the rule.
//
// Only unambiguous MCP tool names are aliased. Names that collide across
// providers (e.g. `get_issue` exists on both Linear and GitHub MCP servers)
// are deliberately omitted so a call to one provider cannot spuriously
// satisfy a rule about the other.
const TOOL_ALIAS_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  // Linear (official remote MCP at mcp.linear.app — upsert naming)
  ["linear_search_issues", "list_issues"],
  ["linear_create_issue", "save_issue"],
  ["linear_update_issue", "save_issue"],
  ["linear_add_comment", "save_comment"],
  ["linear_list_teams", "list_teams"],
  // GitHub (github.com/github/github-mcp-server)
  ["github_create_issue", "create_issue"],
  ["github_search_issues", "search_issues"],
  ["github_add_comment", "add_issue_comment"],
  ["github_create_pr", "create_pull_request"],
];

const TOOL_ALIASES: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of TOOL_ALIAS_GROUPS) {
    for (const name of group) {
      let set = map.get(name);
      if (!set) {
        set = new Set<string>();
        map.set(name, set);
      }
      for (const other of group) set.add(other);
    }
  }
  return map;
})();

function expandAliases(name: string): ReadonlySet<string> {
  return TOOL_ALIASES.get(name) ?? new Set([name]);
}

function anyAliasIn(name: string, set: Set<string>): boolean {
  for (const alias of expandAliases(name)) {
    if (set.has(alias)) return true;
  }
  return false;
}

export function checkAnyToolCalled(required: string[], toolCalls: ToolCall[]): string | null {
  const succeeded = succeededTools(toolCalls);
  if (required.some((t) => anyAliasIn(t, succeeded))) return null;
  return `any_tool_called: required one of [${required.join(", ")}] to succeed, called: [${calledList(toolCalls)}]`;
}

export function checkAllToolsCalled(required: string[], toolCalls: ToolCall[]): string | null {
  const succeeded = succeededTools(toolCalls);
  const missing = required.filter((t) => !anyAliasIn(t, succeeded));
  if (missing.length === 0) return null;
  return `all_tools_called: missing successful calls to [${missing.join(", ")}], called: [${calledList(toolCalls)}]`;
}

export function checkNoToolCalled(forbidden: string[], toolCalls: ToolCall[]): string | null {
  const calledNames = new Set(toolCalls.map((c) => c.tool));
  const violated = forbidden.filter((t) => anyAliasIn(t, calledNames));
  if (violated.length === 0) return null;
  return `no_tool_called: forbidden tools were invoked: [${violated.join(", ")}], called: [${calledList(toolCalls)}]`;
}

// Structural deep equality for JSON-shaped values. Handles object key-order
// (compares by key set, not insertion order), NaN (NaN === NaN here), arrays
// (element-wise), and treats `undefined` distinctly from missing keys. Does
// not handle Date/Map/Set/RegExp — verify only ever sees agent-produced JSON.
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

interface CompiledMatch {
  match: OutputMatch;
  regex?: RegExp;
}

/**
 * Cap on `verify.output_matches[].matches` source length.
 *
 * `matches` is user-supplied through workflow YAML, including marketplace
 * workflows. A pathological pattern like `(a+)+$` causes exponential
 * backtracking in V8's regex engine. Capping the source length is a cheap,
 * useful defense — well-formed verify regexes are tens of characters at
 * most. Patterns longer than this are almost always either generated junk
 * or a deliberate ReDoS attempt; either way, refusing to compile is safer
 * than executing them.
 *
 * Caveat: length alone does NOT prevent all ReDoS — a 12-char pattern like
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
    // verify failure rather than a crash because the executor catches.
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

function describeOperator(c: CompiledMatch): string {
  const m = c.match;
  if (m.equals !== undefined) return `equals ${formatValue(m.equals)}`;
  if (m.in !== undefined) return `in [${m.in.map(formatValue).join(", ")}]`;
  if (m.matches !== undefined) return `matches /${m.matches}/`;
  return "no operator";
}

/**
 * Evaluate every declared check and return a concatenated error string,
 * or null when the node passes verification (or has no verify block).
 *
 * Deterministic and side-effect free — the executor calls this synchronously
 * after the LLM finishes.
 */
export function evaluateVerify(verify: NodeVerify | undefined, result: NodeResult): string | null {
  if (!verify) return null;

  const failures: string[] = [];

  if (verify.any_tool_called && verify.any_tool_called.length > 0) {
    const e = checkAnyToolCalled(verify.any_tool_called, result.toolCalls);
    if (e) failures.push(e);
  }
  if (verify.all_tools_called && verify.all_tools_called.length > 0) {
    const e = checkAllToolsCalled(verify.all_tools_called, result.toolCalls);
    if (e) failures.push(e);
  }
  if (verify.no_tool_called && verify.no_tool_called.length > 0) {
    const e = checkNoToolCalled(verify.no_tool_called, result.toolCalls);
    if (e) failures.push(e);
  }
  if (verify.output_required && verify.output_required.length > 0) {
    const e = checkOutputRequired(verify.output_required, result.data);
    if (e) failures.push(e);
  }
  if (verify.output_matches && verify.output_matches.length > 0) {
    const e = checkOutputMatches(verify.output_matches, result.data);
    if (e) failures.push(e);
  }

  if (failures.length === 0) return null;
  return `verify failed:\n  - ${failures.join("\n  - ")}`;
}
