/**
 * Run journal (#363): an append-only log of one workflow run, enough to resume
 * a killed or failed run without re-running the nodes that already finished.
 *
 * File: `.sweny/runs/<run-id>/journal.ndjson`, one JSON record per line. Every
 * record carries the format version (`v`), a sequence number (`seq`) and a
 * checksum (`h`, sha256 of the record without `h`). Each append is written and
 * fsync'd before the executor moves on, so a record on disk is a fact.
 *
 * Records, in run order:
 *   run:start        workflow / instruction / input / tool hashes, harness id, input (redacted)
 *   run:resume       one per `sweny workflow resume`
 *   node:start       a node visit began (node + iteration)
 *   node:checkpoint  the agent finished a node with outputs, its result and
 *                    write intents, written before the write stage runs
 *   output:intent    a write is about to be applied (idempotency key + tool)
 *   output:applied   the write returned (key + the ids it produced)
 *   node:end         final result of the visit and the write-stage counters
 *   route            the edge taken after the visit (null = the run ended)
 *   run:end          success | failed | crashed
 *
 * Recovery: a torn or corrupt tail (power loss mid-append) is truncated back to
 * the last valid record. Corruption in the middle of the file is refused.
 *
 * Privacy: the journal is local and holds what the run needs to continue (node
 * data, eval verdicts, safe-output intents). It never holds environment values:
 * secret-looking keys, known token shapes, and the values of secret env vars
 * and skill credentials are replaced with `[redacted]` before anything is
 * written. Tool call inputs and outputs are not journaled.
 *
 * Writes: the write stage's skill handlers are wrapped. Each write gets an
 * idempotency key (node, iteration, tool, canonical arguments), an
 * `output:intent` before the call and an `output:applied` after it. On resume a
 * key with a receipt is not re-applied, and a key with an intent but no receipt
 * (the process died between the API call and the receipt) is looked up on the
 * provider by a marker embedded in the body before anything is re-sent.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Logger, NodeResult, Skill, Tool, ToolContext, Workflow } from "./types.js";
import type { SafeOutputIntent, WriteStageState } from "./safe-outputs.js";
import { resolveNodePermissions } from "./node-policy.js";

export const JOURNAL_SCHEMA_VERSION = 1;
export const JOURNAL_DIR = path.join(".sweny", "runs");
export const JOURNAL_FILE = "journal.ndjson";
const LOCK_FILE = "journal.lock";
/** Journals kept on disk; the oldest beyond this are deleted when a new run starts. */
export const JOURNAL_KEEP = 20;
export const REDACTED = "[redacted]";

const RUN_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

// ─── Hashing ──────────────────────────────────────────────────────

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

/** sha256 (hex) of `value` as canonical JSON: keys sorted, undefined dropped. Same as run history's workflow hash. */
export function canonicalHash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value ?? null)))
    .digest("hex");
}

/** Hash of what the nodes were told: every resolved instruction, rule and context Source. */
export function instructionHash(sources: Record<string, { content: string }>): string {
  return canonicalHash(Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v?.content ?? ""])));
}

/** Hash of the tools the run could call: skill ids, tool names and access, MCP presence, sweny version. */
export function toolsHash(skills: Map<string, Skill>, swenyVersion?: string, harnessId?: string): string {
  const shape = [...skills.values()]
    .map((s) => ({
      id: s.id,
      tools: s.tools.map((t) => `${t.name}:${t.access ?? "unclassified"}`).sort(),
      mcp: s.mcp ? (s.mcp.url ?? s.mcp.command ?? "mcp") : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return canonicalHash({ skills: shape, sweny: swenyVersion ?? null, harness: harnessId ?? null });
}

function recordHash(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
}

// ─── Redaction ────────────────────────────────────────────────────

const SECRET_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "authorization",
  "credential",
  "privatekey",
  "cookie",
  "sessionid",
];

/** True for keys like `GITHUB_TOKEN`, `apiKey`, `client-secret`, `Authorization`. */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY_PARTS.some((p) => k.includes(p));
}

const SECRET_VALUE_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\blin_api_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Values of secret-named env vars / config entries, longest first (8+ chars, so short words never match). */
export function collectSecretValues(...maps: Array<Record<string, string | undefined> | undefined>): string[] {
  const out = new Set<string>();
  for (const m of maps) {
    for (const [k, v] of Object.entries(m ?? {})) {
      if (typeof v === "string" && v.length >= 8 && isSecretKey(k)) out.add(v);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Deep copy of `value` with secrets replaced by `[redacted]`: string values
 * under secret-looking keys, known token shapes, and any occurrence of a value
 * in `secrets`. Numbers and booleans are kept (`inputTokens` is a count).
 */
export function redact(value: unknown, secrets: string[] = []): { value: unknown; redacted: boolean } {
  let redacted = false;
  const scrub = (s: string): string => {
    let out = s;
    for (const secret of secrets) {
      if (out.includes(secret)) {
        out = out.split(secret).join(REDACTED);
        redacted = true;
      }
    }
    for (const re of SECRET_VALUE_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(out)) {
        re.lastIndex = 0;
        out = out.replace(re, REDACTED);
        redacted = true;
      }
    }
    return out;
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 64) return null;
    if (typeof v === "string") return scrub(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "string" && isSecretKey(k) && x.length > 0) {
          out[k] = REDACTED;
          redacted = true;
        } else if (x !== undefined && typeof x !== "function") {
          out[k] = walk(x, depth + 1);
        }
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, 0), redacted };
}

// ─── Records ──────────────────────────────────────────────────────

export interface JournalRecord {
  v: number;
  seq: number;
  type: string;
  at: string;
  [field: string]: unknown;
}

export interface RunStartRecord extends JournalRecord {
  type: "run:start";
  run_id: string;
  workflow_id: string;
  workflow_entry: string;
  workflow_file?: string;
  workflow_hash: string;
  instruction_hash: string;
  input_hash: string;
  tools_hash: string;
  harness?: { id: string };
  sweny_version?: string;
  input: unknown;
  input_redacted: boolean;
}

export interface WriteStateSnapshot {
  counts: Array<[string, number]>;
  total: number;
  seen: string[];
}

interface CheckpointRecord extends JournalRecord {
  node: string;
  iteration: number;
  result: NodeResult;
  intents: SafeOutputIntent[];
  agent_failed: boolean;
  attempt: number;
}

interface EndRecord extends JournalRecord {
  node: string;
  iteration: number;
  result: NodeResult;
  write_state: WriteStateSnapshot;
}

interface OutputRecord extends JournalRecord {
  node: string;
  iteration: number;
  key: string;
  tool: string;
  output?: unknown;
  recovered?: boolean;
}

/** Thrown when the journal was written by a newer sweny. */
export class JournalVersionError extends Error {
  constructor(version: unknown) {
    super(
      `run journal format v${String(version)} is newer than this sweny understands (v${JOURNAL_SCHEMA_VERSION}); upgrade sweny to resume it`,
    );
    this.name = "JournalVersionError";
  }
}

/** Thrown at resume when what the run depends on changed since it was journaled (and `force` is off). */
export class JournalMismatchError extends Error {
  constructor(public readonly what: string[]) {
    super(
      `cannot resume: ${what.join(", ")} changed since this run was journaled. ` +
        `Resuming would mix results from two different runs. Start a new run, or pass --force to resume anyway.`,
    );
    this.name = "JournalMismatchError";
  }
}

/** Thrown when another live process holds the run's journal. */
export class JournalLockedError extends Error {
  constructor(pid: number) {
    super(`run journal is in use by process ${pid}; wait for it to finish (or stop it) before resuming`);
    this.name = "JournalLockedError";
  }
}

// ─── Reading + recovery ───────────────────────────────────────────

export interface JournalRead {
  file: string;
  records: JournalRecord[];
  /** Bytes dropped from a torn / corrupt tail (0 when the file was clean). */
  truncatedBytes: number;
  /** Set when an invalid record sits before valid ones: not a torn tail, so not repairable. */
  corruptAtLine?: number;
}

function verifyLine(line: string, expectedSeq: number): JournalRecord | "version" | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.v === "number" && rec.v > JOURNAL_SCHEMA_VERSION) return "version";
  if (rec.v !== JOURNAL_SCHEMA_VERSION || rec.seq !== expectedSeq || typeof rec.type !== "string") return undefined;
  const { h, ...body } = rec;
  if (typeof h !== "string" || h !== recordHash(JSON.stringify(body))) return undefined;
  return rec as JournalRecord;
}

function looksLikeRecord(text: string): boolean {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    return !!p && typeof p === "object" && typeof p.v === "number" && typeof p.h === "string";
  } catch {
    return false;
  }
}

/**
 * Read a journal. With `repair`, a torn or corrupt tail is truncated on disk
 * back to the last valid record. Throws {@link JournalVersionError} for a
 * newer format.
 */
export function readJournal(file: string, opts: { repair?: boolean } = {}): JournalRead {
  const buf = fs.readFileSync(file);
  const records: JournalRecord[] = [];
  let offset = 0;
  let validBytes = 0;
  let line = 0;
  let firstBad: number | undefined;
  let corruptAtLine: number | undefined;
  while (offset < buf.length) {
    const nl = buf.indexOf(0x0a, offset);
    line++;
    if (nl === -1) {
      // A final segment without a newline is a torn append, whatever it parses as.
      firstBad ??= line;
      break;
    }
    const text = buf.subarray(offset, nl).toString("utf-8");
    offset = nl + 1;
    if (firstBad === undefined) {
      const rec = verifyLine(text, records.length + 1);
      if (rec === "version") throw new JournalVersionError((JSON.parse(text) as { v?: unknown }).v);
      if (rec) {
        records.push(rec);
        validBytes = offset;
      } else {
        firstBad = line;
      }
    } else if (corruptAtLine === undefined && looksLikeRecord(text)) {
      // A well-formed record after a bad line: the damage is not a torn tail.
      corruptAtLine = firstBad;
    }
  }
  const truncatedBytes = buf.length - validBytes;
  if (opts.repair && truncatedBytes > 0 && corruptAtLine === undefined) {
    fs.truncateSync(file, validBytes);
  }
  return { file, records, truncatedBytes, ...(corruptAtLine !== undefined ? { corruptAtLine } : {}) };
}

// ─── Resume plan ──────────────────────────────────────────────────

export type VisitAction = "replay" | "write-stage" | "rerun";

export interface PlannedVisit {
  node: string;
  iteration: number;
  action: VisitAction;
  /** Final status in the journal, for replayed visits. */
  status?: NodeResult["status"];
  /** Route taken after the visit: a node id, null for run end, undefined when not journaled. */
  next?: string | null;
  /** Writes the checkpointed write stage already applied (receipts in the journal). */
  applied: number;
  /** Writes with an intent but no receipt: checked on the provider before anything is re-sent. */
  unconfirmed: number;
}

export interface ResumePlan {
  runId: string;
  start: RunStartRecord;
  /** 1 for the first run, +1 per resume so far. */
  attempts: number;
  /** Last `run:end` status, if the journal has one. */
  lastStatus?: string;
  visits: PlannedVisit[];
  /** Node the resumed run continues at, if it was routed to but never started. */
  freshNode?: string;
  /** Every journaled visit is complete and the last route ended the run. */
  finished: boolean;
  /** Write-stage counters after the last replayed visit. */
  writeState?: WriteStateSnapshot;
  checkpoints: Map<string, CheckpointRecord>;
  ends: Map<string, EndRecord>;
  intents: Map<string, OutputRecord>;
  receipts: Map<string, OutputRecord>;
}

const visitKey = (node: string, iteration: number) => `${node}#${iteration}`;

/** Work out what a resume replays and where it picks up. */
export function buildResumePlan(records: JournalRecord[]): ResumePlan {
  const start = records.find((r) => r.type === "run:start") as RunStartRecord | undefined;
  if (!start) throw new Error("run journal has no run:start record; nothing to resume");

  interface Visit {
    node: string;
    iteration: number;
    checkpoint?: CheckpointRecord;
    end?: EndRecord;
    next?: string | null;
  }
  const order: Visit[] = [];
  const byKey = new Map<string, Visit>();
  const intents = new Map<string, OutputRecord>();
  const receipts = new Map<string, OutputRecord>();
  let attempts = 1;
  let lastStatus: string | undefined;

  for (const r of records) {
    switch (r.type) {
      case "run:resume":
        attempts++;
        lastStatus = undefined;
        break;
      case "node:start": {
        const k = visitKey(r.node as string, r.iteration as number);
        let v = byKey.get(k);
        if (!v) {
          v = { node: r.node as string, iteration: r.iteration as number };
          byKey.set(k, v);
          order.push(v);
        } else {
          // Re-run of a visit an earlier attempt did not finish (or finished failed).
          delete v.end;
          delete v.next;
        }
        break;
      }
      case "node:checkpoint": {
        const v = byKey.get(visitKey(r.node as string, r.iteration as number));
        if (v) v.checkpoint = r as CheckpointRecord;
        break;
      }
      case "node:end": {
        const v = byKey.get(visitKey(r.node as string, r.iteration as number));
        if (v) v.end = r as EndRecord;
        break;
      }
      case "route": {
        const from = r.from as string;
        const v = [...order].reverse().find((x) => x.node === from);
        if (v) v.next = (r.to as string | null) ?? null;
        break;
      }
      case "output:intent":
        intents.set(r.key as string, r as OutputRecord);
        break;
      case "output:applied":
        receipts.set(r.key as string, r as OutputRecord);
        break;
      case "run:end":
        lastStatus = r.status as string;
        break;
    }
  }

  // The first unfinished visit is where the resume picks up; everything before
  // it replays. A last visit that ended failed (and was not routed on) re-runs.
  const visits: PlannedVisit[] = [];
  let writeState: WriteStateSnapshot | undefined;
  let resumed = false;
  for (let i = 0; i < order.length; i++) {
    const v = order[i];
    const isLast = i === order.length - 1;
    const complete = !!v.end && !(isLast && v.end.result.status === "failed" && typeof v.next !== "string");
    const keys = (rec: Map<string, OutputRecord>) =>
      [...rec.values()].filter((o) => o.node === v.node && o.iteration === v.iteration).map((o) => o.key);
    const applied = keys(receipts).length;
    const unconfirmed = keys(intents).filter((k) => !receipts.has(k)).length;
    if (complete && !resumed) {
      visits.push({
        node: v.node,
        iteration: v.iteration,
        action: "replay",
        status: v.end!.result.status,
        next: v.next,
        applied,
        unconfirmed,
      });
      writeState = v.end!.write_state;
      continue;
    }
    resumed = true;
    visits.push({
      node: v.node,
      iteration: v.iteration,
      action: v.checkpoint ? "write-stage" : "rerun",
      applied,
      unconfirmed,
    });
    break;
  }

  const last = visits[visits.length - 1];
  let freshNode: string | undefined;
  if (!resumed) freshNode = last ? (typeof last.next === "string" ? last.next : undefined) : start.workflow_entry;
  const finished = !resumed && !!last && last.next === null;

  const checkpoints = new Map<string, CheckpointRecord>();
  const ends = new Map<string, EndRecord>();
  for (const v of order) {
    if (v.checkpoint) checkpoints.set(visitKey(v.node, v.iteration), v.checkpoint);
    if (v.end) ends.set(visitKey(v.node, v.iteration), v.end);
  }

  return {
    runId: start.run_id,
    start,
    attempts,
    ...(lastStatus ? { lastStatus } : {}),
    visits,
    ...(freshNode ? { freshNode } : {}),
    finished,
    ...(writeState ? { writeState } : {}),
    checkpoints,
    ends,
    intents,
    receipts,
  };
}

/**
 * Nodes a resume would run again that may repeat a write outside safe outputs:
 * the visit had started, was not read-only (no `permissions: read`, no
 * `outputs`, not a dry run), and has no checkpoint. Its agent could have
 * called a write tool, pushed, or edited files before the crash.
 */
export function mayRepeatWrites(plan: ResumePlan, workflow: Workflow, input: unknown): string[] {
  if (input && typeof input === "object" && (input as Record<string, unknown>).dryRun === true) return [];
  return plan.visits
    .filter((v) => v.action === "rerun")
    .filter((v) => {
      const node = workflow.nodes[v.node];
      return !!node && resolveNodePermissions(node, workflow).access !== "read";
    })
    .map((v) => v.node);
}

// ─── Provider lookup for unconfirmed writes ───────────────────────

type ProbeResult =
  | { state: "applied"; output: unknown }
  | { state: "absent" }
  | { state: "reapply" }
  | { state: "unknown"; reason: string };

/** Body field a write tool carries, where the idempotency marker goes. */
const MARKER_FIELD: Record<string, string> = {
  github_create_issue: "body",
  github_add_comment: "body",
  linear_create_issue: "description",
  linear_add_comment: "body",
};

/** Short, single-token marker the provider's search can find. */
export function markerToken(key: string): string {
  return `swenyk${key.slice(0, 24)}`;
}

function withMarker(toolName: string, args: unknown, key: string): unknown {
  const field = MARKER_FIELD[toolName];
  if (!field || !args || typeof args !== "object") return args;
  const a = args as Record<string, unknown>;
  const current = typeof a[field] === "string" ? (a[field] as string) : "";
  return { ...a, [field]: `${current}${current ? "\n\n" : ""}<!-- sweny-output ${markerToken(key)} -->` };
}

async function callRead(skill: Skill | undefined, name: string, args: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = skill?.tools.find((t) => t.name === name && t.access === "read");
  if (!tool) throw new Error(`no ${name} tool configured`);
  return tool.handler(args, ctx);
}

/**
 * Was this write applied before the crash? Writes that are idempotent by
 * nature (labels, state changes, a PR for the same head branch) are simply
 * re-applied. Creates and comments are searched for by their marker.
 */
async function probeProvider(
  toolName: string,
  args: Record<string, unknown>,
  key: string,
  skill: Skill | undefined,
  ctx: ToolContext,
): Promise<ProbeResult> {
  const token = markerToken(key);
  try {
    switch (toolName) {
      case "github_add_labels":
      case "github_set_issue_state":
      case "linear_set_issue_state":
      case "github_create_pr":
        return { state: "reapply" };
      case "github_create_issue":
      case "github_add_comment": {
        const scope = toolName === "github_create_issue" ? "in:body is:issue" : "in:comments";
        const out = (await callRead(
          skill,
          "github_search_issues",
          { query: `${token} ${scope}`, repo: args.repo },
          ctx,
        )) as {
          items?: Array<Record<string, unknown>>;
        };
        if (!out || !Array.isArray(out.items)) return { state: "unknown", reason: "search returned no result list" };
        const hit =
          toolName === "github_create_issue"
            ? out.items.find((i) => typeof i.body === "string" && (i.body as string).includes(token))
            : out.items.find((i) => Number(i.number) === Number(args.issue_number));
        if (!hit) return { state: "absent" };
        return { state: "applied", output: toolName === "github_create_issue" ? hit : {} };
      }
      case "linear_create_issue": {
        const out = (await callRead(skill, "linear_search_issues", { query: token, limit: 5 }, ctx)) as {
          searchIssues?: { nodes?: Array<Record<string, unknown>> };
        };
        const nodes = out?.searchIssues?.nodes;
        if (!Array.isArray(nodes)) return { state: "unknown", reason: "search returned no result list" };
        return nodes.length > 0
          ? { state: "applied", output: { issueCreate: { issue: nodes[0] } } }
          : { state: "absent" };
      }
      case "linear_add_comment": {
        const out = (await callRead(skill, "linear_list_comments", { issueId: args.issueId }, ctx)) as {
          issue?: { comments?: { nodes?: Array<Record<string, unknown>> } };
        };
        const nodes = out?.issue?.comments?.nodes;
        if (!Array.isArray(nodes)) return { state: "unknown", reason: "comment list unavailable" };
        const hit = nodes.find((c) => typeof c.body === "string" && (c.body as string).includes(token));
        return hit ? { state: "applied", output: { commentCreate: { comment: { id: hit.id } } } } : { state: "absent" };
      }
      default:
        return { state: "unknown", reason: `no lookup for ${toolName}` };
    }
  } catch (err) {
    return { state: "unknown", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** The ids a write produced, nothing else (refs and URLs for receipts). */
function slimOutput(o: unknown, depth = 0): unknown {
  if (!o || typeof o !== "object" || Array.isArray(o) || depth > 3) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (["number", "identifier", "id", "html_url", "url", "success", "reused"].includes(k)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const s = slimOutput(v, depth + 1);
      if (s && Object.keys(s as object).length > 0) out[k] = s;
    }
  }
  return out;
}

// ─── The journal ──────────────────────────────────────────────────

/** What the executor tells the journal once sources are resolved. */
export interface JournalBeginInfo {
  workflow: Workflow;
  input: unknown;
  sources: Record<string, { content: string }>;
  skills: Map<string, Skill>;
  config: Record<string, string>;
  writeState: WriteStageState;
  harnessId?: string;
}

export interface JournalCheckpoint {
  result: NodeResult;
  intents: SafeOutputIntent[];
  agentRunFailed: boolean;
  attempt: number;
}

export type JournalReplay =
  { kind: "complete"; result: NodeResult; next?: string | null } | ({ kind: "checkpoint" } & JournalCheckpoint);

/**
 * The executor's view of a journal (`ExecuteOptions.journal`). Every hook is
 * best effort except at resume, where `begin` refuses a changed run.
 */
export interface ExecutionJournal {
  begin(info: JournalBeginInfo): void;
  /** A visit an earlier attempt finished (or checkpointed); undefined = run it. */
  replay(node: string, iteration: number): JournalReplay | undefined;
  nodeStart(node: string, iteration: number): void;
  checkpoint(node: string, iteration: number, cp: JournalCheckpoint): void;
  /** The skill map the write stage applies through: write tools journaled and made idempotent. */
  wrapWrites(node: string, iteration: number, skills: Map<string, Skill>): Map<string, Skill>;
  nodeEnd(node: string, iteration: number, result: NodeResult, writeState: WriteStageState): void;
  route(from: string, to: string | null): void;
}

/** Test seam: called before each append; a throw simulates the process dying there. */
export interface JournalFaults {
  beforeAppend?(record: JournalRecord): void;
}

export interface RunJournalOptions {
  runId: string;
  /** Base directory; the journal goes in `<cwd>/.sweny/runs/<run-id>/`. Default: process.cwd(). */
  cwd?: string;
  /** Workflow file the run came from, so `resume` can load it again. */
  workflowFile?: string;
  swenyVersion?: string;
  /** Environment whose secret-named values are redacted. Never written. */
  env?: Record<string, string | undefined>;
  logger?: Logger;
  faults?: JournalFaults;
  /** Journals kept on disk (default {@link JOURNAL_KEEP}). */
  keep?: number;
}

export interface ResumeJournalOptions extends RunJournalOptions {
  read: JournalRead;
  plan: ResumePlan;
  /** Resume even though the workflow, instructions, input or tools changed. */
  force?: boolean;
  /** Re-send writes whose outcome cannot be confirmed on the provider. */
  allowRepeatWrites?: boolean;
}

export function journalDir(cwd: string, runId: string): string {
  return path.join(cwd, JOURNAL_DIR, runId);
}

/** Run ids with a journal on disk, oldest first. */
export function listJournalRuns(cwd: string = process.cwd()): string[] {
  try {
    return fs
      .readdirSync(path.join(cwd, JOURNAL_DIR))
      .filter((d) => RUN_ID_RE.test(d) && fs.existsSync(path.join(cwd, JOURNAL_DIR, d, JOURNAL_FILE)))
      .sort();
  } catch {
    return [];
  }
}

/** Exact run id, or a unique prefix. */
export function findJournalRun(ref: string, cwd: string = process.cwd()): string | undefined {
  const runs = listJournalRuns(cwd);
  if (runs.includes(ref)) return ref;
  const matches = runs.filter((r) => r.startsWith(ref));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Delete the oldest journals beyond `keep`, never `except`. Never throws. */
export function pruneJournals(cwd: string, keep: number = JOURNAL_KEEP, except?: string): number {
  const runs = listJournalRuns(cwd).filter((r) => r !== except);
  const extra = runs.slice(0, Math.max(0, runs.length - Math.max(0, keep - (except ? 1 : 0))));
  let removed = 0;
  for (const r of extra) {
    try {
      fs.rmSync(journalDir(cwd, r), { recursive: true, force: true });
      removed++;
    } catch {
      // leave it
    }
  }
  return removed;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const quietLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

export class RunJournal implements ExecutionJournal {
  readonly runId: string;
  readonly dir: string;
  readonly file: string;
  private readonly cwd: string;
  private readonly opts: RunJournalOptions;
  private readonly logger: Logger;
  private readonly resume?: { plan: ResumePlan; force: boolean; allowRepeatWrites: boolean };
  private fd: number | undefined;
  private seq = 0;
  private dead = false;
  private began = false;
  private secrets: string[] = [];
  private consumed = new Set<string>();

  private constructor(opts: RunJournalOptions, resume?: ResumeJournalOptions) {
    this.opts = opts;
    this.runId = opts.runId;
    this.cwd = opts.cwd ?? process.cwd();
    this.dir = journalDir(this.cwd, opts.runId);
    this.file = path.join(this.dir, JOURNAL_FILE);
    this.logger = opts.logger ?? quietLogger;
    if (resume) {
      this.resume = {
        plan: resume.plan,
        force: resume.force === true,
        allowRepeatWrites: resume.allowRepeatWrites === true,
      };
      this.seq = resume.read.records.length;
    }
  }

  /** A journal for a new run. Nothing touches disk until the executor calls `begin`. */
  static create(opts: RunJournalOptions): RunJournal {
    return new RunJournal(opts);
  }

  /** A journal that continues `opts.read` (already repaired) under the resume plan. */
  static openForResume(opts: ResumeJournalOptions): RunJournal {
    const j = new RunJournal(opts, opts);
    j.takeLock();
    return j;
  }

  /** False once an append failed: the rest of the run is not journaled. */
  get active(): boolean {
    return !this.dead;
  }

  private takeLock(): void {
    const lock = path.join(this.dir, LOCK_FILE);
    try {
      const pid = Number(fs.readFileSync(lock, "utf-8").trim());
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && pidAlive(pid)) throw new JournalLockedError(pid);
    } catch (err) {
      if (err instanceof JournalLockedError) throw err;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(lock, String(process.pid));
  }

  private releaseLock(): void {
    try {
      fs.rmSync(path.join(this.dir, LOCK_FILE), { force: true });
    } catch {
      // nothing to do
    }
  }

  private append(type: string, fields: Record<string, unknown>): void {
    if (this.dead) return;
    const body: Record<string, unknown> = {
      v: JOURNAL_SCHEMA_VERSION,
      seq: this.seq + 1,
      type,
      at: new Date().toISOString(),
      ...fields,
    };
    const record = { ...body, h: recordHash(JSON.stringify(body)) } as JournalRecord;
    if (this.opts.faults?.beforeAppend) {
      try {
        this.opts.faults.beforeAppend(record);
      } catch (err) {
        // Simulated process death: nothing after this point reaches the disk.
        this.dead = true;
        this.closeFd();
        this.releaseLock();
        throw err;
      }
    }
    try {
      if (this.fd === undefined) {
        fs.mkdirSync(this.dir, { recursive: true });
        this.fd = fs.openSync(this.file, "a");
      }
      fs.writeSync(this.fd, JSON.stringify(record) + "\n");
      fs.fsyncSync(this.fd);
      this.seq++;
    } catch (err) {
      this.dead = true;
      this.closeFd();
      this.logger.warn(
        `  run journal: could not write ${this.file} (${err instanceof Error ? err.message : String(err)}); ` +
          `this run cannot be resumed past this point`,
      );
    }
  }

  private closeFd(): void {
    if (this.fd === undefined) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      // already closed
    }
    this.fd = undefined;
  }

  private clean<T>(value: T): T {
    return redact(value, this.secrets).value as T;
  }

  begin(info: JournalBeginInfo): void {
    if (this.began) return;
    this.began = true;
    this.secrets = collectSecretValues(this.opts.env, info.config);
    const workflowHash = canonicalHash(info.workflow);
    const instrHash = instructionHash(info.sources);
    const toolHash = toolsHash(info.skills, this.opts.swenyVersion, info.harnessId);

    if (this.resume) {
      const start = this.resume.plan.start;
      const changed: string[] = [];
      if (start.workflow_hash !== workflowHash) changed.push("the workflow");
      if (start.instruction_hash !== instrHash) changed.push("instructions, rules or context files");
      if (start.input_hash !== canonicalHash(info.input)) changed.push("the input");
      if (start.tools_hash !== toolHash) changed.push("the configured skills, agent or sweny version");
      if (changed.length > 0) {
        if (!this.resume.force) {
          // Nothing is appended for a refused resume: the journal stays as the crash left it.
          this.dead = true;
          this.closeFd();
          this.releaseLock();
          throw new JournalMismatchError(changed);
        }
        this.logger.warn(`  resume --force: ${changed.join(", ")} changed since the run was journaled`);
      }
      const snap = this.resume.plan.writeState;
      if (snap) {
        info.writeState.counts = new Map(snap.counts);
        info.writeState.total = snap.total;
        info.writeState.seen = new Set(snap.seen);
      }
      this.append("run:resume", {
        attempt: this.resume.plan.attempts + 1,
        forced: this.resume.force && changed.length > 0,
        allow_repeat_writes: this.resume.allowRepeatWrites,
        ...(changed.length > 0 ? { changed } : {}),
      });
      return;
    }

    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // Journals hold node output: keep them out of commits (an agent's `git add -A` included).
      fs.writeFileSync(path.join(this.dir, ".gitignore"), "*\n");
      this.takeLock();
    } catch {
      // append() reports the failure
    }
    pruneJournals(this.cwd, this.opts.keep ?? JOURNAL_KEEP, this.runId);
    const input = redact(info.input, this.secrets);
    this.append("run:start", {
      run_id: this.runId,
      workflow_id: info.workflow.id,
      workflow_entry: info.workflow.entry,
      ...(this.opts.workflowFile ? { workflow_file: this.opts.workflowFile } : {}),
      workflow_hash: workflowHash,
      instruction_hash: instrHash,
      input_hash: canonicalHash(info.input),
      tools_hash: toolHash,
      ...(info.harnessId ? { harness: { id: info.harnessId } } : {}),
      ...(this.opts.swenyVersion ? { sweny_version: this.opts.swenyVersion } : {}),
      input: input.value,
      input_redacted: input.redacted,
    });
  }

  replay(node: string, iteration: number): JournalReplay | undefined {
    const plan = this.resume?.plan;
    if (!plan) return undefined;
    const k = visitKey(node, iteration);
    if (this.consumed.has(k)) return undefined;
    const visit = plan.visits.find((v) => v.node === node && v.iteration === iteration);
    if (!visit) return undefined;
    this.consumed.add(k);
    if (visit.action === "replay") {
      const end = plan.ends.get(k)!;
      return {
        kind: "complete",
        result: structuredClone(end.result),
        ...(visit.next !== undefined ? { next: visit.next } : {}),
      };
    }
    if (visit.action === "write-stage") {
      const cp = plan.checkpoints.get(k)!;
      return {
        kind: "checkpoint",
        result: structuredClone(cp.result),
        intents: structuredClone(cp.intents),
        agentRunFailed: cp.agent_failed,
        attempt: cp.attempt,
      };
    }
    return undefined;
  }

  nodeStart(node: string, iteration: number): void {
    this.append("node:start", { node, iteration });
  }

  checkpoint(node: string, iteration: number, cp: JournalCheckpoint): void {
    if (this.resume?.plan.checkpoints.has(visitKey(node, iteration))) return;
    this.append("node:checkpoint", {
      node,
      iteration,
      result: this.clean(journalResult(cp.result)),
      intents: this.clean(cp.intents),
      agent_failed: cp.agentRunFailed,
      attempt: cp.attempt,
    });
  }

  nodeEnd(node: string, iteration: number, result: NodeResult, writeState: WriteStageState): void {
    this.append("node:end", {
      node,
      iteration,
      result: this.clean(journalResult(result)),
      write_state: { counts: [...writeState.counts], total: writeState.total, seen: [...writeState.seen] },
    });
  }

  route(from: string, to: string | null): void {
    this.append("route", { from, to });
  }

  /** Close the run: `run:end`, then release the lock. Safe to call twice. */
  end(status: "success" | "failed" | "crashed"): void {
    if (this.began) this.append("run:end", { status });
    this.closeFd();
    this.releaseLock();
  }

  wrapWrites(node: string, iteration: number, skills: Map<string, Skill>): Map<string, Skill> {
    const out = new Map<string, Skill>();
    for (const [id, skill] of skills) {
      out.set(id, {
        ...skill,
        tools: skill.tools.map((t) => (t.access === "read" ? t : this.wrapTool(node, iteration, skill, t))),
      });
    }
    return out;
  }

  private wrapTool(node: string, iteration: number, skill: Skill, tool: Tool): Tool {
    return {
      ...tool,
      handler: async (args: unknown, ctx: ToolContext) => {
        const key = canonicalHash({ node, iteration, tool: tool.name, args });
        const plan = this.resume?.plan;
        const receipt = plan?.receipts.get(key);
        if (receipt) {
          this.logger.info(`  run journal: ${tool.name} already applied before the crash; not re-sent`, { node });
          return receipt.output ?? null;
        }
        const replayingStage = !!plan?.checkpoints.has(visitKey(node, iteration));
        const pending = plan?.intents.has(key) === true;
        if (pending || replayingStage) {
          const probe = await probeProvider(tool.name, (args ?? {}) as Record<string, unknown>, key, skill, ctx);
          if (probe.state === "applied") {
            const output = slimOutput(probe.output);
            this.append("output:applied", { node, iteration, key, tool: tool.name, output, recovered: true });
            this.logger.info(`  run journal: ${tool.name} found on the provider; not re-sent`, { node });
            return output;
          }
          if (probe.state === "unknown" && pending && !this.resume?.allowRepeatWrites) {
            throw new Error(
              `cannot confirm whether ${tool.name} was applied before the crash (${probe.reason}); ` +
                `check the target, then resume with --allow-repeat-writes to send it again`,
            );
          }
        }
        this.append("output:intent", { node, iteration, key, tool: tool.name });
        const output = await tool.handler(withMarker(tool.name, args, key), ctx);
        this.append("output:applied", { node, iteration, key, tool: tool.name, output: slimOutput(output) });
        return output;
      },
    };
  }
}

/** What a node result needs to continue a run. Tool call inputs and outputs are dropped. */
function journalResult(r: NodeResult): NodeResult {
  return {
    status: r.status,
    data: r.data ?? {},
    toolCalls: (r.toolCalls ?? []).map((t) => ({
      tool: t.tool,
      input: null,
      ...(t.status ? { status: t.status } : {}),
    })),
    ...(r.evals ? { evals: r.evals } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
    ...(r.skippedWrites ? { skippedWrites: r.skippedWrites } : {}),
    ...(r.harness ? { harness: r.harness } : {}),
    ...(r.degraded ? { degraded: r.degraded } : {}),
    ...(r.outputs ? { outputs: r.outputs } : {}),
  };
}
