// ─── Eval: output_grounded (#580) ────────────────────────────────────
//
// A `function` rule with two checks, both pure and deterministic (no model call):
//
// - Ids: every URL and `owner/repo#N` ref a node outputs (plus issue keys or
//   custom patterns when listed, and every value at the configured `ids`
//   paths) must appear in what the agent saw: the outputs of its own
//   successful read-tool calls, the author's text its prompt carried, and (by
//   default) the workflow input and the prior-node context.
// - Quotes: every value at a `quotes` path must appear verbatim, under an
//   explicit whitespace rule, in one string of a named tool's output.
//
// Evidence lives in memory only. Tool outputs are never journaled (see
// NODE_RESULT_JOURNAL), so the verdict is computed once, while the run holds
// them, and the EvalResult is what the journal keeps. A node replayed on
// resume keeps its journaled verdict; a node that re-runs is re-checked
// against its new tool outputs.

import type { OutputGroundedQuote, OutputGroundedRule, ToolAccess, ToolCall } from "../types.js";
import { isErrorOutput } from "./function.js";

/** What a node's grounding is checked against. */
export interface GroundingEvidence {
  /** The evaluated attempt's tool calls, with outputs (in memory). */
  toolCalls: ToolCall[];
  /** The context the node's prompt received: `{ input, ...priorNodes }`. */
  context?: Record<string, unknown>;
  /** The evaluated node's id. Its own earlier visit (loops) is not evidence. */
  nodeId?: string;
  /** The author's text the prompt carried: instruction, rules, context sources. Always evidence. */
  authored?: string[];
  /** Access class of the node's skill tools by name. A `write` skill tool is never evidence. */
  toolAccess?: ReadonlyMap<string, ToolAccess>;
}

export const BUILTIN_PATTERNS = ["url", "github_ref", "issue_key"] as const;
/** What `{}` scans prose for. Issue keys only when listed: prose is full of `UTF-8`-style tokens. */
export const DEFAULT_PATTERNS = ["url", "github_ref"] as const;
/** Same cap as `output_matches[].matches` (see value.ts). */
export const MAX_REGEX_SOURCE_LENGTH = 1000;
/** Offending values listed per failure group before "and N more". */
export const MAX_LISTED = 8;
/** Shortest quote accepted by default, after whitespace normalization. */
export const DEFAULT_MIN_QUOTE = 8;

/**
 * Tools whose result is not evidence: shells, subagents, file writers, the
 * safe-output tool (`emit_output`, EMIT_OUTPUT_TOOL in safe-outputs.ts) and
 * tools that echo what they were given. Lower-cased; Claude Code, Codex and pi names.
 */
export const NOT_EVIDENCE_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "bashoutput",
  "killshell",
  "shell",
  "apply_patch",
  "task",
  "agent",
  "write",
  "edit",
  "multiedit",
  "notebookedit",
  "todowrite",
  "structuredoutput",
  "exitplanmode",
  "emit_output",
]);
/** A tool name that says it writes, sends or runs: its result likely echoes its input. */
const WRITE_VERB_RE =
  /(?:^|[_-])(?:create|update|save|add|post|send|delete|remove|set|write|edit|upsert|put|patch|merge|close|reopen|assign|comment|reply|publish|push|commit|run|exec|execute|echo|emit)(?:[_-]|$)/i;

const URL_BODY = String.raw`[^\s<>"'${"`"}()[\]{}|\\^]+`;
/** `http(s)://...` in any case, or a scheme-less GitHub or Atlassian link. */
const URL_RE = new RegExp(
  String.raw`https?:\/\/${URL_BODY}|(?<![\w.@/:-])(?:github\.com|[\w-]+\.atlassian\.net)\/${URL_BODY}`,
  "gi",
);
const KNOWN_HOST_RE = /^(?:github\.com|[\w-]+\.atlassian\.net)\//i;
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;
const GITHUB_REF_RE = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+)(?!\w)/g;
const ISSUE_KEY_RE = /(?<![\w-])([A-Z][A-Z0-9]{1,9})-\d+(?![\w-])/g;
/** Matched against a normalized URL: `//host/owner/repo/(issues|pull)/N` at the end. */
const GITHUB_URL_RE = /\/\/[^/]+\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const WORD_CHAR = /[\w-]/;
const SEGMENT_RE = /^([A-Za-z_]\w*)(\[\*\])?$/;
const IDENT_RE = /^[A-Za-z_]\w*$/;
/** sweny's own MCP server: its tools are matched by bare name, like built-ins. */
const OWN_SERVER = "sweny-core";

type Verdict = { pass: boolean; reasoning?: string };
type Located = { path: string; value: unknown };

// ─── URLs ────────────────────────────────────────────────────────────

/**
 * Canonical form for comparing URLs: scheme and host lowercased and the
 * default port dropped (by URL), any trailing slash on the path dropped.
 * Path, query and fragment stay as written. A scheme-less GitHub or
 * Atlassian link gets `https://`. A string that is not a URL comes back trimmed.
 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  try {
    const u = new URL(KNOWN_HOST_RE.test(s) ? `https://${s}` : s);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}${u.hash}`;
  } catch {
    return s;
  }
}

/** The URL minus its fragment. */
function withoutFragment(normalized: string): string {
  return normalized.split("#")[0]!;
}

/** The URL minus its last path segment (`https://h/a/b/3` -> `https://h/a/b`); none for a bare origin. */
function urlCollection(normalized: string): string | undefined {
  const base = withoutFragment(normalized);
  const pathStart = base.indexOf("/", base.indexOf("//") + 2);
  return pathStart === -1 ? undefined : base.slice(0, base.lastIndexOf("/"));
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

/** Every string and number in an evidence value, and its object keys (never array indexes). Cycles read once. */
function evidenceText(value: unknown, seen: WeakSet<object> = new WeakSet()): { values: string[]; keys: string[] } {
  if (typeof value === "string") return { values: [value], keys: [] };
  if (typeof value === "number") return { values: [String(value)], keys: [] };
  if (typeof value !== "object" || value === null || seen.has(value)) return { values: [], keys: [] };
  seen.add(value);
  const entries: Array<[string | undefined, unknown]> = Array.isArray(value)
    ? value.map((v): [undefined, unknown] => [undefined, v])
    : Object.entries(value);
  const out = { values: [] as string[], keys: [] as string[] };
  for (const [k, v] of entries) {
    const inner = evidenceText(v, seen);
    out.values.push(...inner.values);
    out.keys.push(...(k === undefined ? [] : [k]), ...inner.keys);
  }
  return out;
}

/**
 * Resolve an eval path (grammar: spec nodes#path-grammar) to concrete
 * `{ path, value }` pairs, so a failure names `items[3].url`, not
 * `items[*].url`. A path that does not resolve has nothing to check (the
 * caller warns). A malformed path throws.
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

/**
 * One id or URL found in the output. `cls` groups ids of one kind, for
 * `stale`. `whole`: a value at an `ids` path, matched against evidence values
 * only (never keys), and a number only as a whole value.
 */
interface Candidate {
  path: string;
  value: string;
  type?: "url" | "github_ref";
  cls?: string;
  whole?: true;
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

function compilePatterns(patterns: readonly string[]): Compiled {
  return { builtins: patterns.filter(isBuiltin), custom: patterns.filter((p) => !isBuiltin(p)).map(compileRegex) };
}

/** Built-ins only: what runs over tool outputs (a user regex never does). */
const BUILTINS_ONLY = compilePatterns(BUILTIN_PATTERNS);

/**
 * Find ids and URLs in one string. Every pattern reads the whole text, so an
 * id inside a URL's path, query or fragment is a candidate of its own.
 */
function extract(text: string, compiled: Compiled, path = ""): Candidate[] {
  const out: Candidate[] = [];
  const has = (p: string): boolean => compiled.builtins.includes(p);
  if (has("url")) {
    for (const m of text.matchAll(URL_RE)) {
      const value = m[0].replace(TRAILING_PUNCT_RE, "");
      out.push({ path, value, type: "url", cls: urlCollection(normalizeUrl(value)) });
    }
  }
  if (has("github_ref")) {
    for (const m of text.matchAll(GITHUB_REF_RE)) {
      out.push({ path, value: m[0], type: "github_ref", cls: `gh:${m[1]}/${m[2]}`.toLowerCase() });
    }
  }
  if (has("issue_key")) {
    for (const m of text.matchAll(ISSUE_KEY_RE)) out.push({ path, value: m[0], cls: `key:${m[1]}` });
  }
  for (const c of compiled.custom) {
    for (const m of text.matchAll(c.re)) {
      const value = m[1] ?? m[0];
      if (value !== "") out.push({ path, value });
    }
  }
  return out;
}

/** A whole value at an `ids` path, classified (for `stale`) when it has a recognizable kind. */
function wholeValue(value: string, path: string): Candidate {
  const same = extract(value, BUILTINS_ONLY, path).find((c) => c.value === value);
  return { ...(same ?? { path, value }), whole: true };
}

// ─── Evidence ────────────────────────────────────────────────────────

/** One body of evidence, indexed for lookup. Built in memory, never stored. */
class Corpus {
  readonly values: string[] = [];
  private readonly keys: string[] = [];
  private readonly urls = new Set<string>();
  private readonly bases = new Set<string>();
  private readonly refs = new Set<string>();

  add(value: unknown): void {
    const text = evidenceText(value);
    this.keys.push(...text.keys);
    for (const s of text.values) {
      this.values.push(s);
      for (const m of s.matchAll(URL_RE)) {
        const url = normalizeUrl(m[0].replace(TRAILING_PUNCT_RE, ""));
        this.urls.add(url);
        this.bases.add(withoutFragment(url));
        const gh = GITHUB_URL_RE.exec(withoutFragment(url));
        if (gh) this.refs.add(`${gh[1]}/${gh[2]}#${gh[3]}`.toLowerCase());
      }
      for (const m of s.matchAll(GITHUB_REF_RE)) this.refs.add(m[0].toLowerCase());
    }
  }

  has(c: Candidate): boolean {
    if (c.type === "url") {
      // A fragment must have been seen; a link without one is grounded by its page.
      const url = normalizeUrl(c.value);
      return url.includes("#") ? this.urls.has(url) : this.bases.has(url);
    }
    if (c.type === "github_ref" && this.refs.has(c.value.toLowerCase())) return true;
    if (c.whole && NUMBER_RE.test(c.value)) return this.values.some((v) => v.trim() === c.value);
    const texts = c.whole ? this.values : [...this.values, ...this.keys];
    return texts.some((t) => containsToken(t, c.value));
  }

  /** Every id kind this corpus holds, by the built-in patterns only (undefined for a kindless URL). */
  kinds(): Set<string | undefined> {
    return new Set(this.values.flatMap((t) => extract(t, BUILTINS_ONLY)).map((c) => c.cls));
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

/** sweny's own tools and built-ins have no server (sweny-core counts as none). */
function serverOf(c: ToolCall): string | undefined {
  return c.server === OWN_SERVER ? undefined : c.server;
}

/** A tool's result is evidence by default only when the tool reads. */
export function isEvidenceTool(c: ToolCall, toolAccess?: ReadonlyMap<string, ToolAccess>): boolean {
  if (serverOf(c) === undefined) {
    const access = toolAccess?.get(c.tool);
    if (access !== undefined) return access === "read";
    if (NOT_EVIDENCE_TOOLS.has(c.tool.toLowerCase())) return false;
  }
  return !WRITE_VERB_RE.test(c.tool);
}

/** A `tools` entry names this call: a bare name for sweny's own or a built-in, else `server/tool` or `mcp__server__tool`. */
export function namesCall(name: string, c: ToolCall): boolean {
  const server = serverOf(c);
  if (server === undefined) return name === c.tool;
  return name === `${server}/${c.tool}` || name === `mcp__${server}__${c.tool}`;
}

/** Successful calls that count: the named ones when `names` is set, else every read tool. */
function evidenceCalls(evidence: GroundingEvidence, names: string[] | undefined): ToolCall[] {
  return evidence.toolCalls.filter(
    (c) =>
      didSucceed(c) &&
      (names === undefined ? isEvidenceTool(c, evidence.toolAccess) : names.some((n) => namesCall(n, c))),
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

/** Resolve a configured path, noting it when it matched nothing. */
function resolveNoting(data: unknown, path: string, empty: string[]): Located[] {
  const found = resolveConcrete(data, path);
  if (found.length === 0) empty.push(path);
  return found;
}

// ─── The two checks ──────────────────────────────────────────────────

function checkIds(rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence, empty: string[]): string[] {
  const compiled = compilePatterns(rule.patterns ?? DEFAULT_PATTERNS);
  const roots =
    rule.paths === undefined ? [{ path: "", value: data }] : rule.paths.flatMap((p) => resolveNoting(data, p, empty));
  const scanned = roots
    .flatMap((r) => leaves(r.value, r.path, false))
    .flatMap((l) => extract(l.text, compiled, l.path));
  const whole = (rule.ids ?? [])
    .flatMap((p) => resolveNoting(data, p, empty))
    .flatMap((r) => leaves(r.value, r.path, true))
    .filter((l) => l.text.trim() !== "")
    .map((l) => wholeValue(l.text.trim(), l.path));

  const tools = new Corpus();
  for (const c of evidenceCalls(evidence, rule.tools)) tools.add(c.output);
  const useInputs = rule.inputs !== false;
  const useContext = rule.context !== false;
  const given = new Corpus();
  given.add(evidence.authored);
  for (const [k, v] of Object.entries(evidence.context ?? {})) {
    if (k !== evidence.nodeId && (k === "input" ? useInputs : useContext)) given.add(v);
  }
  const allow = new Set(rule.allow?.map(normalizeUrl));
  const staleKinds = rule.stale === true ? tools.kinds() : undefined;

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

  const sources = ["tool outputs", "instruction"];
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

function checkQuotes(rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence, empty: string[]): string[] {
  const parts: string[] = [];
  for (const q of rule.quotes ?? []) {
    const mode = q.whitespace ?? "trim";
    const min = q.min_length ?? DEFAULT_MIN_QUOTE;
    const names = q.tools ?? rule.tools;
    // Normalizing the output under trim changes nothing a trimmed quote can match; under collapse it is the rule.
    const hay = evidenceCalls(evidence, names).flatMap((c) =>
      evidenceText(c.output).values.map((s) => normalizeQuote(s, mode)),
    );
    const failures: string[] = [];
    for (const l of resolveNoting(data, q.path, empty).flatMap((r) => leaves(r.value, r.path, true))) {
      const needle = normalizeQuote(l.text, mode);
      if (!/\S/.test(needle)) failures.push(`${label(l.path, l.text)} (empty)`);
      else if (needle.length < min) failures.push(`${label(l.path, l.text)} (shorter than ${min} characters)`);
      else if (!hay.some((h) => h.includes(needle))) failures.push(label(l.path, l.text));
    }
    if (failures.length > 0) {
      const from = names === undefined ? "any read tool's" : names.join(", ");
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
 * with a reason, not a silent pass. A configured path that matched nothing
 * passes with a warning in the reasoning.
 */
export function evaluateGroundedRule(rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence): Verdict {
  const empty: string[] = [];
  let parts: string[];
  try {
    parts = [...checkIds(rule, data, evidence, empty), ...checkQuotes(rule, data, evidence, empty)];
  } catch (e) {
    return { pass: false, reasoning: `output_grounded: ${(e as Error).message}` };
  }
  const warning = empty.length > 0 ? [`warning: nothing at ${empty.join(", ")}`] : [];
  const notes = [...parts, ...warning];
  if (notes.length === 0) return { pass: true };
  return { pass: parts.length === 0, reasoning: `output_grounded: ${notes.join(" | ")}` };
}
