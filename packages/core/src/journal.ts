/**
 * Run journal (#363): an append-only log of one workflow run, enough to resume
 * a killed or failed run without re-running the nodes that already finished.
 *
 * File: `.sweny/runs/<run-id>/journal.ndjson` (mode 0600), one JSON record per
 * line. Every record carries the format version (`v`), a sequence number (`seq`)
 * and an authentication code (`h`, HMAC-SHA256 of the record without `h`, under
 * a per-run key). Each append is written and fsync'd before the executor moves
 * on, so a record on disk is a fact.
 *
 * Integrity: the key is 32 random bytes made when the run starts and kept
 * OUTSIDE the workspace, in the user's sweny state dir
 * (`$SWENY_STATE_DIR`, else `$XDG_STATE_HOME/sweny`, else
 * `~/.local/state/sweny`), under `run-keys/` (dir 0700, file 0600). Anything
 * that can write the workspace but not that dir (an agent confined to the
 * workspace, a checked-out branch, an artifact) cannot mint a record resume
 * accepts. Both sandboxes deny reading the key dir; an unsandboxed agent
 * running as the same OS user can still read it, which is why resume also
 * checks the record sequence (see {@link buildResumePlan}) and every replayed
 * route against the workflow's real edges. A resume on another machine needs
 * the same state dir.
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
 *   usage            spend of one agent attempt (cumulative; live while it runs, final when it returns)
 *   run:end          success | failed | crashed
 *
 * Spend: a resume seeds the run budget with every attempt's journaled usage,
 * so a crash never resets the whole-run ceiling.
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
import os from "node:os";
import path from "node:path";
import type { Logger, NodeResult, NodeUsage, Skill, Tool, ToolContext, Workflow } from "./types.js";
import type { SafeOutputIntent, WriteStageState } from "./safe-outputs.js";
import { resolveNodePermissions } from "./node-policy.js";
import { CURRENT_SPEC_VERSION } from "./migrations.js";
import { spendOf, type Spend } from "./budget.js";

/** v2: records are authenticated with a per-run HMAC key (v1 used a public checksum and is refused). */
export const JOURNAL_SCHEMA_VERSION = 2;
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

/**
 * Hash of the workflow a journal is bound to: the canonical workflow plus its
 * effective `spec_version` (#469), so a file that only changes spec version
 * (and therefore migrations) is a different workflow for resume.
 */
export function workflowHashOf(workflow: Workflow): string {
  return canonicalHash({ ...workflow, spec_version: workflow.spec_version ?? String(CURRENT_SPEC_VERSION) });
}

/** Hash of what the nodes were told: every resolved instruction, rule and context Source. */
export function instructionHash(sources: Record<string, { content: string }>): string {
  return canonicalHash(Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v?.content ?? ""])));
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Fingerprint of everything that decides what the run's tools do: per skill its
 * id, name, description, category, instruction, config field names and env var
 * NAMES, every tool's name, description, input schema, access class and a
 * digest of its handler source, the MCP server's type, command, args, url,
 * env var NAMES and header NAMES, and its tool aliases; plus the sweny version
 * (which pins built-in skill code) and the harness. Secret values never enter
 * it: MCP env and header values are dropped, and args are redacted first, so
 * rotating a token neither changes the fingerprint nor leaves a hash of it.
 */
export function toolsHash(
  skills: Map<string, Skill>,
  swenyVersion?: string,
  harnessId?: string,
  secrets: string[] = [],
): string {
  const names = (m: Record<string, unknown> | undefined) => (m ? Object.keys(m).sort() : null);
  const shape = [...skills.values()]
    .map((s) => ({
      id: s.id,
      name: s.name ?? null,
      description: s.description ?? null,
      category: s.category ?? null,
      instruction: s.instruction ?? null,
      config: Object.entries(s.config ?? {})
        .map(([k, f]) => ({ key: k, env: f?.env ?? null, required: f?.required === true }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      tools: (s.tools ?? [])
        .map((t) => ({
          name: t.name,
          description: t.description ?? null,
          schema: t.input_schema ?? null,
          access: t.access ?? "unclassified",
          impl: typeof t.handler === "function" ? sha256(t.handler.toString()) : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      mcp: s.mcp
        ? {
            type: s.mcp.type ?? null,
            command: s.mcp.command ?? null,
            args: s.mcp.args ? redact(s.mcp.args, secrets).value : null,
            url: s.mcp.url ? redact(s.mcp.url, secrets).value : null,
            env: names(s.mcp.env),
            headers: names(s.mcp.headers),
          }
        : null,
      aliases: s.mcpAliases ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return canonicalHash({ skills: shape, sweny: swenyVersion ?? null, harness: harnessId ?? null });
}

function recordMac(key: Buffer, body: string): string {
  return crypto.createHmac("sha256", key).update(body).digest("hex");
}

// ─── Run keys ─────────────────────────────────────────────────────

/** sweny's per-user state dir: `$SWENY_STATE_DIR`, else `$XDG_STATE_HOME/sweny`, else `~/.local/state/sweny`. */
export function swenyStateDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SWENY_STATE_DIR && env.SWENY_STATE_DIR.trim() !== "") return path.resolve(env.SWENY_STATE_DIR);
  const xdg = env.XDG_STATE_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "state");
  return path.join(base, "sweny");
}

/** Where run keys live. Never inside the workspace. */
export function runKeyDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(swenyStateDir(env), "run-keys");
}

function realOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** The key file for one run in one workspace (the workspace path is hashed, not stored). */
export function runKeyFile(cwd: string, runId: string, keyDir: string = runKeyDir()): string {
  const scope = sha256(realOr(cwd)).slice(0, 16);
  return path.join(keyDir, `${scope}-${runId}.key`);
}

/** Thrown when a journal's key is missing or unreadable: its records cannot be checked. */
export class JournalKeyError extends Error {
  constructor(file: string, why: string) {
    super(
      `cannot verify the run journal: its key ${file} is ${why}. A journal can only be resumed by the user ` +
        `(and state dir) that started the run; set SWENY_STATE_DIR to that dir, or start a new run.`,
    );
    this.name = "JournalKeyError";
  }
}

function createRunKey(file: string): Buffer {
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, key.toString("hex") + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return key;
}

/** Read a run key. Throws {@link JournalKeyError}. */
export function loadRunKey(file: string): Buffer {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8").trim();
  } catch {
    throw new JournalKeyError(file, "missing");
  }
  if (!/^[0-9a-f]{64}$/.test(text)) throw new JournalKeyError(file, "not a valid key");
  return Buffer.from(text, "hex");
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
 * The secret values a run can see: secret-named env vars, plus skill config
 * fields (resolved from their env vars) whose config key looks secret. The
 * same set the journal redacts, for anything else that prints node output.
 */
export function runSecretValues(
  skills: Iterable<Skill> | undefined,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const config: Record<string, string | undefined> = {};
  for (const s of skills ?? []) {
    for (const [k, f] of Object.entries(s.config ?? {})) if (f?.env) config[k] = env[f.env];
  }
  return collectSecretValues(env, config);
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

/** Thrown when the journal was written by a newer sweny, or by an older one without record authentication. */
export class JournalVersionError extends Error {
  constructor(version: unknown) {
    super(
      typeof version === "number" && version < JOURNAL_SCHEMA_VERSION
        ? `run journal format v${version} predates authenticated records (v${JOURNAL_SCHEMA_VERSION}); it cannot be ` +
            `resumed safely. Start a new run.`
        : `run journal format v${String(version)} is newer than this sweny understands (v${JOURNAL_SCHEMA_VERSION}); upgrade sweny to resume it`,
    );
    this.name = "JournalVersionError";
  }
}

/** Thrown when the journal's records describe something the executor never writes: edited, spliced or forged. */
export class JournalIntegrityError extends Error {
  constructor(message: string) {
    super(`${message}. The journal was edited or does not come from this run; start a new run.`);
    this.name = "JournalIntegrityError";
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
  /**
   * Set when an invalid record sits before valid ones (not a torn tail), or when
   * a whole record fails authentication (tampering, never a torn write). Not repairable.
   */
  corruptAtLine?: number;
  /** The line whose record failed authentication, when that is why the journal is refused. */
  forgedAtLine?: number;
}

type LineCheck = JournalRecord | "version" | "forged" | undefined;

function verifyLine(line: string, expectedSeq: number, key: () => Buffer): LineCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.v === "number" && rec.v !== JOURNAL_SCHEMA_VERSION && expectedSeq === 1) return "version";
  if (typeof rec.v === "number" && rec.v > JOURNAL_SCHEMA_VERSION) return "version";
  if (rec.v !== JOURNAL_SCHEMA_VERSION || typeof rec.type !== "string" || typeof rec.h !== "string") return undefined;
  const { h, ...body } = rec;
  const expected = Buffer.from(recordMac(key(), JSON.stringify(body)), "hex");
  const given = /^[0-9a-f]{64}$/.test(h as string) ? Buffer.from(h as string, "hex") : Buffer.alloc(0);
  // A whole, well-formed line that fails its MAC is tampering, not a torn append.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return "forged";
  if (rec.seq !== expectedSeq) return "forged";
  return rec as JournalRecord;
}

/** `<cwd>/.sweny/runs/<run-id>/journal.ndjson` -> cwd and run id. */
function journalLocation(file: string): { cwd: string; runId: string } {
  const runDir = path.dirname(path.resolve(file));
  return { runId: path.basename(runDir), cwd: path.dirname(path.dirname(path.dirname(runDir))) };
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
 * Read a journal. With `repair`, a torn tail is truncated on disk back to the
 * last valid record. Records are authenticated with the run's key (`key`, else
 * loaded from the state dir for the run the path names). Throws
 * {@link JournalVersionError} for another format and {@link JournalKeyError}
 * when the key is missing.
 */
export function readJournal(file: string, opts: { repair?: boolean; key?: Buffer; keyDir?: string } = {}): JournalRead {
  const buf = fs.readFileSync(file);
  let key = opts.key;
  const getKey = (): Buffer => {
    if (!key) {
      const { cwd, runId } = journalLocation(file);
      key = loadRunKey(runKeyFile(cwd, runId, opts.keyDir ?? runKeyDir()));
    }
    return key as Buffer;
  };
  const records: JournalRecord[] = [];
  let offset = 0;
  let validBytes = 0;
  let line = 0;
  let firstBad: number | undefined;
  let corruptAtLine: number | undefined;
  let forgedAtLine: number | undefined;
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
      const rec = verifyLine(text, records.length + 1, getKey);
      if (rec === "version") throw new JournalVersionError((JSON.parse(text) as { v?: unknown }).v);
      if (rec === "forged") {
        firstBad = line;
        corruptAtLine = line;
        forgedAtLine = line;
      } else if (rec) {
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
  return {
    file,
    records,
    truncatedBytes,
    ...(corruptAtLine !== undefined ? { corruptAtLine } : {}),
    ...(forgedAtLine !== undefined ? { forgedAtLine } : {}),
  };
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
  /** Spend every earlier attempt journaled: the run budget starts here on resume. */
  priorSpend: Spend;
}

const visitKey = (node: string, iteration: number) => `${node}#${iteration}`;

const RECORD_TYPES = new Set([
  "run:start",
  "run:resume",
  "node:start",
  "node:checkpoint",
  "output:intent",
  "output:applied",
  "node:end",
  "route",
  "usage",
  "run:end",
]);

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isAmount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Check that the records are a sequence the executor can write: one run:start
 * first; nothing but run:resume after run:end; a visit starts only where the
 * last route pointed (or the entry), or re-starts an unfinished or failed
 * visit after a resume; checkpoints, writes, usage and node:end only inside
 * the open visit; one route per finished visit, from that visit's node.
 * Throws {@link JournalIntegrityError}.
 */
export function checkRecordSequence(records: JournalRecord[]): void {
  const bad = (r: JournalRecord, why: string): never => {
    throw new JournalIntegrityError(`run journal record ${r.seq} (${r.type}) ${why}`);
  };
  interface Open {
    node: string;
    iteration: number;
    ended: boolean;
    failed: boolean;
    routed: boolean;
  }
  let cur: Open | undefined;
  let next: string | null | undefined;
  let closed = false;
  let resumedSinceStart = false;
  const visits = new Map<string, number>();
  const checkpointed = new Set<string>();
  const intentKeys = new Set<string>();
  const inVisit = (r: JournalRecord) => {
    if (!cur || cur.ended) bad(r, "is outside any open node visit");
    if (r.node !== cur!.node || r.iteration !== cur!.iteration) {
      bad(r, `names ${String(r.node)}#${String(r.iteration)}, but the open visit is ${cur!.node}#${cur!.iteration}`);
    }
  };

  records.forEach((r, i) => {
    if (!RECORD_TYPES.has(r.type)) bad(r, "has an unknown type");
    if (i === 0) {
      if (r.type !== "run:start") bad(r, "is not run:start");
      if (!isName(r.run_id) || !isName(r.workflow_entry)) bad(r, "is missing the run id or entry node");
      next = r.workflow_entry as string;
      return;
    }
    if (r.type === "run:start") bad(r, "is a second run:start");
    if (closed && r.type !== "run:resume") bad(r, "comes after run:end");
    switch (r.type) {
      case "run:resume":
        closed = false;
        resumedSinceStart = true;
        break;
      case "node:start": {
        if (!isName(r.node) || !isPosInt(r.iteration)) bad(r, "has no valid node or iteration");
        const node = r.node as string;
        const restart =
          resumedSinceStart &&
          !!cur &&
          cur.node === node &&
          cur.iteration === r.iteration &&
          (!cur.ended || (cur.failed && !cur.routed));
        if (!restart) {
          if (cur && !cur.ended) bad(r, `starts ${node} while ${cur.node} is still running`);
          if (cur && !cur.routed) bad(r, `starts ${node} before ${cur.node} was routed`);
          if (typeof next !== "string" || node !== next) {
            bad(r, `starts ${node}, but the run was routed to ${next === null ? "the end" : String(next)}`);
          }
          if (r.iteration !== (visits.get(node) ?? 0) + 1) bad(r, `starts ${node} at the wrong iteration`);
          visits.set(node, r.iteration as number);
        }
        cur = { node, iteration: r.iteration as number, ended: false, failed: false, routed: false };
        resumedSinceStart = false;
        break;
      }
      case "node:checkpoint": {
        inVisit(r);
        const k = visitKey(r.node as string, r.iteration as number);
        if (checkpointed.has(k)) bad(r, "checkpoints a visit twice");
        checkpointed.add(k);
        break;
      }
      case "output:intent":
      case "output:applied":
        inVisit(r);
        if (!checkpointed.has(visitKey(r.node as string, r.iteration as number))) {
          bad(r, "records a write before the visit's checkpoint");
        }
        if (!isName(r.key)) bad(r, "has no idempotency key");
        if (r.type === "output:intent") intentKeys.add(r.key as string);
        else if (!intentKeys.has(r.key as string) && r.recovered !== true) bad(r, "has no matching intent");
        break;
      case "usage":
        inVisit(r);
        if (!isAmount(r.tokens) || !isAmount(r.cost_usd) || !isPosInt((r.attempt as number) + 1)) {
          bad(r, "has invalid amounts");
        }
        break;
      case "node:end": {
        inVisit(r);
        const result = r.result as NodeResult | undefined;
        if (!result || typeof result !== "object" || typeof result.status !== "string") bad(r, "has no result");
        cur!.ended = true;
        cur!.failed = result!.status === "failed";
        break;
      }
      case "route":
        if (!cur || !cur.ended) bad(r, "routes before any visit ended");
        if (cur!.routed) bad(r, `routes ${cur!.node} a second time`);
        if (r.from !== cur!.node) bad(r, `routes from ${String(r.from)}, but the visit that ended is ${cur!.node}`);
        if (r.to !== null && !isName(r.to)) bad(r, "has no valid target");
        cur!.routed = true;
        next = r.to as string | null;
        break;
      case "run:end":
        if (!["success", "failed", "crashed"].includes(r.status as string)) bad(r, "has an unknown status");
        closed = true;
        break;
    }
  });
}

/**
 * Check a journal against the workflow it is resumed with: every visited node
 * exists, and every journaled route is a real edge that its `max_iterations`
 * still allowed. Returns the first problem, or undefined.
 */
export function checkJournalAgainstWorkflow(records: JournalRecord[], workflow: Workflow): string | undefined {
  const start = records[0];
  if (start?.type === "run:start" && start.workflow_entry !== workflow.entry) {
    return `the run started at node ${String(start.workflow_entry)}, but the workflow's entry is ${workflow.entry}`;
  }
  const taken = new Map<string, number>();
  for (const r of records) {
    if (r.type === "node:start" && !workflow.nodes[r.node as string]) {
      return `the journal visits node ${String(r.node)}, which this workflow does not have`;
    }
    if (r.type !== "route" || r.to === null) continue;
    const from = r.from as string;
    const to = r.to as string;
    const edge = workflow.edges.find((e) => e.from === from && e.to === to);
    if (!edge) return `the journal routes ${from} -> ${to}, which is not an edge of this workflow`;
    const k = `${from}->${to}`;
    const n = (taken.get(k) ?? 0) + 1;
    taken.set(k, n);
    if (edge.max_iterations !== undefined && n > edge.max_iterations) {
      return `the journal routes ${from} -> ${to} ${n} times; the edge allows ${edge.max_iterations}`;
    }
  }
  return undefined;
}

/**
 * Spend the journal shows: per agent attempt (of each run segment), the
 * largest cumulative usage it reported, live or final, summed.
 */
function journaledSpend(records: JournalRecord[]): Spend {
  const perAttempt = new Map<string, Spend>();
  let segment = 1;
  for (const r of records) {
    if (r.type === "run:resume") segment++;
    if (r.type !== "usage") continue;
    const k = `${segment}|${visitKey(r.node as string, r.iteration as number)}|${String(r.attempt)}`;
    const prev = perAttempt.get(k) ?? { tokens: 0, costUsd: 0 };
    perAttempt.set(k, {
      tokens: Math.max(prev.tokens, r.tokens as number),
      costUsd: Math.max(prev.costUsd, r.cost_usd as number),
    });
  }
  const total: Spend = { tokens: 0, costUsd: 0 };
  for (const s of perAttempt.values()) {
    total.tokens += s.tokens;
    total.costUsd += s.costUsd;
  }
  return total;
}

/** Work out what a resume replays and where it picks up. Throws {@link JournalIntegrityError} for an impossible sequence. */
export function buildResumePlan(records: JournalRecord[]): ResumePlan {
  const start = records.find((r) => r.type === "run:start") as RunStartRecord | undefined;
  if (!start) throw new Error("run journal has no run:start record; nothing to resume");
  checkRecordSequence(records);

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
    priorSpend: journaledSpend(records),
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
  /**
   * Spend of one agent attempt, cumulative for the attempt: `final` when the
   * attempt returned, otherwise a live report (the journal may throttle those).
   */
  usage?(node: string, iteration: number, attempt: number, usage: NodeUsage, final: boolean): void;
  /** Spend earlier attempts of this run already journaled (resume); the run budget starts from it. */
  priorSpend?(): Spend | undefined;
}

/** Minimum gap between two live usage records of one attempt. Final reports are always written. */
export const USAGE_JOURNAL_INTERVAL_MS = 2000;

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
  /** Where run keys live (default {@link runKeyDir}). Never inside the workspace. */
  keyDir?: string;
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

/** Delete the oldest journals (and their keys) beyond `keep`, never `except`. Never throws. */
export function pruneJournals(
  cwd: string,
  keep: number = JOURNAL_KEEP,
  except?: string,
  keyDir: string = runKeyDir(),
): number {
  const runs = listJournalRuns(cwd).filter((r) => r !== except);
  const extra = runs.slice(0, Math.max(0, runs.length - Math.max(0, keep - (except ? 1 : 0))));
  let removed = 0;
  for (const r of extra) {
    try {
      fs.rmSync(journalDir(cwd, r), { recursive: true, force: true });
      fs.rmSync(runKeyFile(cwd, r, keyDir), { force: true });
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
  private closed = false;
  private secrets: string[] = [];
  private consumed = new Set<string>();
  /** Per-run HMAC key; lives only here and in the key file outside the workspace. */
  private key: Buffer | undefined;
  private readonly keyFile: string;
  /** Last live usage record per attempt: time and spend, for throttling. */
  private lastUsage = new Map<string, { at: number; tokens: number; costUsd: number }>();

  private constructor(opts: RunJournalOptions, resume?: ResumeJournalOptions) {
    this.opts = opts;
    this.runId = opts.runId;
    this.cwd = opts.cwd ?? process.cwd();
    this.dir = journalDir(this.cwd, opts.runId);
    this.file = path.join(this.dir, JOURNAL_FILE);
    this.logger = opts.logger ?? quietLogger;
    this.keyFile = runKeyFile(this.cwd, opts.runId, opts.keyDir ?? runKeyDir());
    if (resume) {
      this.resume = {
        plan: resume.plan,
        force: resume.force === true,
        allowRepeatWrites: resume.allowRepeatWrites === true,
      };
      this.seq = resume.read.records.length;
      this.key = loadRunKey(this.keyFile);
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
    this.makeDir();
    fs.writeFileSync(lock, String(process.pid), { mode: 0o600 });
  }

  /** The run dir is private (0700); its parents are created as usual. */
  private makeDir(): void {
    fs.mkdirSync(path.dirname(this.dir), { recursive: true });
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
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
    if (!this.key) {
      // No key, no record resume could trust: stop journaling rather than write unauthenticated records.
      this.dead = true;
      this.logger.warn(`  run journal: no signing key for this run; this run cannot be resumed`);
      return;
    }
    const body: Record<string, unknown> = {
      v: JOURNAL_SCHEMA_VERSION,
      seq: this.seq + 1,
      type,
      at: new Date().toISOString(),
      ...fields,
    };
    const record = { ...body, h: recordMac(this.key, JSON.stringify(body)) } as unknown as JournalRecord;
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
        this.makeDir();
        this.fd = fs.openSync(this.file, "a", 0o600);
        fs.fchmodSync(this.fd, 0o600);
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
    const workflowHash = workflowHashOf(info.workflow);
    const instrHash = instructionHash(info.sources);
    const toolHash = toolsHash(info.skills, this.opts.swenyVersion, info.harnessId, this.secrets);

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
      this.makeDir();
      // Journals hold node output: keep them out of commits (an agent's `git add -A` included).
      fs.writeFileSync(path.join(this.dir, ".gitignore"), "*\n");
      this.takeLock();
    } catch {
      // append() reports the failure
    }
    try {
      this.key = createRunKey(this.keyFile);
    } catch (err) {
      this.logger.warn(
        `  run journal: could not write the run key under ${path.dirname(this.keyFile)} ` +
          `(${err instanceof Error ? err.message : String(err)}); set SWENY_STATE_DIR to a writable dir`,
      );
    }
    pruneJournals(this.cwd, this.opts.keep ?? JOURNAL_KEEP, this.runId, this.opts.keyDir ?? runKeyDir());
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

  usage(node: string, iteration: number, attempt: number, usage: NodeUsage, final: boolean): void {
    const s = spendOf(usage);
    if (s.tokens === undefined && s.costUsd === undefined) return;
    const tokens = s.tokens ?? 0;
    const costUsd = s.costUsd ?? 0;
    const k = `${visitKey(node, iteration)}|${attempt}`;
    const last = this.lastUsage.get(k);
    const now = Date.now();
    if (!final && last) {
      if (tokens <= last.tokens && costUsd <= last.costUsd) return;
      if (now - last.at < USAGE_JOURNAL_INTERVAL_MS) return;
    }
    if (final && last && tokens <= last.tokens && costUsd <= last.costUsd) return;
    this.lastUsage.set(k, {
      at: now,
      tokens: Math.max(tokens, last?.tokens ?? 0),
      costUsd: Math.max(costUsd, last?.costUsd ?? 0),
    });
    this.append("usage", { node, iteration, attempt, tokens, cost_usd: costUsd, final });
  }

  priorSpend(): Spend | undefined {
    return this.resume ? { ...this.resume.plan.priorSpend } : undefined;
  }

  /** Close the run: `run:end`, then release the lock. Safe to call twice (one run:end). */
  end(status: "success" | "failed" | "crashed"): void {
    if (this.began && !this.closed) this.append("run:end", { status });
    this.closed = true;
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
