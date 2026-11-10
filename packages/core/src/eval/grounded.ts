// ─── Eval: output_grounded (#580) ────────────────────────────────────
//
// A `function` rule that checks every id and URL a node outputs against what
// the agent actually saw: the outputs of its own successful tool calls, plus
// the context its prompt was given (workflow input and prior nodes). An id
// that appears in none of them was invented, and fails with its value and
// path. Pure and deterministic: no model call.
//
// Evidence lives in memory only. Tool outputs are never journaled (see
// NODE_RESULT_JOURNAL), so the verdict is computed once, while the run holds
// them, and the EvalResult is what the journal keeps. A node replayed on
// resume keeps its journaled verdict; a node that re-runs is re-evaluated
// against its new tool outputs.

import type { OutputGroundedRule, ToolCall } from "../types.js";
import { isErrorOutput, type ToolAliases } from "./function.js";

/** What a node's grounding is checked against. */
export interface GroundingEvidence {
  /** The evaluated attempt's tool calls, with outputs (in memory). */
  toolCalls: ToolCall[];
  /** The context the node's prompt received: `{ input, ...priorNodes }`. */
  context?: Record<string, unknown>;
  /** The evaluated node's id. Its own earlier visit (loops) is not evidence. */
  nodeId?: string;
  /** Tool-name aliases from the loaded skills, for `tools`. */
  aliases?: ToolAliases;
}

export const BUILTIN_PATTERNS = ["url", "github_ref", "issue_key"] as const;
type BuiltinPattern = (typeof BUILTIN_PATTERNS)[number];

/** Same cap as `output_matches[].matches` (see value.ts). */
const MAX_REGEX_SOURCE_LENGTH = 1000;
/** Walk depth cap for outputs and evidence. Deeper values are not read. */
const MAX_DEPTH = 64;
/** Offending values listed in the reasoning before "and N more". */
const MAX_LISTED = 8;

const URL_RE = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;
const GITHUB_REF_RE = /(?<![A-Za-z0-9_.\/-])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)(?![A-Za-z0-9_])/g;
const ISSUE_KEY_RE = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9]{1,9})-(\d+)(?![A-Za-z0-9_-])/g;
const GITHUB_URL_PATH_RE = /^\/([^/]+)\/([^/]+)\/(?:issues|pull|pulls)\/(\d+)$/;

// ─── URL normalization ───────────────────────────────────────────────

/**
 * Canonical form for comparing URLs: scheme and host lowercased (by URL), the
 * default port and the fragment dropped, a trailing slash on the path dropped.
 * Path and query stay as written (they are case-sensitive on most servers).
 * A string that does not parse as a URL is returned trimmed.
 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}${u.search}`;
}

function cleanUrl(match: string): string {
  return match.replace(TRAILING_PUNCT_RE, "");
}

/** Parent collection of a URL (`https://github.com/a/b/pull/3` -> `github.com/a/b/pull`). */
function urlCollection(normalized: string): string | undefined {
  try {
    const u = new URL(normalized);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return undefined;
    return `${u.host}/${parts.slice(0, -1).join("/")}`;
  } catch {
    return undefined;
  }
}

// ─── Candidates: ids and URLs the node output ────────────────────────

/** One id or URL found in the output. `cls` groups ids of one kind, for `stale`. */
interface Candidate {
  path: string;
  value: string;
  type: "url" | "github_ref" | "token";
  cls?: string;
}

type Matcher = { name: string; re: RegExp };

function compilePatterns(patterns: string[] | undefined): { builtins: Set<BuiltinPattern>; custom: Matcher[] } {
  const builtins = new Set<BuiltinPattern>();
  const custom: Matcher[] = [];
  for (const p of patterns ?? BUILTIN_PATTERNS) {
    if ((BUILTIN_PATTERNS as readonly string[]).includes(p)) {
      builtins.add(p as BuiltinPattern);
      continue;
    }
    if (p.length > MAX_REGEX_SOURCE_LENGTH) {
      throw new Error(`invalid pattern: regex source exceeds ${MAX_REGEX_SOURCE_LENGTH} characters`);
    }
    try {
      custom.push({ name: p, re: new RegExp(p, "g") });
    } catch (e) {
      throw new Error(`invalid pattern /${p}/: ${(e as Error).message}`);
    }
  }
  return { builtins, custom };
}

function githubRefKey(owner: string, repo: string, n: string): string {
  return `${owner}/${repo}#${n}`.toLowerCase();
}

/**
 * Find ids and URLs in one string. URLs are taken first and masked, so an id
 * embedded in a URL is checked once, as the URL.
 */
function extract(
  text: string,
  path: string,
  compiled: { builtins: Set<BuiltinPattern>; custom: Matcher[] },
  out: Candidate[],
): void {
  let rest = text;
  // URLs are always masked so the other patterns do not match inside them;
  // they are only reported when the url pattern is on.
  rest = rest.replace(URL_RE, (m) => {
    if (compiled.builtins.has("url")) {
      const value = cleanUrl(m);
      const norm = normalizeUrl(value);
      out.push({ path, value, type: "url", cls: urlCollection(norm) });
    }
    return " ".repeat(m.length);
  });
  if (compiled.builtins.has("github_ref")) {
    rest = rest.replace(GITHUB_REF_RE, (m, o: string, r: string) => {
      out.push({ path, value: m, type: "github_ref", cls: `gh:${o}/${r}`.toLowerCase() });
      return " ".repeat(m.length);
    });
  }
  if (compiled.builtins.has("issue_key")) {
    for (const m of rest.matchAll(ISSUE_KEY_RE)) {
      out.push({ path, value: m[0], type: "token", cls: `key:${m[1]}` });
    }
  }
  for (const c of compiled.custom) {
    c.re.lastIndex = 0;
    for (const m of rest.matchAll(c.re)) {
      const value = m[1] ?? m[0];
      if (value.length === 0) continue;
      out.push({ path, value, type: "token", cls: `re:${c.name}` });
    }
  }
}

/** A whole value at an `ids` path. Classified so `stale` can use it when it has a recognizable kind. */
function wholeValue(value: string, path: string): Candidate {
  if (/^https?:\/\//.test(value)) {
    return { path, value, type: "url", cls: urlCollection(normalizeUrl(value)) };
  }
  const gh = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(value);
  if (gh) return { path, value, type: "github_ref", cls: `gh:${gh[1]}/${gh[2]}`.toLowerCase() };
  const key = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(value);
  return { path, value, type: "token", ...(key ? { cls: `key:${key[1]}` } : {}) };
}

// ─── Paths ───────────────────────────────────────────────────────────

const SEGMENT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(\[\*\])?$/;
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  if (IDENT_RE.test(key)) return parent ? `${parent}.${key}` : key;
  return `${parent}[${JSON.stringify(key)}]`;
}

/**
 * Resolve an eval path (see path.ts for the grammar) to concrete
 * `{ path, value }` pairs, so a failure names `items[3].url`, not `items[*].url`.
 * A path that does not resolve has nothing to check. A malformed path throws.
 */
function resolveConcrete(data: unknown, path: string): Array<{ path: string; value: unknown }> {
  const body = path.replace(/^(all|any):/, "");
  const segments = body.split(".").map((part) => {
    const m = SEGMENT_RE.exec(part);
    if (!m) throw new Error(`malformed path '${path}' (segment '${part}')`);
    return { name: m[1]!, wildcard: m[2] === "[*]" };
  });
  let current: Array<{ path: string; value: unknown }> = [{ path: "", value: data }];
  for (const seg of segments) {
    const next: Array<{ path: string; value: unknown }> = [];
    for (const c of current) {
      if (!c.value || typeof c.value !== "object" || Array.isArray(c.value)) continue;
      const obj = c.value as Record<string, unknown>;
      if (!(seg.name in obj)) continue;
      const p = childPath(c.path, seg.name);
      const child = obj[seg.name];
      if (seg.wildcard) {
        if (!Array.isArray(child)) continue;
        child.forEach((el, i) => next.push({ path: childPath(p, i), value: el }));
      } else {
        next.push({ path: p, value: child });
      }
    }
    current = next;
  }
  return current;
}

/** Every string (and, with numbers, number) leaf under a value, with its concrete path. */
function leaves(
  value: unknown,
  path: string,
  numbers: boolean,
  visit: (path: string, text: string) => void,
  depth = 0,
  seen = new WeakSet<object>(),
): void {
  if (typeof value === "string") return visit(path, value);
  if (numbers && typeof value === "number" && Number.isFinite(value)) return visit(path, String(value));
  if (!value || typeof value !== "object" || depth >= MAX_DEPTH || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((el, i) => leaves(el, childPath(path, i), numbers, visit, depth + 1, seen));
    return;
  }
  for (const [k, v] of Object.entries(value)) leaves(v, childPath(path, k), numbers, visit, depth + 1, seen);
}

// ─── Evidence ────────────────────────────────────────────────────────

/** One body of evidence, indexed for lookup. Built in memory, never stored. */
class Corpus {
  private text = "";
  private parts: string[] = [];
  readonly urls = new Set<string>();
  readonly githubRefs = new Set<string>();

  add(value: unknown): void {
    leaves(value, "", true, (_p, s) => this.addText(s));
    // Object keys can carry ids too (`{ "ENG-1": {...} }`).
    this.addKeys(value, 0, new WeakSet());
  }

  private addKeys(value: unknown, depth: number, seen: WeakSet<object>): void {
    if (!value || typeof value !== "object" || depth >= MAX_DEPTH || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const el of value) this.addKeys(el, depth + 1, seen);
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      this.addText(k);
      this.addKeys(v, depth + 1, seen);
    }
  }

  private addText(s: string): void {
    if (s.length === 0) return;
    this.parts.push(s);
    for (const m of s.matchAll(URL_RE)) {
      const norm = normalizeUrl(cleanUrl(m[0]));
      this.urls.add(norm);
      try {
        const gh = GITHUB_URL_PATH_RE.exec(new URL(norm).pathname);
        if (gh) this.githubRefs.add(githubRefKey(gh[1]!, gh[2]!, gh[3]!));
      } catch {
        // not a parseable URL: kept as text only
      }
    }
    for (const m of s.matchAll(GITHUB_REF_RE)) this.githubRefs.add(githubRefKey(m[1]!, m[2]!, m[3]!));
  }

  /** All text, joined once on first lookup. */
  private joined(): string {
    if (this.parts.length > 0) {
      this.text += (this.text ? "\n" : "") + this.parts.join("\n");
      this.parts = [];
    }
    return this.text;
  }

  has(c: Candidate): boolean {
    if (c.type === "url") return this.urls.has(normalizeUrl(c.value));
    if (c.type === "github_ref") {
      const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(c.value);
      if (m && this.githubRefs.has(githubRefKey(m[1]!, m[2]!, m[3]!))) return true;
    }
    return containsToken(this.joined(), c.value);
  }

  /** Every id of a class this corpus holds, using the same extraction as the output. */
  classes(compiled: { builtins: Set<BuiltinPattern>; custom: Matcher[] }): Set<string> {
    const found: Candidate[] = [];
    const text = this.joined();
    if (text) extract(text, "", compiled, found);
    for (const u of this.urls) {
      const cls = urlCollection(u);
      if (cls) found.push({ path: "", value: u, type: "url", cls });
    }
    return new Set(found.map((f) => f.cls).filter((c): c is string => c !== undefined));
  }
}

/** `needle` occurs in `hay` as a whole token: no letter, digit, `_` or `-` on either side. */
function containsToken(hay: string, needle: string): boolean {
  if (!needle) return false;
  const edge = /[A-Za-z0-9_-]/;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const before = i > 0 ? hay[i - 1]! : "";
    const after = hay[i + needle.length] ?? "";
    const startsWord = edge.test(needle[0]!);
    const endsWord = edge.test(needle[needle.length - 1]!);
    if ((!startsWord || !edge.test(before)) && (!endsWord || !edge.test(after))) return true;
  }
  return false;
}

function didSucceed(c: ToolCall): boolean {
  if (c.status === "error") return false;
  if (c.status === "success") return true;
  return !isErrorOutput(c.output);
}

function toolAllowed(tool: string, names: string[] | undefined, aliases?: ToolAliases): boolean {
  if (!names) return true;
  return names.some((n) => (aliases?.get(n) ?? new Set([n])).has(tool));
}

// ─── Entry point ─────────────────────────────────────────────────────

function quote(v: string): string {
  return JSON.stringify(v.length > 120 ? v.slice(0, 119) + "…" : v);
}

/**
 * Evaluate an `output_grounded` rule against the node's output and evidence.
 * Never throws: a bad config (malformed path, invalid pattern) is a failure
 * with a reason, not a silent pass.
 */
export function evaluateGroundedRule(
  rule: OutputGroundedRule,
  data: unknown,
  evidence: GroundingEvidence,
): { pass: boolean; reasoning?: string } {
  try {
    return evaluate(rule, data, evidence);
  } catch (e) {
    return { pass: false, reasoning: `output_grounded: ${(e as Error).message}` };
  }
}

function evaluate(
  rule: OutputGroundedRule,
  data: unknown,
  evidence: GroundingEvidence,
): { pass: boolean; reasoning?: string } {
  const compiled = compilePatterns(rule.patterns);

  // 1. Candidates in the output.
  const candidates: Candidate[] = [];
  const scanRoots = rule.paths ? rule.paths.flatMap((p) => resolveConcrete(data, p)) : [{ path: "", value: data }];
  for (const root of scanRoots) {
    leaves(root.value, root.path, false, (path, text) => extract(text, path, compiled, candidates));
  }
  for (const p of rule.ids ?? []) {
    for (const root of resolveConcrete(data, p)) {
      leaves(root.value, root.path, true, (path, text) => {
        const v = text.trim();
        if (v) candidates.push(wholeValue(v, path));
      });
    }
  }
  if (candidates.length === 0) return { pass: true };

  // 2. Evidence: tool outputs, and (by default) the input and prior context.
  const tools = new Corpus();
  for (const c of evidence.toolCalls) {
    if (didSucceed(c) && toolAllowed(c.tool, rule.tools, evidence.aliases)) tools.add(c.output);
  }
  const given = new Corpus();
  const useInputs = rule.inputs ?? true;
  const useContext = rule.context ?? true;
  for (const [k, v] of Object.entries(evidence.context ?? {})) {
    if (k === evidence.nodeId) continue;
    if (k === "input" ? useInputs : useContext) given.add(v);
  }
  const allow = new Set((rule.allow ?? []).flatMap((a) => [a, normalizeUrl(a)]));

  // 3. Check each candidate once per path.
  const toolClasses = rule.stale ? tools.classes(compiled) : new Set<string>();
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.path}\u0000${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (allow.has(c.value) || (c.type === "url" && allow.has(normalizeUrl(c.value)))) continue;
    if (tools.has(c)) continue;
    const label = `${c.path || "(output)"} ${quote(c.value)}`;
    if (given.has(c)) {
      if (rule.stale && c.cls && toolClasses.has(c.cls)) {
        failures.push(
          `${label} (stale: only in ${givenLabel(useInputs, useContext)}; this node's tools returned others of its kind, not this one)`,
        );
      }
      continue;
    }
    failures.push(label);
  }
  if (failures.length === 0) return { pass: true };

  const sources = ["tool outputs", ...(useInputs ? ["inputs"] : []), ...(useContext ? ["prior context"] : [])];
  const where = sources.length === 1 ? sources[0] : `${sources.slice(0, -1).join(", ")} or ${sources.at(-1)}`;
  const listed = failures.slice(0, MAX_LISTED).join("; ");
  const more = failures.length > MAX_LISTED ? `; and ${failures.length - MAX_LISTED} more` : "";
  return {
    pass: false,
    reasoning: `output_grounded: ${failures.length} value(s) not grounded in ${where}: ${listed}${more}`,
  };
}

function givenLabel(inputs: boolean, context: boolean): string {
  if (inputs && context) return "inputs or prior context";
  return inputs ? "inputs" : "prior context";
}
