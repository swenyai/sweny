// ─── Eval: output_grounded (#580) ────────────────────────────────────
//
// A `function` rule with two checks, both pure and deterministic (no model call):
//
// - Ids: every URL, `owner/repo#N` ref and issue key a node outputs (or every
//   value at the configured `ids` paths) must appear in what the agent saw:
//   the outputs of its own successful tool calls, plus (by default) the
//   workflow input and the prior-node context its prompt was given.
// - Quotes: every value at a `quotes` path must appear verbatim, under an
//   explicit whitespace rule, in a named tool's output.
//
// Evidence lives in memory only. Tool outputs are never journaled (see
// NODE_RESULT_JOURNAL), so the verdict is computed once, while the run holds
// them, and the EvalResult is what the journal keeps. A node replayed on
// resume keeps its journaled verdict; a node that re-runs is re-checked
// against its new tool outputs.

import type { OutputGroundedQuote, OutputGroundedRule, ToolCall } from "../types.js";
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

/** Same cap as `output_matches[].matches` (see value.ts). */
export const MAX_REGEX_SOURCE_LENGTH = 1000;
/** Offending values listed per failure group before "and N more". */
export const MAX_LISTED = 8;

const URL_RE = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;
const GITHUB_REF_RE = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+)(?!\w)/g;
const ISSUE_KEY_RE = /(?<![\w-])([A-Z][A-Z0-9]{1,9})-\d+(?![\w-])/g;
/** Matched against a normalized URL: `//host/owner/repo/(issues|pull)/N` at the end. */
const GITHUB_URL_RE = /\/\/[^/]+\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)$/;
const WORD_CHAR = /[\w-]/;
const SEGMENT_RE = /^([A-Za-z_]\w*)(\[\*\])?$/;
const IDENT_RE = /^[A-Za-z_]\w*$/;

type Verdict = { pass: boolean; reasoning?: string };
type Located = { path: string; value: unknown };

// ─── URLs ────────────────────────────────────────────────────────────

/**
 * Canonical form for comparing URLs: scheme and host lowercased and the
 * default port dropped (by URL), the fragment and any trailing slash dropped.
 * Path and query stay as written. A string that is not a URL comes back trimmed.
 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return s;
  }
}

/** The URL minus its last path segment (`https://h/a/b/3` -> `https://h/a/b`); none for a bare origin. */
function urlCollection(normalized: string): string | undefined {
  const pathStart = normalized.indexOf("/", normalized.indexOf("//") + 2);
  return pathStart === -1 ? undefined : normalized.slice(0, normalized.lastIndexOf("/"));
}

// ─── Walking values ──────────────────────────────────────────────────

/** `a.b`, `a[0]`, `a["not an identifier"]`. */
function childPath(parent: string, key: string | number): string {
  if (!IDENT_RE.test(String(key))) return `${parent}[${JSON.stringify(key)}]`;
  return parent === "" ? `${key}` : `${parent}.${key}`;
}

/** Every string (and, with `numbers`, number) leaf under a value of the output, with its concrete path. */
function leaves(value: unknown, path: string, numbers: boolean): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path, text: value }];
  if (numbers && typeof value === "number") return [{ path, text: String(value) }];
  if (typeof value !== "object" || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, childPath(path, i), numbers));
  return Object.entries(value).flatMap(([k, v]) => leaves(v, childPath(path, k), numbers));
}

/**
 * Every string and number in a tool output or context value, plus object keys
 * when `keys` (never array indexes). Cycles are read once.
 */
function strings(value: unknown, keys: boolean, seen: WeakSet<object> = new WeakSet()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, keys, seen));
  return Object.entries(value).flatMap(([k, v]) => [...(keys ? [k] : []), ...strings(v, keys, seen)]);
}

/**
 * Resolve an eval path (grammar: spec nodes#path-grammar) to concrete
 * `{ path, value }` pairs, so a failure names `items[3].url`, not
 * `items[*].url`. A path that does not resolve has nothing to check. A
 * malformed path throws.
 */
function resolveConcrete(data: unknown, path: string): Located[] {
  let current: Located[] = [{ path: "", value: data }];
  for (const part of path.replace(/^(all|any):/, "").split(".")) {
    const m = SEGMENT_RE.exec(part);
    if (!m) throw new Error(`malformed path '${path}'`);
    const name = m[1]!;
    current = current.flatMap((c): Located[] => {
      const obj = c.value as Record<string, unknown>;
      if (typeof obj !== "object" || obj === null || Array.isArray(obj) || !(name in obj)) return [];
      const p = childPath(c.path, name);
      const child = obj[name];
      if (m[2] === undefined) return [{ path: p, value: child }];
      return Array.isArray(child) ? child.map((el, i) => ({ path: childPath(p, i), value: el })) : [];
    });
  }
  return current;
}

// ─── Candidates: ids and URLs in the output ──────────────────────────

/** One id or URL found in the output. `cls` groups ids of one kind, for `stale`. Other ids have no `type`. */
interface Candidate {
  path: string;
  value: string;
  type?: "url" | "github_ref";
  cls?: string;
}

interface Compiled {
  builtins: string[];
  custom: Array<{ name: string; re: RegExp }>;
}

const isBuiltin = (p: string): boolean => (BUILTIN_PATTERNS as readonly string[]).includes(p);

function compileRegex(p: string): { name: string; re: RegExp } {
  if (p.length > MAX_REGEX_SOURCE_LENGTH) {
    throw new Error(`invalid pattern: regex source exceeds ${MAX_REGEX_SOURCE_LENGTH} characters`);
  }
  try {
    return { name: p, re: new RegExp(p, "g") };
  } catch (e) {
    throw new Error(`invalid pattern /${p}/: ${(e as Error).message}`);
  }
}

function compilePatterns(patterns: readonly string[] = BUILTIN_PATTERNS): Compiled {
  return { builtins: patterns.filter(isBuiltin), custom: patterns.filter((p) => !isBuiltin(p)).map(compileRegex) };
}

/**
 * Find ids and URLs in one string. URLs are taken first and masked, so an id
 * inside a URL is checked once, as the URL. Masking happens even when the url
 * pattern is off, so other patterns never match inside a URL.
 */
function extract(text: string, compiled: Compiled, path = ""): Candidate[] {
  const out: Candidate[] = [];
  let rest = text.replace(URL_RE, (m) => {
    if (compiled.builtins.includes("url")) {
      const value = m.replace(TRAILING_PUNCT_RE, "");
      out.push({ path, value, type: "url", cls: urlCollection(normalizeUrl(value)) });
    }
    return " ";
  });
  if (compiled.builtins.includes("github_ref")) {
    rest = rest.replace(GITHUB_REF_RE, (m, owner: string, repo: string) => {
      out.push({ path, value: m, type: "github_ref", cls: `gh:${owner}/${repo}`.toLowerCase() });
      return " ";
    });
  }
  if (compiled.builtins.includes("issue_key")) {
    for (const m of rest.matchAll(ISSUE_KEY_RE)) out.push({ path, value: m[0], cls: `key:${m[1]}` });
  }
  for (const c of compiled.custom) {
    for (const m of rest.matchAll(c.re)) {
      const value = m[1] ?? m[0];
      if (value !== "") out.push({ path, value, cls: `re:${c.name}` });
    }
  }
  return out;
}

/** A whole value at an `ids` path, classified (for `stale`) when it has a recognizable kind. */
function wholeValue(value: string, path: string): Candidate {
  return extract(value, compilePatterns(), path).find((c) => c.value === value) ?? { path, value };
}

// ─── Evidence ────────────────────────────────────────────────────────

/** One body of evidence, indexed for lookup. Built in memory, never stored. */
class Corpus {
  readonly texts: string[] = [];
  private readonly urls = new Set<string>();
  private readonly refs = new Set<string>();

  add(value: unknown): void {
    // Object keys can carry ids too (`{ "ENG-1": {...} }`).
    for (const s of strings(value, true)) {
      this.texts.push(s);
      for (const m of s.matchAll(URL_RE)) {
        const url = normalizeUrl(m[0].replace(TRAILING_PUNCT_RE, ""));
        this.urls.add(url);
        const gh = GITHUB_URL_RE.exec(url);
        if (gh) this.refs.add(`${gh[1]}/${gh[2]}#${gh[3]}`.toLowerCase());
      }
      for (const m of s.matchAll(GITHUB_REF_RE)) this.refs.add(m[0].toLowerCase());
    }
  }

  has(c: Candidate): boolean {
    if (c.type === "url") return this.urls.has(normalizeUrl(c.value));
    if (c.type === "github_ref" && this.refs.has(c.value.toLowerCase())) return true;
    return this.texts.some((t) => containsToken(t, c.value));
  }

  /** Every id kind this corpus holds, by the same extraction as the output (undefined for a kindless one). */
  kinds(compiled: Compiled): Set<string | undefined> {
    return new Set(this.texts.flatMap((t) => extract(t, compiled)).map((c) => c.cls));
  }
}

/** `needle` occurs in `hay` as a whole token: no letter, digit, `_` or `-` against a word edge. */
export function containsToken(hay: string, needle: string): boolean {
  const wordStart = WORD_CHAR.test(needle.charAt(0));
  const wordEnd = WORD_CHAR.test(needle.charAt(needle.length - 1));
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const clearBefore = !wordStart || !WORD_CHAR.test(hay.charAt(i - 1));
    const clearAfter = !wordEnd || !WORD_CHAR.test(hay.charAt(i + needle.length));
    if (clearBefore && clearAfter) return true;
  }
  return false;
}

function didSucceed(c: ToolCall): boolean {
  if (c.status !== undefined) return c.status === "success";
  return !isErrorOutput(c.output);
}

/** Successful calls, limited to `names` (alias-expanded) when given. */
function evidenceCalls(evidence: GroundingEvidence, names: string[] | undefined): ToolCall[] {
  return evidence.toolCalls.filter(
    (c) =>
      didSucceed(c) &&
      (names === undefined || names.some((n) => (evidence.aliases?.get(n) ?? new Set([n])).has(c.tool))),
  );
}

// ─── Reasoning ───────────────────────────────────────────────────────

function label(path: string, value: string): string {
  const shown = value.length > 120 ? `${value.slice(0, 119)}…` : value;
  return `${path} ${JSON.stringify(shown)}`;
}

function listed(failures: string[]): string {
  const more = failures.length - MAX_LISTED;
  return failures.slice(0, MAX_LISTED).join("; ") + (more > 0 ? `; and ${more} more` : "");
}

// ─── The two checks ──────────────────────────────────────────────────

function checkIds(rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence): string[] {
  const compiled = compilePatterns(rule.patterns);
  const roots =
    rule.paths === undefined ? [{ path: "", value: data }] : rule.paths.flatMap((p) => resolveConcrete(data, p));
  const scanned = roots
    .flatMap((r) => leaves(r.value, r.path, false))
    .flatMap((l) => extract(l.text, compiled, l.path));
  const whole = (rule.ids ?? [])
    .flatMap((p) => resolveConcrete(data, p))
    .flatMap((r) => leaves(r.value, r.path, true))
    .filter((l) => l.text.trim() !== "")
    .map((l) => wholeValue(l.text.trim(), l.path));

  const tools = new Corpus();
  for (const c of evidenceCalls(evidence, rule.tools)) tools.add(c.output);
  const useInputs = rule.inputs !== false;
  const useContext = rule.context !== false;
  const given = new Corpus();
  for (const [k, v] of Object.entries(evidence.context ?? {})) {
    if (k !== evidence.nodeId && (k === "input" ? useInputs : useContext)) given.add(v);
  }
  const allow = new Set(rule.allow?.map(normalizeUrl));
  // Kinds come from every built-in plus the rule's own patterns, so a whole value at an ids path has a kind to match.
  const staleKinds =
    rule.stale === true ? tools.kinds(compilePatterns([...BUILTIN_PATTERNS, ...(rule.patterns ?? [])])) : undefined;

  const failures: string[] = [];
  const seen = new Set<string>();
  for (const c of [...scanned, ...whole]) {
    const key = JSON.stringify([c.path, c.value]);
    if (seen.has(key) || allow.has(normalizeUrl(c.value)) || tools.has(c)) continue;
    seen.add(key);
    if (!given.has(c)) failures.push(label(c.path, c.value));
    else if (c.cls !== undefined && staleKinds?.has(c.cls)) {
      failures.push(
        `${label(c.path, c.value)} (stale: this node's tools returned other ids of its kind, not this one)`,
      );
    }
  }
  if (failures.length === 0) return [];

  const sources = ["tool outputs"];
  if (useInputs) sources.push("inputs");
  if (useContext) sources.push("prior context");
  return [`${failures.length} value(s) not grounded (evidence: ${sources.join(", ")}): ${listed(failures)}`];
}

/** The whitespace rule for a quote. `trim` is the default. */
export function normalizeQuote(s: string, mode: OutputGroundedQuote["whitespace"]): string {
  if (mode === "exact") return s;
  if (mode === "collapse") return s.replace(/\s+/g, " ").trim();
  return s.trim();
}

function checkQuotes(rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence): string[] {
  const parts: string[] = [];
  for (const q of rule.quotes ?? []) {
    const mode = q.whitespace ?? "trim";
    const names = q.tools ?? rule.tools;
    // Normalizing the output under trim changes nothing a trimmed quote can match; under collapse it is the rule.
    const hay = evidenceCalls(evidence, names).flatMap((c) =>
      strings(c.output, false).map((s) => normalizeQuote(s, mode)),
    );
    const failures: string[] = [];
    for (const l of resolveConcrete(data, q.path).flatMap((r) => leaves(r.value, r.path, true))) {
      const needle = normalizeQuote(l.text, mode);
      if (!/\S/.test(needle)) failures.push(`${label(l.path, l.text)} (empty)`);
      else if (!hay.some((h) => h.includes(needle))) failures.push(label(l.path, l.text));
    }
    if (failures.length > 0) {
      const from = names === undefined ? "any tool's" : names.join(", ");
      parts.push(
        `${failures.length} quote(s) not found verbatim in ${from} output (whitespace: ${mode}): ${listed(failures)}`,
      );
    }
  }
  return parts;
}

// ─── Entry point ─────────────────────────────────────────────────────

/**
 * Evaluate an `output_grounded` rule against the node's output and evidence.
 * Never throws: a bad config (malformed path, invalid pattern) is a failure
 * with a reason, not a silent pass.
 */
export function evaluateGroundedRule(rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence): Verdict {
  let parts: string[];
  try {
    parts = [...checkIds(rule, data, evidence), ...checkQuotes(rule, data, evidence)];
  } catch (e) {
    parts = [(e as Error).message];
  }
  return parts.length === 0 ? { pass: true } : { pass: false, reasoning: `output_grounded: ${parts.join(" | ")}` };
}
