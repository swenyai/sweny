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
const GITHUB_URL_RE = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)$/;
const WORD_CHAR = /[\w-]/;
const SEGMENT_RE = /^([A-Za-z_]\w*)(\[\*\])?$/;
const IDENT_RE = /^[A-Za-z_]\w*$/;

type Verdict = { pass: boolean; reasoning?: string };

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

function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  if (!IDENT_RE.test(key)) return `${parent}[${JSON.stringify(key)}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

/**
 * Visit every string leaf (and, with `numbers`, number leaf) under a value,
 * with its concrete path. `onKey` sees object keys, never array indexes.
 */
function walk(
  value: unknown,
  path: string,
  numbers: boolean,
  onText: (path: string, text: string) => void,
  onKey?: (key: string) => void,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (typeof value === "string") {
    onText(path, value);
  } else if (numbers && typeof value === "number") {
    onText(path, String(value));
  } else if (typeof value === "object" && value !== null && !seen.has(value)) {
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, childPath(path, i), numbers, onText, onKey, seen));
    } else {
      for (const [k, v] of Object.entries(value)) {
        onKey?.(k);
        walk(v, childPath(path, k), numbers, onText, onKey, seen);
      }
    }
  }
}

/**
 * Resolve an eval path (grammar: spec nodes#path-grammar) to concrete
 * `{ path, value }` pairs, so a failure names `items[3].url`, not
 * `items[*].url`. A path that does not resolve has nothing to check. A
 * malformed path throws.
 */
function resolveConcrete(data: unknown, path: string): Array<{ path: string; value: unknown }> {
  let current: Array<{ path: string; value: unknown }> = [{ path: "", value: data }];
  for (const part of path.replace(/^(all|any):/, "").split(".")) {
    const m = SEGMENT_RE.exec(part);
    if (!m) throw new Error(`malformed path '${path}'`);
    const name = m[1]!;
    const next: Array<{ path: string; value: unknown }> = [];
    for (const c of current) {
      const obj = c.value as Record<string, unknown> | null;
      if (typeof obj !== "object" || obj === null || Array.isArray(obj) || !(name in obj)) continue;
      const p = childPath(c.path, name);
      const child = obj[name];
      if (m[2] === undefined) next.push({ path: p, value: child });
      else if (Array.isArray(child)) child.forEach((el, i) => next.push({ path: childPath(p, i), value: el }));
    }
    current = next;
  }
  return current;
}

// ─── Candidates: ids and URLs in the output ──────────────────────────

/** One id or URL found in the output. `cls` groups ids of one kind, for `stale`. */
interface Candidate {
  path: string;
  value: string;
  type: "url" | "github_ref" | "token";
  cls?: string;
}

interface Compiled {
  builtins: Set<string>;
  custom: Array<{ name: string; re: RegExp }>;
}

function compilePatterns(patterns: readonly string[] = BUILTIN_PATTERNS): Compiled {
  const compiled: Compiled = { builtins: new Set(), custom: [] };
  for (const p of patterns) {
    if ((BUILTIN_PATTERNS as readonly string[]).includes(p)) {
      compiled.builtins.add(p);
    } else if (p.length > MAX_REGEX_SOURCE_LENGTH) {
      throw new Error(`invalid pattern: regex source exceeds ${MAX_REGEX_SOURCE_LENGTH} characters`);
    } else {
      try {
        compiled.custom.push({ name: p, re: new RegExp(p, "g") });
      } catch (e) {
        throw new Error(`invalid pattern /${p}/: ${(e as Error).message}`);
      }
    }
  }
  return compiled;
}

/**
 * Find ids and URLs in one string. URLs are taken first and masked, so an id
 * inside a URL is checked once, as the URL. Masking happens even when the url
 * pattern is off, so other patterns never match inside a URL.
 */
function extract(text: string, path: string, compiled: Compiled, out: Candidate[]): void {
  let rest = text.replace(URL_RE, (m) => {
    if (compiled.builtins.has("url")) {
      const value = m.replace(TRAILING_PUNCT_RE, "");
      out.push({ path, value, type: "url", cls: urlCollection(normalizeUrl(value)) });
    }
    return " ";
  });
  if (compiled.builtins.has("github_ref")) {
    rest = rest.replace(GITHUB_REF_RE, (m, owner: string, repo: string) => {
      out.push({ path, value: m, type: "github_ref", cls: `gh:${owner}/${repo}`.toLowerCase() });
      return " ";
    });
  }
  if (compiled.builtins.has("issue_key")) {
    for (const m of rest.matchAll(ISSUE_KEY_RE)) out.push({ path, value: m[0], type: "token", cls: `key:${m[1]}` });
  }
  for (const c of compiled.custom) {
    for (const m of rest.matchAll(c.re)) {
      const value = m[1] ?? m[0];
      if (value !== "") out.push({ path, value, type: "token", cls: `re:${c.name}` });
    }
  }
}

/** A whole value at an `ids` path, classified (for `stale`) when it has a recognizable kind. */
function wholeValue(value: string, path: string): Candidate {
  const found: Candidate[] = [];
  extract(value, path, compilePatterns(), found);
  const same = found.find((c) => c.value === value);
  return same ?? { path, value, type: "token" };
}

// ─── Evidence ────────────────────────────────────────────────────────

/** One body of evidence, indexed for lookup. Built in memory, never stored. */
class Corpus {
  readonly texts: string[] = [];
  private readonly urls = new Set<string>();
  private readonly refs = new Set<string>();

  add(value: unknown): void {
    const addText = (s: string): void => {
      this.texts.push(s);
      for (const m of s.matchAll(URL_RE)) {
        const url = normalizeUrl(m[0].replace(TRAILING_PUNCT_RE, ""));
        this.urls.add(url);
        const gh = GITHUB_URL_RE.exec(url);
        if (gh) this.refs.add(`${gh[1]}/${gh[2]}#${gh[3]}`.toLowerCase());
      }
      for (const m of s.matchAll(GITHUB_REF_RE)) this.refs.add(m[0].toLowerCase());
    };
    // Object keys can carry ids too (`{ "ENG-1": {...} }`).
    walk(value, "", true, (_p, s) => addText(s), addText);
  }

  has(c: Candidate): boolean {
    if (c.type === "url") return this.urls.has(normalizeUrl(c.value));
    if (c.type === "github_ref" && this.refs.has(c.value.toLowerCase())) return true;
    return this.texts.some((t) => containsToken(t, c.value));
  }

  /** Every id kind this corpus holds, by the same extraction as the output. */
  classes(compiled: Compiled): Set<string> {
    const found: Candidate[] = [];
    for (const t of this.texts) extract(t, "", compiled, found);
    return new Set(found.flatMap((f) => (f.cls === undefined ? [] : [f.cls])));
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
  const candidates: Candidate[] = [];
  const roots =
    rule.paths === undefined ? [{ path: "", value: data }] : rule.paths.flatMap((p) => resolveConcrete(data, p));
  for (const root of roots)
    walk(root.value, root.path, false, (path, text) => extract(text, path, compiled, candidates));
  for (const p of rule.ids ?? []) {
    for (const root of resolveConcrete(data, p)) {
      walk(root.value, root.path, true, (path, text) => {
        if (text.trim() !== "") candidates.push(wholeValue(text.trim(), path));
      });
    }
  }
  if (candidates.length === 0) return [];

  const tools = new Corpus();
  for (const c of evidenceCalls(evidence, rule.tools)) tools.add(c.output);
  const useInputs = rule.inputs !== false;
  const useContext = rule.context !== false;
  const given = new Corpus();
  for (const [k, v] of Object.entries(evidence.context ?? {})) {
    if (k !== evidence.nodeId && (k === "input" ? useInputs : useContext)) given.add(v);
  }
  const allow = new Set((rule.allow ?? []).map(normalizeUrl));
  const staleKinds = rule.stale === true ? tools.classes(compiled) : undefined;

  const failures: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = JSON.stringify([c.path, c.value]);
    if (seen.has(key) || allow.has(normalizeUrl(c.value)) || tools.has(c)) continue;
    seen.add(key);
    if (!given.has(c)) failures.push(label(c.path, c.value));
    else if (c.cls !== undefined && staleKinds?.has(c.cls) === true) {
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
    const hay: string[] = [];
    for (const c of evidenceCalls(evidence, names)) {
      walk(c.output, "", true, (_p, s) => hay.push(mode === "collapse" ? normalizeQuote(s, mode) : s));
    }
    const failures: string[] = [];
    for (const root of resolveConcrete(data, q.path)) {
      walk(root.value, root.path, true, (path, text) => {
        const needle = normalizeQuote(text, mode);
        if (!/\S/.test(needle)) failures.push(`${label(path, text)} (empty)`);
        else if (!hay.some((h) => h.includes(needle))) failures.push(label(path, text));
      });
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
