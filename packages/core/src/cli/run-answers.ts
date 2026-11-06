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
import { RUN_HISTORY_DIR, listRuns } from "./run-history.js";

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
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ── Build, write, read ──────────────────────────────────────────

function clip(value: unknown): unknown {
  if (typeof value === "string")
    return value.length > ANSWER_STRING_MAX ? value.slice(0, ANSWER_STRING_MAX) + "…" : value;
  if (Array.isArray(value)) return value.map(clip);
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]));
  return value;
}

export interface BuildRunAnswersInput {
  runId: string;
  workflow: Workflow;
  results: Map<string, NodeResult>;
  /** Secret values to redact (the same set the journal and output.md use). */
  secrets?: string[];
}

/**
 * Declared fields of each successful node, redacted. A failed or skipped node
 * records nothing, so the diff never reads a failure as "everything resolved".
 */
export function buildRunAnswers(i: BuildRunAnswersInput): RunAnswers {
  const nodes: Record<string, Record<string, unknown>> = {};
  for (const [id, r] of i.results) {
    if (r.status !== "success") continue;
    const data = r.data ?? {};
    const props = (i.workflow.nodes[id]?.output as Record<string, unknown> | undefined)?.properties;
    const fields: Record<string, unknown> = {};
    if (isObj(props) && Object.keys(props).length > 0) {
      for (const key of Object.keys(props)) if (data[key] !== undefined) fields[key] = data[key];
    } else if (typeof data.summary === "string" && data.summary.trim() !== "") {
      fields.summary = data.summary;
    }
    if (Object.keys(fields).length > 0) nodes[id] = fields;
  }
  const clean = clip(redact(nodes, i.secrets ?? []).value) as RunAnswers["nodes"];
  return {
    schema_version: RUN_ANSWERS_SCHEMA_VERSION,
    run_id: i.runId,
    workflow_id: i.workflow.id,
    nodes: clean,
  };
}

/** Relative path: `.sweny/runs/<id>/answers.json`. */
export function answersRelPath(runId: string): string {
  return path.posix.join(...RUN_HISTORY_DIR.split(path.sep), runId, "answers.json");
}

/** Write answers.json (mode 0600; the run dir ignores itself in git). Returns the relative path, or null. Never throws. */
export function writeRunAnswers(answers: RunAnswers, cwd: string = process.cwd()): string | null {
  try {
    const rel = answersRelPath(answers.run_id);
    const file = path.join(cwd, rel);
    writeFileNoFollow(path.join(path.dirname(file), ".gitignore"), "*\n", { root: cwd, mode: 0o644 });
    writeFileNoFollow(file, JSON.stringify(answers, null, 2) + "\n", { root: cwd, mode: 0o600 });
    return rel;
  } catch {
    return null;
  }
}

/** Read a run's answers; null when missing, oversized, a link, corrupt, or an unknown schema version. */
export function readRunAnswers(runId: string, cwd: string = process.cwd()): RunAnswers | null {
  try {
    const file = path.join(cwd, answersRelPath(runId));
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > ANSWERS_READ_MAX_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as RunAnswers;
    if (
      !isObj(parsed) ||
      parsed.schema_version !== RUN_ANSWERS_SCHEMA_VERSION ||
      typeof parsed.run_id !== "string" ||
      typeof parsed.workflow_id !== "string" ||
      !isObj(parsed.nodes) ||
      !Object.values(parsed.nodes).every(isObj)
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
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = walk(v[k]);
      return out;
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
    const v = item[k];
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

/** A list of objects, or a list of scalars. Mixed lists are compared as one opaque value. */
function isCollection(v: unknown): v is unknown[] {
  return Array.isArray(v) && (v.every(isObj) || v.every(isScalar));
}

function indexByIdentity(items: unknown[]): Map<string, unknown[]> {
  const m = new Map<string, unknown[]>();
  for (const it of items) {
    const id = itemIdentity(it);
    const list = m.get(id);
    if (list) list.push(it);
    else m.set(id, [it]);
  }
  return m;
}

function fieldChanges(before: unknown, after: unknown): FieldChange[] {
  if (!isObj(before) || !isObj(after)) return [{ field: "value", before, after }];
  const out: FieldChange[] = [];
  for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const had = k in before && before[k] !== undefined;
    const has = k in after && after[k] !== undefined;
    if (had && has) {
      if (canonical(before[k]) !== canonical(after[k])) out.push({ field: k, before: before[k], after: after[k] });
    } else if (had) out.push({ field: k, before: before[k] });
    else if (has) out.push({ field: k, after: after[k] });
  }
  return out;
}

function compareCollection(node: string, field: string, a: unknown[], b: unknown[]): CollectionEntry {
  const ai = indexByIdentity(a);
  const bi = indexByIdentity(b);
  const e: CollectionEntry = { node, field, kind: "collection", added: [], resolved: [], changed: [], unchanged: 0 };
  for (const [id, bItems] of bi) {
    const aItems = ai.get(id) ?? [];
    bItems.forEach((item, n) => {
      if (n >= aItems.length) {
        e.added.push({ id, label: itemLabel(item), value: item });
      } else if (canonical(aItems[n]) === canonical(item)) {
        e.unchanged++;
      } else {
        e.changed.push({ id, label: itemLabel(item), fields: fieldChanges(aItems[n], item) });
      }
    });
  }
  for (const [id, aItems] of ai) {
    const bCount = bi.get(id)?.length ?? 0;
    aItems.slice(bCount).forEach((item) => e.resolved.push({ id, label: itemLabel(item), value: item }));
  }
  return e;
}

function compareField(node: string, field: string, a: unknown, b: unknown): AnswerEntry | null {
  const aSet = a !== undefined;
  const bSet = b !== undefined;
  if (
    (a === undefined || isCollection(a)) &&
    (b === undefined || isCollection(b)) &&
    (isCollection(a) || isCollection(b))
  ) {
    const e = compareCollection(node, field, (a as unknown[] | undefined) ?? [], (b as unknown[] | undefined) ?? []);
    return e.added.length + e.resolved.length + e.changed.length + e.unchanged === 0 ? null : e;
  }
  if (!aSet) return { node, field, kind: "value", status: "added", after: b };
  if (!bSet) return { node, field, kind: "value", status: "resolved", before: a };
  if (canonical(a) === canonical(b)) return { node, field, kind: "value", status: "unchanged" };
  return { node, field, kind: "value", status: "changed", before: a, after: b };
}

/**
 * Compare an older run's answers (a) with a newer one's (b), node by node and
 * field by field. A list field (all objects, or all scalars) is diffed item by
 * item using {@link itemIdentity}; any other field is one value.
 */
export function compareAnswers(a: RunAnswers | null, b: RunAnswers | null): AnswersComparison {
  if (!a || !b) {
    const missing: Array<"a" | "b"> = [];
    if (!a) missing.push("a");
    if (!b) missing.push("b");
    return { available: false, reason: "missing_answers", missing };
  }
  if (a.workflow_id !== b.workflow_id) return { available: false, reason: "different_workflows" };

  const counts: DiffCounts = { added: 0, resolved: 0, changed: 0, unchanged: 0 };
  const entries: AnswerEntry[] = [];
  const not_compared: AnswerDiff["not_compared"] = [];
  const nodeIds = [...new Set([...Object.keys(b.nodes), ...Object.keys(a.nodes)])];
  for (const node of nodeIds) {
    const an = a.nodes[node];
    const bn = b.nodes[node];
    if (!an || !bn) {
      not_compared.push({ node, only_in: an ? "a" : "b" });
      continue;
    }
    for (const field of [...new Set([...Object.keys(bn), ...Object.keys(an)])]) {
      const e = compareField(node, field, an[field], bn[field]);
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
  workflow_id: string;
  /** The run this one was compared with. */
  previous_run_id: string;
  counts: DiffCounts;
}

/**
 * Compare a recorded run with the run of the same workflow just before it.
 * Null when there is no earlier run, either run has no answers, or anything fails.
 */
export function sinceLastRun(runId: string, cwd: string = process.cwd()): SinceLast | null {
  try {
    const runs = listRuns(cwd); // newest first
    const at = runs.findIndex((r) => r.run_id === runId);
    if (at < 0) return null;
    const current = runs[at];
    const previous = runs.slice(at + 1).find((r) => r.workflow_id === current.workflow_id);
    if (!previous) return null;
    const cmp = compareAnswers(readRunAnswers(previous.run_id, cwd), readRunAnswers(runId, cwd));
    if (!cmp.available) return null;
    return { workflow_id: current.workflow_id, previous_run_id: previous.run_id, counts: cmp.counts };
  } catch {
    return null;
  }
}

/** Save this run's answers, then compare with the previous run. Never throws. */
export function recordRunAnswers(i: BuildRunAnswersInput, cwd: string = process.cwd()): SinceLast | null {
  try {
    if (!writeRunAnswers(buildRunAnswers(i), cwd)) return null;
    return sinceLastRun(i.runId, cwd);
  } catch {
    return null;
  }
}

function shellWord(s: string): string {
  return /^[A-Za-z0-9._-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

const diffCommand = (s: SinceLast) => `sweny runs diff --workflow ${shellWord(s.workflow_id)}`;

/** `2 added, 1 resolved, 1 changed` from the nonzero counts; `no changes` when none. */
function countsText(c: DiffCounts): string {
  const parts = [
    c.added ? `${c.added} added` : "",
    c.resolved ? `${c.resolved} resolved` : "",
    c.changed ? `${c.changed} changed` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

/** Plain text, one line: for the terminal and CI logs. */
export function formatSinceLast(s: SinceLast): string {
  return `since last run: ${countsText(s.counts)} (${diffCommand(s)})`;
}

/** Markdown, one line: for the step summary and the PR comment. */
export function formatSinceLastMarkdown(s: SinceLast): string {
  return `Since last run: ${countsText(s.counts)}. Compare: \`${diffCommand(s)}\``;
}
