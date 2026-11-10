/**
 * Local run history for `sweny workflow run`: one small JSON record per run
 * under `.sweny/runs/`, read back by `sweny runs` and `sweny runs diff`.
 *
 * METADATA ONLY. A record holds ids, statuses, durations, counts, token and
 * cost totals, and routing edges. It never holds prompts, node outputs, tool
 * inputs/outputs, error text, or environment values. What a run answered is
 * kept apart, in `<run-id>/answers.json` (run-answers.ts).
 *
 * `schema_version` is the compatibility contract: a future resume journal
 * builds on this format, so readers skip records with a version they do not
 * know instead of guessing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ExecutionEvent, ExecutionTrace, NodeResult, RouteRung, Workflow } from "../types.js";
import { summarizeRun } from "./run-output.js";
import { SPEND_KINDS, type SpendKind } from "../budget.js";
import { openNoFollow } from "../safe-file.js";

export const RUN_HISTORY_SCHEMA_VERSION = 1;
export const RUN_HISTORY_DIR = path.join(".sweny", "runs");
export const RUN_HISTORY_KEEP = 200;
/**
 * Version of the optional detail fields (per-node `tool_counts`, `tokens_in`, `tokens_out`,
 * `num_turns`, and the record's `policy`), stamped as `detail_version` on records that carry them.
 * `schema_version` stays 1: older records have no detail and read as such, and older readers ignore it.
 */
export const RUN_DETAIL_VERSION = 1;
/** At most this many distinct tool names are kept per node, each cut to {@link TOOL_NAME_MAX} characters. */
export const TOOL_COUNTS_MAX = 64;
export const TOOL_NAME_MAX = 80;
const RECORD_READ_MAX_BYTES = 1024 * 1024;

export type RunStatus = "success" | "failed" | "crashed";

export interface RunNodeRecord {
  id: string;
  status: "success" | "failed" | "skipped";
  duration_ms: number;
  tool_calls: number;
  /** input + output tokens; null when the node reported no usage. */
  tokens: number | null;
  /** SDK-reported cost; null when none was reported (never estimated). */
  cost_usd: number | null;
  retries: number;
  /**
   * Calls per tool name (names and counts only, never inputs or outputs). Optional: absent on records
   * written before `detail_version` 1, and when the node made no tool call.
   */
  tool_counts?: Record<string, number>;
  /** Input tokens, when the node reported usage. Optional (detail_version 1). */
  tokens_in?: number;
  /** Output tokens, when the node reported usage. Optional (detail_version 1). */
  tokens_out?: number;
  /** Model turns, when the node reported them. Optional (detail_version 1). */
  num_turns?: number;
}

/** The agent floor the run ran under: booleans and a mode only. Optional (detail_version 1). */
export interface RunPolicyRecord {
  /** The agent subprocess env was narrowed to the allowlist on every node. */
  scoped: boolean;
  sandbox: "off" | "auto" | "strict";
  /** The sandbox was enabled for every node that reported it. */
  sandboxed: boolean;
}

export interface RunTotals {
  nodes_total: number;
  nodes_ok: number;
  nodes_skipped: number;
  tool_calls: number;
  tokens: number | null;
  cost_usd: number | null;
}

export interface RunRecord {
  schema_version: number;
  run_id: string;
  workflow_id: string;
  workflow_hash: string;
  started_at: string;
  duration_ms: number;
  status: RunStatus;
  nodes: RunNodeRecord[];
  /** Edges taken. `rung` says who chose a conditional route: expr, decider or agent (#357). */
  routes: Array<{ from: string; to: string; rung?: RouteRung }>;
  totals: RunTotals;
  /** Harness that ran the nodes (id + version). Absent for runs with no harness-tagged result. */
  harness?: { id: string; version: string };
  /** Opinions the harness could not honor natively on some node, deduped. Absent when none. */
  degraded?: string[];
  /**
   * Spend by kind (node, judge, route, reflect, screen), present when the
   * executor's own completions reported usage. `totals` is then its sum, so a
   * jump in `totals` that no node explains shows here.
   */
  spend?: Partial<Record<SpendKind, RunKindSpend>>;
  /** 1 when the optional detail fields below and on nodes are recorded. Absent on older records. */
  detail_version?: number;
  /** Absent when no node reported its floor. */
  policy?: RunPolicyRecord;
}

export interface RunKindSpend {
  tokens: number;
  cost_usd: number;
  calls: number;
}

// ── Hash + ids ──────────────────────────────────────────────────

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** sha256 (hex) of the workflow as canonical JSON: keys sorted, undefined dropped. */
export function hashWorkflow(workflow: Workflow): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(workflow)))
    .digest("hex");
}

/** The shape `newRunId` generates. Anything else is not a run id. */
export const RUN_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/** Sortable id: `YYYYMMDD-HHMMSS-<6 hex>` in UTC, so filename order is run order. */
export function newRunId(
  startedAtMs: number,
  rand: () => string = () => crypto.randomBytes(3).toString("hex"),
): string {
  const d = new Date(startedAtMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${rand()}`
  );
}

// ── Per-node timing (NodeResult carries no duration) ────────────

export interface NodeTimer {
  observer: (event: ExecutionEvent) => void;
  durations: Map<string, number>;
  /** Last result seen per node: lets a crashed run still record the nodes that finished. */
  lastResults: Map<string, NodeResult>;
}

export function createNodeTimer(now: () => number = Date.now): NodeTimer {
  const entered = new Map<string, number>();
  const durations = new Map<string, number>();
  const lastResults = new Map<string, NodeResult>();
  return {
    durations,
    lastResults,
    observer(event) {
      if (event.type === "node:enter") entered.set(event.node, now());
      else if (event.type === "node:exit") {
        const start = entered.get(event.node);
        // Cleared on exit: a repeated exit can never count the same visit twice.
        entered.delete(event.node);
        if (start !== undefined) durations.set(event.node, (durations.get(event.node) ?? 0) + (now() - start));
        lastResults.set(event.node, event.result);
      } else if (event.type === "node:amended") {
        lastResults.set(event.node, event.result);
      }
    },
  };
}

// ── Build the record ────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Calls per tool name, in first-seen order. Names are cut and capped; undefined when there are none. */
export function countTools(calls: ReadonlyArray<{ tool: string }> | undefined): Record<string, number> | undefined {
  const counts = new Map<string, number>();
  for (const c of calls ?? []) {
    if (typeof c?.tool !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const name = c.tool.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, TOOL_NAME_MAX);
    if (name === "") continue;
    if (!counts.has(name) && counts.size >= TOOL_COUNTS_MAX) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  const out: Record<string, number> = {};
  // defineProperty: a tool named `__proto__` stays a plain key.
  for (const [k, v] of counts) {
    Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

export interface BuildRunRecordInput {
  runId: string;
  workflow: Workflow;
  startedAtMs: number;
  durationMs: number;
  results: Map<string, NodeResult>;
  trace?: ExecutionTrace;
  nodeDurations?: Map<string, number>;
  crashed?: boolean;
}

export function buildRunRecord(i: BuildRunRecordInput): RunRecord {
  const summary = summarizeRun(i.results, i.durationMs, i.crashed, i.trace);
  const retries = new Map<string, number>();
  for (const s of i.trace?.steps ?? []) {
    if (s.retryAttempt !== undefined) retries.set(s.node, Math.max(retries.get(s.node) ?? 0, s.retryAttempt));
  }

  const nodes: RunNodeRecord[] = [...i.results].map(([id, r]) => {
    const u = r.usage;
    const hasTokens = !!u && (isNum(u.inputTokens) || isNum(u.outputTokens));
    const tokens = hasTokens
      ? (isNum(u!.inputTokens) ? u!.inputTokens : 0) + (isNum(u!.outputTokens) ? u!.outputTokens : 0)
      : null;
    const toolCounts = countTools(r.toolCalls);
    return {
      id,
      status: r.status,
      duration_ms: Math.max(0, Math.round(i.nodeDurations?.get(id) ?? 0)),
      tool_calls: r.toolCalls?.length ?? 0,
      tokens,
      cost_usd: u && isNum(u.costUsd) ? u.costUsd : null,
      retries: retries.get(id) ?? 0,
      ...(toolCounts ? { tool_counts: toolCounts } : {}),
      ...(u && isNum(u.inputTokens) ? { tokens_in: u.inputTokens } : {}),
      ...(u && isNum(u.outputTokens) ? { tokens_out: u.outputTokens } : {}),
      ...(u && isNum(u.numTurns) ? { num_turns: u.numTurns } : {}),
    };
  });

  const harness = [...i.results.values()].find((r) => r.harness)?.harness;
  const degraded = [...new Set([...i.results.values()].flatMap((r) => r.degraded ?? []))];

  return {
    schema_version: RUN_HISTORY_SCHEMA_VERSION,
    run_id: i.runId,
    workflow_id: i.workflow.id,
    workflow_hash: hashWorkflow(i.workflow),
    started_at: new Date(i.startedAtMs).toISOString(),
    duration_ms: Math.max(0, Math.round(i.durationMs)),
    status: i.crashed ? "crashed" : summary.ok ? "success" : "failed",
    nodes,
    routes: (i.trace?.edges ?? []).map((e) => ({ from: e.from, to: e.to, ...(e.rung ? { rung: e.rung } : {}) })),
    totals: {
      nodes_total: summary.nodesTotal,
      nodes_ok: summary.nodesOk,
      nodes_skipped: summary.nodesSkipped,
      tool_calls: summary.toolCalls,
      tokens: summary.tokens ?? null,
      cost_usd: summary.costUsd ?? null,
    },
    ...(harness ? { harness: { id: harness.id, version: harness.version } } : {}),
    ...(degraded.length > 0 ? { degraded } : {}),
    ...(summary.spend ? { spend: recordSpend(summary.spend) } : {}),
    detail_version: RUN_DETAIL_VERSION,
    ...(summary.policy?.envScope !== undefined && summary.policy.sandbox
      ? {
          policy: {
            scoped: summary.policy.envScope,
            sandbox: summary.policy.sandbox.mode,
            sandboxed: summary.policy.sandbox.started,
          },
        }
      : {}),
  };
}

function recordSpend(spend: NonNullable<ExecutionTrace["spend"]>): Partial<Record<SpendKind, RunKindSpend>> {
  const out: Partial<Record<SpendKind, RunKindSpend>> = {};
  for (const k of SPEND_KINDS) {
    const v = spend[k];
    if (v) out[k] = { tokens: v.tokens, cost_usd: v.costUsd, calls: v.calls };
  }
  return out;
}

// ── Write, prune, read ──────────────────────────────────────────

/** Atomic write: temp file in the same directory, fsync, rename. Returns the path, or null on failure. Never throws. */
export function writeRunRecord(record: RunRecord, cwd: string = process.cwd()): string | null {
  const dir = path.join(cwd, RUN_HISTORY_DIR);
  const final = path.join(dir, `${record.run_id}.json`);
  const tmp = path.join(dir, `.${record.run_id}.json.${process.pid}.tmp`);
  try {
    // The workspace is agent-writable: no link on the path is followed (safe-file.ts).
    // rename() replaces a link at `final` itself, never its target.
    const fd = openNoFollow(tmp, { root: cwd, mode: 0o644 });
    try {
      fs.writeSync(fd, JSON.stringify(record, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, final);
    return final;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // nothing to clean
    }
    return null;
  }
}

/** Delete the oldest records beyond `keep`. Returns the number removed. Never throws. */
export function pruneRuns(cwd: string = process.cwd(), keep: number = RUN_HISTORY_KEEP): number {
  try {
    const dir = path.join(cwd, RUN_HISTORY_DIR);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && RUN_ID_RE.test(f.slice(0, -5)))
      .sort();
    const extra = files.slice(0, Math.max(0, files.length - keep));
    for (const f of extra) {
      fs.rmSync(path.join(dir, f), { force: true });
      // output.md lives beside the record in <run-id>/ (final-output.ts)
      fs.rmSync(path.join(dir, f.slice(0, -5)), { recursive: true, force: true });
    }
    return extra.length;
  } catch {
    return 0;
  }
}

/** History is on unless `--no-history` (options.history === false) or `.sweny.yml` has `history: off`. */
export function historyDisabled(optionHistory: unknown, configHistory: unknown): boolean {
  if (optionHistory === false) return true;
  return typeof configHistory === "string" && ["off", "false", "no", "0"].includes(configHistory.trim().toLowerCase());
}

/** Write one record then prune. Never throws; warns on stderr if the write failed. */
export function recordRun(record: RunRecord, cwd: string = process.cwd()): boolean {
  const written = writeRunRecord(record, cwd);
  if (!written) {
    process.stderr.write(`  ⚠ could not write run history to ${RUN_HISTORY_DIR}\n`);
    return false;
  }
  pruneRuns(cwd);
  return true;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const RUNGS: ReadonlySet<string> = new Set(["expr", "decider", "agent"]);
const SANDBOX_MODES: ReadonlySet<string> = new Set(["off", "auto", "strict"]);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * Per-tool counts read back: own keys only, names within the writer's own limits (no control
 * characters, at most TOOL_NAME_MAX long, at most TOOL_COUNTS_MAX of them), values non-negative
 * integers. Anything else is dropped; undefined when nothing is left.
 */
function parseToolCounts(v: unknown): Record<string, number> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, number> = {};
  let kept = 0;
  for (const [k, c] of Object.entries(v)) {
    if (kept >= TOOL_COUNTS_MAX) break;
    // eslint-disable-next-line no-control-regex
    if (k === "" || k.length > TOOL_NAME_MAX || /[\u0000-\u001f\u007f]/.test(k) || !count(c)) continue;
    Object.defineProperty(out, k, { value: c, enumerable: true, writable: true, configurable: true });
    kept++;
  }
  return kept > 0 ? out : undefined;
}

/**
 * A typed, allow-listed copy of a stored record, or null when it is not a run record. History is
 * agent-writable, so a record is never passed through: only the documented fields are copied, numbers
 * are made finite, and malformed node, route, harness, degraded and spend entries are dropped. Strings
 * are kept as read (terminal safety is the printer's job, see `printableRun`).
 */
function parseRecord(v: unknown): RunRecord | null {
  if (!isObj(v)) return null;
  if (
    v.schema_version !== RUN_HISTORY_SCHEMA_VERSION ||
    typeof v.run_id !== "string" ||
    typeof v.workflow_id !== "string" ||
    typeof v.started_at !== "string" ||
    typeof v.status !== "string" ||
    !Array.isArray(v.nodes) ||
    !Array.isArray(v.routes) ||
    !isObj(v.totals)
  ) {
    return null;
  }
  const t = v.totals;
  const out: RunRecord = {
    schema_version: RUN_HISTORY_SCHEMA_VERSION,
    run_id: v.run_id,
    workflow_id: v.workflow_id,
    workflow_hash: typeof v.workflow_hash === "string" ? v.workflow_hash : "",
    started_at: v.started_at,
    duration_ms: num(v.duration_ms),
    status: v.status as RunStatus,
    nodes: v.nodes
      .filter((n): n is Record<string, unknown> => isObj(n) && typeof n.id === "string" && typeof n.status === "string")
      .map((n) => {
        const toolCounts = parseToolCounts(n.tool_counts);
        return {
          id: n.id as string,
          status: n.status as RunNodeRecord["status"],
          duration_ms: num(n.duration_ms),
          tool_calls: num(n.tool_calls),
          tokens: numOrNull(n.tokens),
          cost_usd: numOrNull(n.cost_usd),
          retries: num(n.retries),
          // detail_version 1 fields: optional, kept only when well-formed.
          ...(toolCounts ? { tool_counts: toolCounts } : {}),
          ...(count(n.tokens_in) ? { tokens_in: n.tokens_in } : {}),
          ...(count(n.tokens_out) ? { tokens_out: n.tokens_out } : {}),
          ...(count(n.num_turns) ? { num_turns: n.num_turns } : {}),
        };
      }),
    routes: v.routes
      .filter((e): e is Record<string, unknown> => isObj(e) && typeof e.from === "string" && typeof e.to === "string")
      .map((e) => ({
        from: e.from as string,
        to: e.to as string,
        ...(typeof e.rung === "string" && RUNGS.has(e.rung) ? { rung: e.rung as RouteRung } : {}),
      })),
    totals: {
      nodes_total: num(t.nodes_total),
      nodes_ok: num(t.nodes_ok),
      nodes_skipped: num(t.nodes_skipped),
      tool_calls: num(t.tool_calls),
      tokens: numOrNull(t.tokens),
      cost_usd: numOrNull(t.cost_usd),
    },
  };
  if (isObj(v.harness) && typeof v.harness.id === "string" && typeof v.harness.version === "string") {
    out.harness = { id: v.harness.id, version: v.harness.version };
  }
  if (count(v.detail_version) && v.detail_version >= 1) out.detail_version = v.detail_version;
  if (
    isObj(v.policy) &&
    typeof v.policy.scoped === "boolean" &&
    typeof v.policy.sandboxed === "boolean" &&
    typeof v.policy.sandbox === "string" &&
    SANDBOX_MODES.has(v.policy.sandbox)
  ) {
    out.policy = {
      scoped: v.policy.scoped,
      sandbox: v.policy.sandbox as RunPolicyRecord["sandbox"],
      sandboxed: v.policy.sandboxed,
    };
  }
  if (Array.isArray(v.degraded)) out.degraded = v.degraded.filter((d): d is string => typeof d === "string");
  if (isObj(v.spend)) {
    const spend: NonNullable<RunRecord["spend"]> = {};
    for (const k of SPEND_KINDS) {
      const e = Object.hasOwn(v.spend, k) ? v.spend[k] : undefined;
      if (isObj(e)) spend[k] = { tokens: num(e.tokens), cost_usd: num(e.cost_usd), calls: num(e.calls) };
    }
    out.spend = spend;
  }
  return out;
}

/**
 * All readable records, newest first. Corrupt files and unknown schema versions
 * are skipped. History is agent-writable, so a record is trusted only when its
 * run_id has the generated shape, matches its filename, and is not repeated:
 * a planted copy of another run's id is dropped, not merged.
 */
export function listRuns(cwd: string = process.cwd()): RunRecord[] {
  const dir = path.join(cwd, RUN_HISTORY_DIR);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return [];
  }
  const out: RunRecord[] = [];
  for (const f of files) {
    try {
      // A link is not history: the target may be anywhere, and an agent can plant it.
      const file = path.join(dir, f);
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > RECORD_READ_MAX_BYTES) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      const rec = parseRecord(parsed);
      if (rec && RUN_ID_RE.test(rec.run_id) && f === `${rec.run_id}.json`) out.push(rec);
    } catch {
      // corrupt record: skip
    }
  }
  const seen = new Map<string, number>();
  for (const r of out) seen.set(r.run_id, (seen.get(r.run_id) ?? 0) + 1);
  return out
    .filter((r) => seen.get(r.run_id) === 1)
    .sort((a, b) =>
      a.started_at === b.started_at ? b.run_id.localeCompare(a.run_id) : b.started_at.localeCompare(a.started_at),
    );
}

/** Exact run id, or a unique prefix. */
export function findRun(runs: RunRecord[], ref: string): RunRecord | undefined {
  const exact = runs.find((r) => r.run_id === ref);
  if (exact) return exact;
  const matches = runs.filter((r) => r.run_id.startsWith(ref));
  return matches.length === 1 ? matches[0] : undefined;
}
