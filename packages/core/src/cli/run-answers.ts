/**
 * What a run answered, kept so the next run can say what changed.
 *
 * `sweny workflow run` saves `.sweny/runs/<run-id>/answers.json` beside the
 * output.md: each successful node's DECLARED output fields (the node's
 * `output` schema is the contract; with no schema, only a string `summary`).
 * Local only, mode 0600, redacted with the run journal's redactor before
 * anything is stored. The run record itself (run-history.ts) stays metadata
 * only; answers live in their own file so that contract is untouched.
 *
 * Everything under `.sweny/runs/` is writable by an agent, so it is untrusted:
 * ids are validated against the generator's pattern before any path is built,
 * the embedded id must match the one asked for, and the PUBLIC line (PR
 * comment, step summary) carries only the current workflow's own id and
 * integer counts, never text read from history.
 *
 * `compareAnswers` is the diff behind `sweny runs diff` and the "since last
 * run" line. Identity rules (what counts as "the same finding") are explicit
 * and tested; see {@link itemIdentity}.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redact } from "../journal.js";
import { writeFileNoFollow } from "../safe-file.js";
import type { NodeResult, Workflow } from "../types.js";
import { RUN_HISTORY_DIR, RUN_ID_RE, listRuns } from "./run-history.js";

export const RUN_ANSWERS_SCHEMA_VERSION = 1;
/** Strings longer than this are cut (with an ellipsis) before they are stored. */
export const ANSWER_STRING_MAX = 2000;
const ANSWERS_READ_MAX_BYTES = 4 * 1024 * 1024;

export interface RunAnswers {
  schema_version: number;
  run_id: string;
  workflow_id: string;
  /** node id -> declared output fields (redacted). Only nodes that succeeded and produced a field. */
  nodes: Record<string, Record<string, unknown>>;
  /**
   * Strings longer than {@link ANSWER_STRING_MAX} are cut in `nodes` (display only). This mirrors
   * `nodes` and holds the sha256 of each cut string's FULL text, so a change past the cut still
   * compares as changed. Absent when nothing was cut.
   */
  digests?: Record<string, Record<string, unknown>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ── Build, write, read ──────────────────────────────────────────

const has = (o: object, k: string): boolean => Object.hasOwn(o, k);
const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

/** The JSON Schema types a schema declares: `type`, else implied by `properties` / `items`. */
function declaredTypes(sch: Record<string, unknown>): string[] | undefined {
  if (typeof sch.type === "string") return [sch.type];
  if (Array.isArray(sch.type)) return sch.type.filter((t): t is string => typeof t === "string");
  if (isObj(sch.properties)) return ["object"];
  if (isObj(sch.items)) return ["array"];
  return undefined;
}

function typeMatches(value: unknown, types: string[]): boolean {
  return types.some((t) => {
    switch (t) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      case "object":
        return isObj(value);
      case "array":
        return Array.isArray(value);
      default:
        return false;
    }
  });
}

/**
 * Keep only what the schema declares, deep, and only values whose shape matches it: `findings[].title`
 * keeps `title` and nothing else, a string where an object is declared is dropped, as is a value of
 * the wrong `type` or outside an `enum`. An object with no declared properties is dropped (nothing in
 * it was declared). Undefined means "drop".
 */
function pick(value: unknown, schema: unknown): unknown {
  const sch = isObj(schema) ? schema : undefined;
  if (sch) {
    const types = declaredTypes(sch);
    if (types && !typeMatches(value, types)) return undefined;
    if (Array.isArray(sch.enum) && !isObj(value) && !Array.isArray(value) && !sch.enum.includes(value)) {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    const items = sch && isObj(sch.items) ? sch.items : undefined;
    return value.map((v) => pick(v, items)).filter((v) => v !== undefined);
  }
  if (isObj(value)) {
    const props = sch && isObj(sch.properties) ? sch.properties : undefined;
    if (!props) return undefined;
    return Object.fromEntries(
      Object.keys(props)
        .filter((k) => has(value, k))
        .map((k) => [k, pick(value[k], props[k])] as const)
        .filter(([, v]) => v !== undefined),
    );
  }
  return value;
}

/**
 * Secrets in keys too (`redact` scrubs values and keeps keys). A key that redaction changes, or that
 * already looks like a redacted name, becomes `[redacted-<sha256 of the key, 16 hex>]`: injective (no
 * two keys share a name, and no plain key can equal a generated one) and stable (the same key gets
 * the same name in every run, whatever else is present), so a diff still lines them up.
 */
function redactKeys(value: unknown, secrets: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => redactKeys(v, secrets));
  if (!isObj(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => {
      const scrubbed = redact(k, secrets).value as string;
      const name = scrubbed !== k || k.startsWith("[redacted") ? `[redacted-${sha(k).slice(0, 16)}]` : k;
      return [name, redactKeys(v, secrets)] as const;
    }),
  );
}

/** [display value, digest tree]: strings over the cap are cut, and their full-text sha256 goes in the tree. */
function clipTree(value: unknown): [unknown, unknown] {
  if (typeof value === "string") {
    return value.length > ANSWER_STRING_MAX
      ? [value.slice(0, ANSWER_STRING_MAX) + "…", sha(value)]
      : [value, undefined];
  }
  if (Array.isArray(value)) {
    const pairs = value.map(clipTree);
    return [pairs.map((p) => p[0]), pairs.some((p) => p[1] !== undefined) ? pairs.map((p) => p[1] ?? null) : undefined];
  }
  if (isObj(value)) {
    const pairs = Object.entries(value).map(([k, v]) => [k, clipTree(v)] as const);
    const digs = pairs.filter(([, p]) => p[1] !== undefined).map(([k, p]) => [k, p[1]] as const);
    return [
      Object.fromEntries(pairs.map(([k, p]) => [k, p[0]] as const)),
      digs.length > 0 ? Object.fromEntries(digs) : undefined,
    ];
  }
  return [value, undefined];
}

export interface BuildRunAnswersInput {
  runId: string;
  workflow: Workflow;
  results: Map<string, NodeResult>;
  /** Secret values to redact (the same set the journal and output.md use). */
  secrets?: string[];
}

/**
 * Declared fields of each successful node, deep, redacted (values and keys). A failed or skipped
 * node records nothing, so the diff never reads a failure as "everything resolved".
 */
export function buildRunAnswers(i: BuildRunAnswersInput): RunAnswers {
  const secrets = i.secrets ?? [];
  const nodes: Array<[string, unknown]> = [];
  const digests: Array<[string, unknown]> = [];
  for (const [id, r] of i.results) {
    if (r.status !== "success") continue;
    const data = r.data ?? {};
    const schema = has(i.workflow.nodes, id) ? i.workflow.nodes[id]?.output : undefined;
    const props = isObj(schema) ? (schema as Record<string, unknown>).properties : undefined;
    let fields: unknown;
    if (isObj(props) && Object.keys(props).length > 0) {
      fields = pick(data, schema);
    } else if (
      typeof data.summary === "string" &&
      data.summary.trim() !== "" &&
      !(isObj(schema) && (schema as Record<string, unknown>).additionalProperties === false)
    ) {
      // The free-form summary, unless the node's schema closes the object to its declared fields.
      fields = { summary: data.summary };
    }
    if (!isObj(fields) || Object.keys(fields).length === 0) continue;
    const clean = redactKeys(redact(fields, secrets).value, secrets);
    const [shown, digs] = clipTree(clean);
    nodes.push([id, shown]);
    if (digs !== undefined) digests.push([id, digs]);
  }
  return {
    schema_version: RUN_ANSWERS_SCHEMA_VERSION,
    run_id: i.runId,
    workflow_id: i.workflow.id,
    nodes: Object.fromEntries(nodes) as RunAnswers["nodes"],
    ...(digests.length > 0 ? { digests: Object.fromEntries(digests) as NonNullable<RunAnswers["digests"]> } : {}),
  };
}

/** Relative path: `.sweny/runs/<id>/answers.json`. */
export function answersRelPath(runId: string): string {
  return path.posix.join(...RUN_HISTORY_DIR.split(path.sep), runId, "answers.json");
}

/** Write answers.json (mode 0600; the run dir ignores itself in git). Returns the relative path, or null. Never throws. */
export function writeRunAnswers(answers: RunAnswers, cwd: string = process.cwd()): string | null {
  try {
    if (!RUN_ID_RE.test(answers.run_id)) return null;
    const rel = answersRelPath(answers.run_id);
    const file = path.join(cwd, rel);
    writeFileNoFollow(path.join(path.dirname(file), ".gitignore"), "*\n", { root: cwd, mode: 0o644 });
    writeFileNoFollow(file, JSON.stringify(answers, null, 2) + "\n", { root: cwd, mode: 0o600 });
    return rel;
  } catch {
    return null;
  }
}

/**
 * Read a run's answers. Null when the id is not a generated run id (checked before any path is
 * built), the file is missing, oversized, reached through a link, corrupt, an unknown schema
 * version, or carries a different run id than the one asked for.
 */
export function readRunAnswers(runId: string, cwd: string = process.cwd()): RunAnswers | null {
  try {
    if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) return null;
    const rel = answersRelPath(runId);
    const file = path.join(cwd, rel);
    // No link on the path: the real path must be exactly where the id says it is.
    if (fs.realpathSync(file) !== path.join(fs.realpathSync(cwd), rel)) return null;
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > ANSWERS_READ_MAX_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as RunAnswers;
    if (
      !isObj(parsed) ||
      parsed.schema_version !== RUN_ANSWERS_SCHEMA_VERSION ||
      parsed.run_id !== runId ||
      typeof parsed.workflow_id !== "string" ||
      !isObj(parsed.nodes) ||
      !Object.values(parsed.nodes).every(isObj) ||
      (parsed.digests !== undefined && (!isObj(parsed.digests) || !Object.values(parsed.digests).every(isObj)))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ── Identity ────────────────────────────────────────────────────

/** Fields that name an item, in priority order. */
export const IDENTITY_KEYS = ["id", "key", "fingerprint", "title", "name"] as const;

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .filter((k) => v[k] !== undefined)
          .map((k) => [k, walk(v[k])] as const),
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** The raw (un-normalized) identity value of an object item, or undefined. */
function identityRaw(item: Record<string, unknown>): string | undefined {
  for (const k of IDENTITY_KEYS) {
    const v = has(item, k) ? item[k] : undefined;
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/**
 * "Is this the same finding as that one?" The rule, in order:
 *  1. An object item is identified by the first of `id`, `key`, `fingerprint`,
 *     `title`, `name` that holds a non-empty string or a number, normalized
 *     (trimmed, lowercased, whitespace collapsed).
 *  2. An object with none of those is identified by its whole content (a
 *     short hash of its canonical JSON): any edit reads as resolved + added.
 *  3. A plain string, number or boolean item is identified by its normalized value.
 * Two items of one list with the same identity pair up in order.
 */
export function itemIdentity(item: unknown): string {
  if (isObj(item)) {
    const raw = identityRaw(item);
    if (raw !== undefined) return normalize(raw);
    return "content:" + crypto.createHash("sha256").update(canonical(item)).digest("hex").slice(0, 12);
  }
  return normalize(String(item));
}

function itemLabel(item: unknown): string {
  if (!isObj(item)) return String(item);
  const raw = identityRaw(item);
  if (raw !== undefined) return raw;
  for (const v of Object.values(item)) if (typeof v === "string" && v.trim() !== "") return v;
  return canonical(item);
}

// ── Compare ─────────────────────────────────────────────────────

export interface DiffCounts {
  added: number;
  resolved: number;
  changed: number;
  unchanged: number;
}

export interface DiffItem {
  /** Normalized identity (see {@link itemIdentity}). */
  id: string;
  /** Human label: the raw identity value, else the first string field. */
  label: string;
  value: unknown;
}

export interface FieldChange {
  field: string;
  /** Absent when the field is new on this item. */
  before?: unknown;
  /** Absent when the field was dropped from this item. */
  after?: unknown;
}

export interface ChangedItem {
  id: string;
  /** Label from the newer run. */
  label: string;
  fields: FieldChange[];
}

export interface CollectionEntry {
  node: string;
  field: string;
  kind: "collection";
  added: DiffItem[];
  resolved: DiffItem[];
  changed: ChangedItem[];
  unchanged: number;
}

export interface ValueEntry {
  node: string;
  field: string;
  kind: "value";
  status: "added" | "resolved" | "changed" | "unchanged";
  before?: unknown;
  after?: unknown;
}

export type AnswerEntry = CollectionEntry | ValueEntry;

export interface AnswerDiff {
  available: true;
  counts: DiffCounts;
  entries: AnswerEntry[];
  /** Nodes with answers in only one run: not compared, never counted as added or resolved. */
  not_compared: Array<{ node: string; only_in: "a" | "b" }>;
}

export type AnswersComparison =
  | AnswerDiff
  | { available: false; reason: "different_workflows" }
  | { available: false; reason: "missing_answers"; missing: Array<"a" | "b"> };

/** A stored value with the digest tree of its cut strings (see {@link RunAnswers.digests}). */
interface Held {
  v: unknown;
  d: unknown;
}

/** A list of objects, or a list of scalars. Mixed lists are compared as one opaque value. */
function isCollection(v: unknown): v is unknown[] {
  return Array.isArray(v) && (v.every(isObj) || v.every(isScalar));
}

/** The digest subtree for `key` (an object key or array index), if any. */
function sub(d: unknown, key: string | number): unknown {
  if (Array.isArray(d) && typeof key === "number") return d[key] ?? undefined;
  if (isObj(d) && typeof key === "string" && has(d, key)) return d[key];
  return undefined;
}

/** Equal stored text AND equal digests: equal full values. */
const sameHeld = (a: Held, b: Held): boolean =>
  canonical(a.v) === canonical(b.v) && canonical(a.d ?? null) === canonical(b.d ?? null);

function indexByIdentity(items: Held[]): Map<string, Held[]> {
  const m = new Map<string, Held[]>();
  for (const it of items) {
    const id = itemIdentity(it.v);
    const list = m.get(id);
    if (list) list.push(it);
    else m.set(id, [it]);
  }
  return m;
}

function fieldChanges(before: Held, after: Held): FieldChange[] {
  if (!isObj(before.v) || !isObj(after.v)) return [{ field: "value", before: before.v, after: after.v }];
  const b = before.v;
  const a = after.v;
  const out: FieldChange[] = [];
  for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    const had = has(b, k) && b[k] !== undefined;
    const hasNow = has(a, k) && a[k] !== undefined;
    if (had && hasNow) {
      if (!sameHeld({ v: b[k], d: sub(before.d, k) }, { v: a[k], d: sub(after.d, k) })) {
        out.push({ field: k, before: b[k], after: a[k] });
      }
    } else if (had) out.push({ field: k, before: b[k] });
    else if (hasNow) out.push({ field: k, after: a[k] });
  }
  return out;
}

const heldItems = (h: Held | undefined): Held[] =>
  h && Array.isArray(h.v) ? h.v.map((v, i) => ({ v, d: sub(h.d, i) })) : [];

function compareCollection(node: string, field: string, a: Held | undefined, b: Held | undefined): CollectionEntry {
  const ai = indexByIdentity(heldItems(a));
  const bi = indexByIdentity(heldItems(b));
  const e: CollectionEntry = { node, field, kind: "collection", added: [], resolved: [], changed: [], unchanged: 0 };
  for (const [id, bItems] of bi) {
    const aItems = ai.get(id) ?? [];
    bItems.forEach((item, n) => {
      if (n >= aItems.length) {
        e.added.push({ id, label: itemLabel(item.v), value: item.v });
      } else if (sameHeld(aItems[n], item)) {
        e.unchanged++;
      } else {
        e.changed.push({ id, label: itemLabel(item.v), fields: fieldChanges(aItems[n], item) });
      }
    });
  }
  for (const [id, aItems] of ai) {
    const bCount = bi.get(id)?.length ?? 0;
    aItems.slice(bCount).forEach((item) => e.resolved.push({ id, label: itemLabel(item.v), value: item.v }));
  }
  return e;
}

function compareField(node: string, field: string, a: Held | undefined, b: Held | undefined): AnswerEntry | null {
  if (
    (a === undefined || isCollection(a.v)) &&
    (b === undefined || isCollection(b.v)) &&
    (a !== undefined || b !== undefined)
  ) {
    const e = compareCollection(node, field, a, b);
    return e.added.length + e.resolved.length + e.changed.length + e.unchanged === 0 ? null : e;
  }
  if (!a) return { node, field, kind: "value", status: "added", after: b?.v };
  if (!b) return { node, field, kind: "value", status: "resolved", before: a.v };
  if (sameHeld(a, b)) return { node, field, kind: "value", status: "unchanged" };
  return { node, field, kind: "value", status: "changed", before: a.v, after: b.v };
}

/** node -> field -> value + digests. Maps, so a node or field named `constructor` or `__proto__` is just a name. */
function heldByNode(r: RunAnswers): Map<string, Map<string, Held>> {
  const out = new Map<string, Map<string, Held>>();
  for (const [node, fields] of Object.entries(r.nodes)) {
    const digs = r.digests && has(r.digests, node) && isObj(r.digests[node]) ? r.digests[node] : undefined;
    out.set(
      node,
      new Map(Object.entries(fields).map(([f, v]) => [f, { v, d: digs ? sub(digs, f) : undefined }] as const)),
    );
  }
  return out;
}

/**
 * Compare an older run's answers (a) with a newer one's (b), node by node and
 * field by field. A list field (all objects, or all scalars) is diffed item by
 * item using {@link itemIdentity}; any other field is one value. Cut strings
 * compare by the digest of their full text.
 */
export function compareAnswers(a: RunAnswers | null, b: RunAnswers | null): AnswersComparison {
  if (!a || !b) {
    const missing: Array<"a" | "b"> = [];
    if (!a) missing.push("a");
    if (!b) missing.push("b");
    return { available: false, reason: "missing_answers", missing };
  }
  if (a.workflow_id !== b.workflow_id) return { available: false, reason: "different_workflows" };

  const am = heldByNode(a);
  const bm = heldByNode(b);
  const counts: DiffCounts = { added: 0, resolved: 0, changed: 0, unchanged: 0 };
  const entries: AnswerEntry[] = [];
  const not_compared: AnswerDiff["not_compared"] = [];
  for (const node of new Set([...bm.keys(), ...am.keys()])) {
    const an = am.get(node);
    const bn = bm.get(node);
    if (!an || !bn) {
      not_compared.push({ node, only_in: an ? "a" : "b" });
      continue;
    }
    for (const field of new Set([...bn.keys(), ...an.keys()])) {
      const e = compareField(node, field, an.get(field), bn.get(field));
      if (!e) continue;
      entries.push(e);
      if (e.kind === "collection") {
        counts.added += e.added.length;
        counts.resolved += e.resolved.length;
        counts.changed += e.changed.length;
        counts.unchanged += e.unchanged;
      } else {
        counts[e.status]++;
      }
    }
  }
  return { available: true, counts, entries, not_compared };
}

// ── Since last run ──────────────────────────────────────────────

export interface SinceLast {
  /** The CURRENT run's own workflow id, from the loaded workflow, never from history. */
  workflow_id: string;
  /** The run this one was compared with. */
  previous_run_id: string;
  counts: DiffCounts;
  /** Nodes with answers in only one of the two runs (failed, skipped or no output): not compared. */
  not_compared: number;
}

/**
 * Compare a recorded run with the run of the same workflow just before it. `workflowId` comes from
 * the caller's loaded workflow; history only picks WHICH earlier run, never what is printed.
 * Null when there is no earlier run, either run has no answers, or anything fails.
 */
export function sinceLastRun(runId: string, workflowId: string, cwd: string = process.cwd()): SinceLast | null {
  try {
    if (!RUN_ID_RE.test(runId)) return null;
    const previous = listRuns(cwd).find(
      // newest first
      (r) => r.workflow_id === workflowId && r.run_id !== runId && r.run_id < runId,
    );
    if (!previous) return null;
    const cmp = compareAnswers(readRunAnswers(previous.run_id, cwd), readRunAnswers(runId, cwd));
    if (!cmp.available) return null;
    return {
      workflow_id: workflowId,
      previous_run_id: previous.run_id,
      counts: cmp.counts,
      not_compared: cmp.not_compared.length,
    };
  } catch {
    return null;
  }
}

/** Save this run's answers, then compare with the previous run. Never throws. */
export function recordRunAnswers(i: BuildRunAnswersInput, cwd: string = process.cwd()): SinceLast | null {
  try {
    if (!writeRunAnswers(buildRunAnswers(i), cwd)) return null;
    return sinceLastRun(i.runId, i.workflow.id, cwd);
  } catch {
    return null;
  }
}

// The public line is built from a fixed template, a validated id and integers: nothing else.

/** A workflow id that is safe in a shell word and a markdown code span. Anything else drops the flag. */
const SAFE_WORKFLOW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const count = (n: unknown): number => (typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0);

const diffCommand = (s: SinceLast): string =>
  typeof s.workflow_id === "string" && SAFE_WORKFLOW_ID.test(s.workflow_id)
    ? `sweny runs diff --workflow ${s.workflow_id}`
    : "sweny runs diff";

/** `2 added, 1 resolved, 1 changed` from the nonzero counts (`no changes` when none), then the not-compared nodes. */
function countsText(s: SinceLast): string {
  const c = s.counts ?? ({} as DiffCounts);
  const parts = [
    count(c.added) ? `${count(c.added)} added` : "",
    count(c.resolved) ? `${count(c.resolved)} resolved` : "",
    count(c.changed) ? `${count(c.changed)} changed` : "",
  ].filter(Boolean);
  const text = parts.length > 0 ? parts.join(", ") : "no changes";
  const skipped = count(s.not_compared);
  return skipped ? `${text}, ${skipped} not compared: failed or no output` : text;
}

/** Plain text, one line: for the terminal and CI logs. */
export function formatSinceLast(s: SinceLast): string {
  return `since last run: ${countsText(s)} (${diffCommand(s)})`;
}

/** Markdown, one line: for the step summary and the PR comment. */
export function formatSinceLastMarkdown(s: SinceLast): string {
  return `Since last run: ${countsText(s)}. Compare: \`${diffCommand(s)}\``;
}
