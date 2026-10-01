/**
 * Run journal (#363): an append-only log of one workflow run, enough to resume
 * a killed or failed run without re-running the nodes that already finished.
 *
 * Location: the journal never lives in the workspace. Each run gets a private
 * directory in the user's sweny state dir (`$SWENY_STATE_DIR`, else
 * `$XDG_STATE_HOME/sweny`, else `~/.local/state/sweny`):
 *
 *   runs/<workspace-hash>/<run-id>/   (dirs 0700, files 0600, opened O_NOFOLLOW)
 *     key             32 random bytes, the run's HMAC key
 *     journal.ndjson  one JSON record per line, fsync'd per append
 *     head.json       the record being appended, written (atomically) first
 *     meta.json       run id, workspace hash, creation time; authenticated, drives retention
 *     lock            the process that owns the run (pid + start time)
 *
 * Both agent sandboxes deny reading AND writing the whole `runs/` tree, so an
 * agent confined to the workspace cannot read the key, edit or cut the
 * journal, delete the lock or fake a run. The workspace keeps only user-facing
 * artifacts (`.sweny/runs/<run-id>/output.md` and the run history record).
 * Journals an older sweny wrote in the workspace are refused for resume.
 *
 * Integrity: every record carries the format version (`v`), a sequence number
 * (`seq`) and `h`, an HMAC-SHA256 under the run key over the run id, the seq,
 * the previous record's `h` and the record body. The chain means records
 * cannot be reordered, duplicated, or spliced in from another run. The head
 * file holds the full record being appended, written and renamed into place
 * BEFORE the journal append: a crash between the two leaves a journal exactly
 * one record short, and resume restores that record from the head. A journal
 * shorter than that, or one that disagrees with the head, is refused, so the
 * end of the journal cannot be cut away even by something that can write the
 * state dir but not read the key.
 *
 * All of this holds only for an agent under an enforced sandbox. An
 * unsandboxed agent running as the same OS user can read the key and rewrite
 * the state dir. Each such visit is journaled (`agent:unsandboxed`), and a
 * resume of that run warns and marks the receipt `journal_unsandboxed`.
 * Resume also checks the record sequence (see {@link buildResumePlan}) and
 * every replayed route against the workflow's real edges. A state dir whose
 * real path is inside the workspace is refused. A resume on another machine
 * needs the same state dir.
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
 *   route            the edge taken after the visit (null = the run ended), and the rung that chose it
 *   usage            spend of one agent attempt (cumulative; one per model turn that raised it, written
 *                    synchronously, and the final figure when the attempt returns)
 *   agent:unsandboxed the visit's agent ran without an enforced sandbox
 *   run:end          success | failed | crashed
 *
 * Failure: an append that cannot be written (head or journal) is fatal. The
 * executor stops the run before the next model call or side effect and fails
 * the node with the reason, so a resume never under-counts spend or repeats a
 * write the journal did not see.
 *
 * Spend: a resume seeds the run budget with every attempt's journaled usage,
 * from authenticated records only, so a crash never resets the whole-run ceiling.
 *
 * Recovery: an unterminated tail that is not complete JSON (power loss
 * mid-append) is truncated. An unterminated tail that IS complete JSON is
 * never assumed torn: it must authenticate as the next record, or the journal
 * is refused. Corruption in the middle of the file is refused.
 *
 * Lock: taken with O_CREAT|O_EXCL before anything is read or repaired, and
 * held for the whole run or resume. A lock whose process is gone (pid not
 * alive, or alive with a different start time) is taken over under a
 * second exclusive lock, re-checked first, so two resumes cannot both win.
 *
 * Privacy: the journal holds what the run needs to continue (node data, eval
 * verdicts, safe-output intents). It never holds environment values:
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
import type { Logger, NodeResult, NodeUsage, RouteRung, Skill, Tool, ToolContext, Workflow } from "./types.js";
import type { SafeOutputIntent, WriteStageState } from "./safe-outputs.js";
import { resolveNodePermissions } from "./node-policy.js";
import { CURRENT_SPEC_VERSION } from "./migrations.js";
import { spendOf, type Spend } from "./budget.js";
import type { DeciderCounters } from "./decider.js";

/**
 * v3: each record's HMAC chains the run id and the previous record's HMAC.
 * (v2 authenticated records one by one; v1 used a public checksum. Both are refused.)
 */
export const JOURNAL_SCHEMA_VERSION = 3;
/** Where journals lived before v3: in the workspace. Never read for resume, only recognized to refuse. */
export const LEGACY_JOURNAL_DIR = path.join(".sweny", "runs");
export const JOURNAL_FILE = "journal.ndjson";
const KEY_FILE = "key";
const HEAD_FILE = "head.json";
const META_FILE = "meta.json";
const LOCK_FILE = "lock";
/** Journals kept per workspace; the oldest beyond this are deleted when a new run starts. */
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

// ─── State dir layout ─────────────────────────────────────────────

/** sweny's per-user state dir: `$SWENY_STATE_DIR`, else `$XDG_STATE_HOME/sweny`, else `~/.local/state/sweny`. */
export function swenyStateDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SWENY_STATE_DIR && env.SWENY_STATE_DIR.trim() !== "") return path.resolve(env.SWENY_STATE_DIR);
  const xdg = env.XDG_STATE_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "state");
  return path.join(base, "sweny");
}

/** Where every run journal (and its key, head, meta and lock) lives. Agents can neither read nor write it. */
export function runStateRoot(env: Record<string, string | undefined> = process.env): string {
  return path.join(swenyStateDir(env), "runs");
}

function realOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** The workspace's directory name under {@link runStateRoot}: its real path hashed, never stored. */
export function workspaceScope(cwd: string): string {
  return sha256(realOr(cwd)).slice(0, 16);
}

/** One run's private directory: `<state>/runs/<workspace-hash>/<run-id>/`. */
export function journalDir(cwd: string, runId: string, root: string = runStateRoot()): string {
  return path.join(root, workspaceScope(cwd), runId);
}

/** The run's key file (inside its private directory). */
export function runKeyFile(cwd: string, runId: string, root: string = runStateRoot()): string {
  return path.join(journalDir(cwd, runId, root), KEY_FILE);
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** Read a file without following a symlink at its last component. */
function readNoFollow(file: string): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Create a new file (never an existing one, never through a symlink), write it and fsync it. */
function writeNew(file: string, data: string): void {
  const c = fs.constants;
  const fd = fs.openSync(file, c.O_WRONLY | c.O_CREAT | c.O_EXCL | NOFOLLOW, 0o600);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDir(dir: string): void {
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Not every platform can fsync a directory.
  }
}

/** Replace a file atomically: write a new temp file, fsync, rename over, fsync the dir. */
function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    writeNew(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fsyncDir(path.dirname(file));
}

/** Make a run's private directory (and its parents) 0700. */
function makePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

/** Thrown when the journal's state dir resolves into the workspace, where an agent could edit it. */
export class JournalLocationError extends Error {
  constructor(dir: string, cwd: string) {
    super(
      `the run journal's state dir ${dir} resolves inside the workspace ${cwd}, where an agent can edit it. ` +
        `Set SWENY_STATE_DIR to a dir outside the workspace, or pass --no-journal (the run then cannot be resumed)`,
    );
    this.name = "JournalLocationError";
  }
}

/**
 * Refuse a state dir that resolves into the workspace. Real paths are compared
 * (the dir must exist), so a symlink anywhere in either chain counts as where
 * it points. Throws {@link JournalLocationError}.
 */
export function assertStateOutsideWorkspace(dir: string, cwd: string): void {
  const real = fs.realpathSync(dir);
  const ws = fs.realpathSync(cwd);
  if (real === ws || real.startsWith(ws.endsWith(path.sep) ? ws : ws + path.sep)) {
    throw new JournalLocationError(real, ws);
  }
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
  writeNew(file, key.toString("hex") + "\n");
  return key;
}

/** Read a run key. Throws {@link JournalKeyError}. */
export function loadRunKey(file: string): Buffer {
  let text: string;
  try {
    text = readNoFollow(file).toString("utf-8").trim();
  } catch {
    throw new JournalKeyError(file, "missing");
  }
  if (!/^[0-9a-f]{64}$/.test(text)) throw new JournalKeyError(file, "not a valid key");
  return Buffer.from(text, "hex");
}

/** MAC of one record: run id, seq and the previous record's MAC chained in, so records cannot move. */
function chainMac(key: Buffer, runId: string, seq: number, prev: string, body: Record<string, unknown>): string {
  return recordMac(key, `sweny-journal\n${runId}\n${seq}\n${prev}\n${JSON.stringify(body)}`);
}

/** MAC of a side file (head, meta): domain-separated from records. */
function sideMac(key: Buffer, kind: string, body: Record<string, unknown>): string {
  return recordMac(key, `sweny-journal-${kind}\n${JSON.stringify(body)}`);
}

function sameMac(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

/** Thrown when the journal is shorter than, or disagrees with, the record its head file holds. */
export class JournalRollbackError extends Error {
  constructor(message: string) {
    super(`${message}. Refusing to resume (not overridable by --force); start a new run.`);
    this.name = "JournalRollbackError";
  }
}

// ─── Head ─────────────────────────────────────────────────────────

/**
 * The record being appended (seq 0 and no record before the first append).
 * Written atomically BEFORE the record goes to the journal, so the journal is
 * either at the head or exactly one record short of it (a crash in between),
 * never anything else.
 */
export interface JournalHead {
  seq: number;
  record: JournalRecord | null;
}

const SIDE_VERSION = 1;

function writeJournalHead(dir: string, key: Buffer, runId: string, head: JournalHead): void {
  const body = { v: SIDE_VERSION, run_id: runId, seq: head.seq, record: head.record };
  writeAtomic(path.join(dir, HEAD_FILE), JSON.stringify({ ...body, h: sideMac(key, "head", body) }) + "\n");
}

/** Read and authenticate a run's head file. Throws {@link JournalRollbackError}. */
export function loadJournalHead(dir: string, key: Buffer, runId: string): JournalHead {
  const file = path.join(dir, HEAD_FILE);
  let text: string;
  try {
    text = readNoFollow(file).toString("utf-8");
  } catch {
    throw new JournalRollbackError(`cannot check the run journal's length: its head file ${file} is missing`);
  }
  const invalid = () => new JournalRollbackError(`the run journal's head file ${file} is not valid`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  const { h, ...body } = parsed as Record<string, unknown>;
  if (!sameMac(h, sideMac(key, "head", body))) throw invalid();
  const { v, run_id, seq, record } = body;
  if (v !== SIDE_VERSION || run_id !== runId) throw invalid();
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) throw invalid();
  if (seq === 0 ? record !== null : !record || typeof record !== "object" || Array.isArray(record)) throw invalid();
  return { seq, record: record as JournalRecord | null };
}

// ─── Meta (retention) ─────────────────────────────────────────────

interface RunMeta {
  runId: string;
  createdAt: string;
}

function writeRunMeta(dir: string, key: Buffer, runId: string, scope: string): void {
  const body = { v: SIDE_VERSION, run_id: runId, scope, created_at: new Date().toISOString() };
  writeNew(path.join(dir, META_FILE), JSON.stringify({ ...body, h: sideMac(key, "meta", body) }) + "\n");
}

/** A run's authenticated metadata, or undefined when it is missing, unreadable or not this run's. */
function loadRunMeta(dir: string, runId: string, scope: string): RunMeta | undefined {
  try {
    const key = loadRunKey(path.join(dir, KEY_FILE));
    const parsed = JSON.parse(readNoFollow(path.join(dir, META_FILE)).toString("utf-8")) as Record<string, unknown>;
    const { h, ...body } = parsed;
    if (!sameMac(h, sideMac(key, "meta", body))) return undefined;
    if (body.v !== SIDE_VERSION || body.run_id !== runId || body.scope !== scope) return undefined;
    if (typeof body.created_at !== "string" || Number.isNaN(Date.parse(body.created_at))) return undefined;
    return { runId, createdAt: body.created_at };
  } catch {
    return undefined;
  }
}

// ─── Lock ─────────────────────────────────────────────────────────

/** Thrown when another live process holds the run. */
export class JournalLockedError extends Error {
  constructor(public readonly pid: number) {
    super(`run journal is in use by process ${pid}; wait for it to finish (or stop it) before resuming`);
    this.name = "JournalLockedError";
  }
}

/** Start time (ms since epoch) of a process, where the OS exposes it cheaply (Linux); else undefined. */
export function processStartTime(pid: number): number | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[19]);
    const btime = Number(/^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf-8"))?.[1]);
    if (!Number.isFinite(ticks) || !Number.isFinite(btime)) return undefined;
    return btime * 1000 + ticks * 10;
  } catch {
    return undefined;
  }
}

const SELF_STARTED = processStartTime(process.pid) ?? Math.round(Date.now() - process.uptime() * 1000);
/** Start times are compared with this much slack (clock ticks, boot time rounding). */
const START_SLACK_MS = 5000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface LockHolder {
  pid: number;
  started: number;
}

function parseHolder(raw: string): LockHolder | undefined {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!Number.isInteger(p.pid) || (p.pid as number) <= 0 || typeof p.started !== "number") return undefined;
    return { pid: p.pid as number, started: p.started };
  } catch {
    return undefined;
  }
}

/**
 * Is the process that wrote this lock still running? A reused pid (other
 * start time) is not. Where the start time is not available (macOS, Windows),
 * any live process with that pid counts as the holder: a reused pid errs
 * toward refusing the resume, never toward two processes sharing the run.
 */
function holderAlive(h: LockHolder): boolean {
  if (h.pid === process.pid) return Math.abs(h.started - SELF_STARTED) <= START_SLACK_MS;
  if (!pidAlive(h.pid)) return false;
  const started = processStartTime(h.pid);
  return started === undefined || Math.abs(started - h.started) <= START_SLACK_MS;
}

/** Test seam for the lock: called after a stale lock was read, before it is taken over. */
export interface LockHooks {
  afterStaleRead?(): void;
}

/** An acquired run lock. */
export interface RunLock {
  readonly file: string;
  release(): void;
}

function readText(file: string): string | undefined {
  try {
    return readNoFollow(file).toString("utf-8");
  } catch {
    return undefined;
  }
}

/** A takeover lock older than this belongs to a process that died mid-takeover. */
const TAKEOVER_STALE_MS = 10_000;

/**
 * Take a run's lock: O_CREAT|O_EXCL in the run's private dir. A lock whose
 * process is gone is taken over under a second exclusive lock, and only if it
 * still holds the exact bytes judged stale, so two processes racing for a
 * stale lock cannot both win. Throws {@link JournalLockedError}.
 */
export function acquireRunLock(dir: string, hooks: LockHooks = {}): RunLock {
  const file = path.join(dir, LOCK_FILE);
  const mine = JSON.stringify({
    pid: process.pid,
    started: SELF_STARTED,
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  let lastPid = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      writeNew(file, mine);
      return {
        file,
        release() {
          // Only ever remove our own lock.
          if (readText(file) === mine) fs.rmSync(file, { force: true });
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const stale = readText(file);
    if (stale === undefined) continue; // released meanwhile: try again
    const holder = parseHolder(stale);
    if (holder) lastPid = holder.pid;
    if (holder && holderAlive(holder)) throw new JournalLockedError(holder.pid);
    hooks.afterStaleRead?.();
    const takeover = `${file}.takeover`;
    try {
      writeNew(takeover, mine);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.lstatSync(takeover).mtimeMs > TAKEOVER_STALE_MS) fs.rmSync(takeover, { force: true });
      } catch {
        // gone already
      }
      continue;
    }
    try {
      // Re-read under the takeover lock: remove it only if nobody replaced it since.
      if (readText(file) === stale) fs.rmSync(file, { force: true });
    } finally {
      fs.rmSync(takeover, { force: true });
    }
  }
  throw new JournalLockedError(lastPid);
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
      // defineProperty, not assignment: a key named `__proto__` stays a plain key.
      const put = (k: string, x: unknown) =>
        Object.defineProperty(out, k, { value: x, enumerable: true, writable: true, configurable: true });
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "string" && isSecretKey(k) && x.length > 0) {
          put(k, REDACTED);
          redacted = true;
        } else if (x !== undefined && typeof x !== "function") {
          put(k, walk(x, depth + 1));
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
  decider?: { mode: "on" | "off"; reason?: string };
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
        ? `run journal format v${version} predates chained records (v${JOURNAL_SCHEMA_VERSION}); it cannot be ` +
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

/** Thrown when the journal cannot be written. Fatal: the executor stops the run before anything else happens. */
export class JournalWriteError extends Error {
  constructor(message: string) {
    super(`run journal: ${message}; the run stopped so a resume cannot lose spend or repeat a write`);
    this.name = "JournalWriteError";
  }
}

// ─── Reading + recovery ───────────────────────────────────────────

export interface JournalRead {
  file: string;
  /** Authenticated, chained records only: everything a resume replays or seeds spend from. */
  records: JournalRecord[];
  /** Bytes dropped from a torn tail (0 when the file was clean). */
  truncatedBytes: number;
  /** The last record is whole and authenticated but lost its line end (repair restores it). */
  missingNewline?: boolean;
  /** The last record was missing from the journal (a crash after the head write) and was restored from the head. */
  restored?: boolean;
  /**
   * Set when an invalid record sits before valid ones (not a torn tail), or when
   * a whole record fails authentication (tampering, never a torn write). Not repairable.
   */
  corruptAtLine?: number;
  /** The line whose record failed authentication, when that is why the journal is refused. */
  forgedAtLine?: number;
}

type LineCheck = JournalRecord | "version" | "forged" | undefined;

/** Check one line as record `expectedSeq` following a record whose MAC is `prev`. Undefined = not complete JSON. */
function verifyLine(line: string, expectedSeq: number, prev: string, runId: string, key: () => Buffer): LineCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  // Complete JSON is never a torn append (no strict prefix of a record parses):
  // from here on, anything that is not this run's next record is refused.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "forged";
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.v === "number" && rec.v !== JOURNAL_SCHEMA_VERSION && expectedSeq === 1) return "version";
  if (typeof rec.v === "number" && rec.v > JOURNAL_SCHEMA_VERSION) return "version";
  if (rec.v !== JOURNAL_SCHEMA_VERSION || typeof rec.type !== "string" || typeof rec.h !== "string") return "forged";
  if (rec.seq !== expectedSeq) return "forged";
  const { h, ...body } = rec;
  if (!sameMac(h, chainMac(key(), runId, expectedSeq, prev, body))) return "forged";
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

export interface ReadJournalOptions {
  /** Truncate a torn tail on disk, restore a lost final line end, and re-append a record restored from the head. */
  repair?: boolean;
  /** The run key; default: the `key` file next to the journal. */
  key?: Buffer;
  /** The run id the records are chained to; default: the journal's directory name. */
  runId?: string;
  /**
   * The run's head; default: the authenticated `head.json` next to the journal.
   * `false` skips the length check: only for inspecting raw bytes, never on a
   * path that resumes.
   */
  head?: JournalHead | false;
}

/**
 * Read a journal from a run's private directory. Records are authenticated
 * and chained with the run key, then checked against the head: the journal
 * must end at the head's record, or one short of it (then that record is
 * restored from the head). Only an unterminated final segment that is not
 * complete JSON is a torn append; with `repair` it is cut. Throws
 * {@link JournalVersionError} for another format, {@link JournalKeyError}
 * when the key is missing and {@link JournalRollbackError} when the journal
 * was cut back or does not match its head.
 */
export function readJournal(file: string, opts: ReadJournalOptions = {}): JournalRead {
  const dir = path.dirname(path.resolve(file));
  const runId = opts.runId ?? path.basename(dir);
  const buf = readNoFollow(file);
  let key = opts.key;
  const getKey = (): Buffer => {
    key ??= loadRunKey(path.join(dir, KEY_FILE));
    return key;
  };
  const records: JournalRecord[] = [];
  const prevMac = () => (records.length > 0 ? (records[records.length - 1].h as string) : "");
  let offset = 0;
  let validBytes = 0;
  let line = 0;
  let firstBad: number | undefined;
  let corruptAtLine: number | undefined;
  let forgedAtLine: number | undefined;
  let missingNewline = false;
  const forged = (at: number) => {
    firstBad = at;
    corruptAtLine = at;
    forgedAtLine = at;
  };
  while (offset < buf.length) {
    const nl = buf.indexOf(0x0a, offset);
    line++;
    const end = nl === -1 ? buf.length : nl;
    const text = buf.subarray(offset, end).toString("utf-8");
    offset = end + 1;
    if (firstBad !== undefined) {
      // A well-formed record after a bad line: the damage is not a torn tail.
      if (corruptAtLine === undefined && looksLikeRecord(text)) corruptAtLine = firstBad;
      continue;
    }
    const rec = verifyLine(text, records.length + 1, prevMac(), runId, getKey);
    if (rec === "version") throw new JournalVersionError((JSON.parse(text) as { v?: unknown }).v);
    if (rec === "forged") forged(line);
    else if (rec === undefined) firstBad = line;
    else {
      records.push(rec);
      validBytes = Math.min(offset, buf.length);
      // Complete JSON without its line end is the next record, authenticated like any other.
      if (nl === -1) missingNewline = true;
    }
  }
  const truncatedBytes = buf.length - validBytes;

  let restored: JournalRecord | undefined;
  if (corruptAtLine === undefined && opts.head !== false) {
    const head = opts.head ?? loadJournalHead(dir, getKey(), runId);
    const n = records.length;
    if (n === head.seq - 1 && head.record) {
      // A crash after the head was written, before the journal append: the record is in the head.
      const rec = verifyLine(JSON.stringify(head.record), head.seq, prevMac(), runId, getKey);
      if (!rec || rec === "version" || rec === "forged") {
        throw new JournalRollbackError(`the run journal's head holds a record that does not follow record ${n}`);
      }
      restored = rec;
    } else if (n < head.seq) {
      throw new JournalRollbackError(
        `the run journal ends at record ${n}, but the run had written ${head.seq}: records were removed from its end (rolled back)`,
      );
    } else if (n > head.seq) {
      throw new JournalRollbackError(
        `the run journal has ${n} records, but its head is record ${head.seq}: it was not written by this run alone`,
      );
    } else if (n > 0 && records[n - 1].h !== head.record?.h) {
      throw new JournalRollbackError(`run journal record ${n} is not the record the run wrote there`);
    }
  }
  if (restored) records.push(restored);

  if (opts.repair && corruptAtLine === undefined) {
    if (truncatedBytes > 0) fs.truncateSync(file, validBytes);
    const tail = (missingNewline ? "\n" : "") + (restored ? JSON.stringify(restored) + "\n" : "");
    if (tail) appendDurably(file, tail);
  }
  return {
    file,
    records,
    truncatedBytes,
    ...(missingNewline ? { missingNewline } : {}),
    ...(restored ? { restored: true } : {}),
    ...(corruptAtLine !== undefined ? { corruptAtLine } : {}),
    ...(forgedAtLine !== undefined ? { forgedAtLine } : {}),
  };
}

function appendDurably(file: string, text: string): void {
  const c = fs.constants;
  const fd = fs.openSync(file, c.O_WRONLY | c.O_APPEND | NOFOLLOW);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
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
  /** Who chose that route, when it was a decision (#357). */
  rung?: RouteRung;
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
  /**
   * Nodes whose agent ran without an enforced sandbox in an earlier attempt.
   * Such an agent could read the run key, so the journal's spend and write
   * records are only as trustworthy as that agent.
   */
  unsandboxed: string[];
  /** The decider's mode at run start and its counters after the last journaled route (#357). */
  decider?: JournalDeciderState;
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
  "agent:unsandboxed",
  "run:end",
]);

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isAmount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isRung = (v: unknown): v is RouteRung => v === "expr" || v === "decider" || v === "agent";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isCounters = (v: unknown): v is DeciderCounters =>
  typeof v === "object" &&
  v !== null &&
  isCount((v as DeciderCounters).calls) &&
  isCount((v as DeciderCounters).failures) &&
  typeof (v as DeciderCounters).open === "boolean";

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
      case "agent:unsandboxed":
        inVisit(r);
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
        if (r.rung !== undefined && !isRung(r.rung)) bad(r, "has an unknown rung");
        if (r.decider !== undefined && !isCounters(r.decider)) bad(r, "has invalid decider counters");
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
    rung?: RouteRung;
  }
  const order: Visit[] = [];
  const byKey = new Map<string, Visit>();
  const intents = new Map<string, OutputRecord>();
  const receipts = new Map<string, OutputRecord>();
  let attempts = 1;
  let lastStatus: string | undefined;
  let deciderCounters: DeciderCounters | undefined;

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
          delete v.rung;
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
        if (v) {
          v.next = (r.to as string | null) ?? null;
          if (isRung(r.rung)) v.rung = r.rung;
        }
        // Calls already made count even if the visit later re-runs.
        if (isCounters(r.decider)) deciderCounters = r.decider;
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
        ...(v.rung ? { rung: v.rung } : {}),
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
    unsandboxed: [...new Set(records.filter((r) => r.type === "agent:unsandboxed").map((r) => String(r.node)))],
    ...(start.decider
      ? { decider: { ...start.decider, ...(deciderCounters ? { counters: { ...deciderCounters } } : {}) } }
      : {}),
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

const hasRead = (skill: Skill | undefined, name: string) =>
  !!skill?.tools.some((t) => t.name === name && t.access === "read");

/** Pages of 100 a marker lookup reads before it gives up (cannot confirm). */
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 30;

/**
 * Look for a GitHub issue or comment by its marker through the listing
 * endpoints (consistent, unlike search), page by page until the marker is
 * found, the listing ends, or it reaches back past the write. Undefined when
 * the skill has no listing tool, so the caller falls back to search. A page
 * that cannot be read is "cannot confirm" (the caller's catch).
 */
async function listGitHubForMarker(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  since: string | undefined,
  skill: Skill | undefined,
  ctx: ToolContext,
): Promise<ProbeResult | undefined> {
  const hasBody = (i: Record<string, unknown>) => typeof i.body === "string" && (i.body as string).includes(token);
  const comments = toolName === "github_add_comment";
  const tool = comments ? "github_list_issue_comments" : "github_list_issues";
  if (!hasRead(skill, tool)) return undefined;
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const query = comments
      ? { repo: args.repo, issue_number: args.issue_number, ...(since ? { since } : {}), page }
      : { repo: args.repo, per_page: LIST_PAGE_SIZE, page };
    const out = await callRead(skill, tool, query, ctx);
    if (!Array.isArray(out)) return { state: "unknown", reason: `${comments ? "comment" : "issue"} list unavailable` };
    const items = out as Array<Record<string, unknown>>;
    // Issues listing includes pull requests; a marker only ever lands in an issue.
    const hit = items.find((i) => hasBody(i) && (comments || !i.pull_request));
    if (hit) return { state: "applied", output: comments ? {} : hit };
    // The listing ended: everything since the write was seen.
    if (items.length < LIST_PAGE_SIZE) return { state: "absent" };
    // Issues come newest first: a page that reaches back past the write ends the search.
    const oldest = items.at(-1)?.created_at;
    if (!comments && since !== undefined && typeof oldest === "string" && oldest < since) return { state: "absent" };
  }
  return {
    state: "unknown",
    reason: `too many ${comments ? "comments" : "issues"} to search (more than ${LIST_MAX_PAGES * LIST_PAGE_SIZE})`,
  };
}

/**
 * Was this write applied before the crash? Writes that are idempotent by
 * nature (labels, state changes, a PR for the same head branch) are simply
 * re-applied. Creates and comments are looked up by their marker: GitHub's
 * listing endpoints first (consistent), search otherwise; Linear comments by
 * listing, Linear issues by search. A write with no lookup is `unknown`, and a
 * pending one is not re-sent without `--allow-repeat-writes`.
 */
async function probeProvider(
  toolName: string,
  args: Record<string, unknown>,
  key: string,
  skill: Skill | undefined,
  ctx: ToolContext,
  since?: string,
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
        // Prefer the listing endpoints: unlike search, they see a write the moment it lands.
        const listed = await listGitHubForMarker(toolName, args, token, since, skill, ctx);
        if (listed) return listed;
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
        // The search index lags writes: a miss is not proof the write never landed.
        if (!hit) return { state: "unknown", reason: "not in GitHub search, which can lag a just-made write" };
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
  /** Whether the run's decider ran (#357), journaled so a resume keeps the same mode. */
  decider?: { mode: "on" | "off"; reason?: string };
}

/**
 * The decider as an earlier attempt left it (#357): its mode at run start and
 * the breaker / cap counters after the last journaled route. Cap and breaker
 * are per logical run, so a resume continues them.
 */
export interface JournalDeciderState {
  mode: "on" | "off";
  reason?: string;
  counters?: DeciderCounters;
}

export interface JournalCheckpoint {
  result: NodeResult;
  intents: SafeOutputIntent[];
  agentRunFailed: boolean;
  attempt: number;
}

export type JournalReplay =
  | { kind: "complete"; result: NodeResult; next?: string | null; rung?: RouteRung }
  | ({ kind: "checkpoint" } & JournalCheckpoint);

/**
 * The executor's view of a journal (`ExecuteOptions.journal`). A hook that
 * cannot write its record throws {@link JournalWriteError}: the executor
 * stops the run there. At resume, `begin` refuses a changed run.
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
  /** The edge taken after a visit, and for a decision the rung that chose it (#357), so resume replays it. */
  route(from: string, to: string | null, rung?: RouteRung, decider?: DeciderCounters): void;
  /**
   * Spend of one agent attempt, cumulative for the attempt: `final` when the
   * attempt returned, otherwise a live report (written at once when it raises the spend).
   */
  usage?(node: string, iteration: number, attempt: number, usage: NodeUsage, final: boolean): void;
  /** The visit's agent ran without an enforced sandbox: recorded so a resume can say so. */
  uncontained?(node: string, iteration: number): void;
  /** Spend earlier attempts of this run already journaled (resume); the run budget starts from it. */
  priorSpend?(): Spend | undefined;
  /** Receipt `degraded` entries this journal adds to the run (e.g. `journal_unsandboxed`). */
  degraded?(): string[];
  /** The decider state earlier attempts of this run journaled (resume); undefined otherwise. */
  deciderResume?(): JournalDeciderState | undefined;
}

/** Test seams: a throw simulates the process dying at that point of an append. */
export interface JournalFaults {
  /** Before anything of the record reaches the disk. */
  beforeAppend?(record: JournalRecord): void;
  /** After the head holds the record, before the journal append. */
  afterHeadUpdate?(record: JournalRecord): void;
  /** Replaces the journal write (a throw is an I/O failure, not a process death). */
  writeJournal?(fd: number, line: string): void;
}

export interface RunJournalOptions {
  runId: string;
  /** The workspace the run belongs to (its real path, hashed, names the run's state dir). Default: process.cwd(). */
  cwd?: string;
  /** Workflow file the run came from, so `resume` can load it again. */
  workflowFile?: string;
  swenyVersion?: string;
  /** Environment whose secret-named values are redacted. Never written. */
  env?: Record<string, string | undefined>;
  logger?: Logger;
  faults?: JournalFaults;
  /** Journals kept per workspace (default {@link JOURNAL_KEEP}). */
  keep?: number;
  /** Where run journals live (default {@link runStateRoot}). Never inside the workspace. */
  stateRoot?: string;
}

export interface ResumeJournalOptions extends RunJournalOptions {
  read: JournalRead;
  plan: ResumePlan;
  /** The run's lock, taken before the journal was read ({@link lockRun}). */
  lock: RunLock;
  /** Resume even though the workflow, instructions, input or tools changed. */
  force?: boolean;
  /** Re-send writes whose outcome cannot be confirmed on the provider. */
  allowRepeatWrites?: boolean;
}

/** A run's journal file. */
export function journalFile(cwd: string, runId: string, root: string = runStateRoot()): string {
  return path.join(journalDir(cwd, runId, root), JOURNAL_FILE);
}

/**
 * Runs of this workspace with a journal, oldest first. Only the state dir is
 * read, and only runs whose metadata authenticates count: nothing in the
 * workspace can add, hide or reorder a run.
 */
export function listJournalRuns(cwd: string = process.cwd(), root: string = runStateRoot()): string[] {
  const scope = workspaceScope(cwd);
  const base = path.join(root, scope);
  let names: string[];
  try {
    names = fs.readdirSync(base);
  } catch {
    return [];
  }
  const runs: RunMeta[] = [];
  for (const name of names) {
    if (!RUN_ID_RE.test(name)) continue;
    const meta = loadRunMeta(path.join(base, name), name, scope);
    if (meta) runs.push(meta);
  }
  return runs
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId.localeCompare(b.runId))
    .map((r) => r.runId);
}

/** Exact run id, or a unique prefix, among this workspace's journaled runs. */
export function findJournalRun(
  ref: string,
  cwd: string = process.cwd(),
  root: string = runStateRoot(),
): string | undefined {
  const runs = listJournalRuns(cwd, root);
  if (runs.includes(ref)) return ref;
  const matches = runs.filter((r) => r.startsWith(ref));
  return matches.length === 1 ? matches[0] : undefined;
}

/** A journal an older sweny left in the workspace for this run id (or unique prefix), if any. Never read. */
export function findLegacyJournal(ref: string, cwd: string = process.cwd()): string | undefined {
  try {
    const base = path.join(cwd, LEGACY_JOURNAL_DIR);
    const hits = fs
      .readdirSync(base)
      .filter((d) => RUN_ID_RE.test(d) && (d === ref || d.startsWith(ref)))
      .filter((d) => fs.existsSync(path.join(base, d, JOURNAL_FILE)));
    return hits.length === 1 ? path.join(base, hits[0], JOURNAL_FILE) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Delete this workspace's oldest journals beyond `keep`, never `except`, by
 * their authenticated creation time. Runs whose metadata does not
 * authenticate are never deleted. Never throws.
 */
export function pruneJournals(
  cwd: string,
  keep: number = JOURNAL_KEEP,
  except?: string,
  root: string = runStateRoot(),
): number {
  const runs = listJournalRuns(cwd, root).filter((r) => r !== except);
  const extra = runs.slice(0, Math.max(0, runs.length - Math.max(0, keep - (except ? 1 : 0))));
  let removed = 0;
  for (const r of extra) {
    try {
      fs.rmSync(journalDir(cwd, r, root), { recursive: true, force: true });
      removed++;
    } catch {
      // leave it
    }
  }
  return removed;
}

/** Take a run's lock before reading its journal (resume). Throws {@link JournalLockedError}. */
export function lockRun(cwd: string, runId: string, root: string = runStateRoot(), hooks?: LockHooks): RunLock {
  return acquireRunLock(journalDir(cwd, runId, root), hooks);
}

const quietLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class RunJournal implements ExecutionJournal {
  readonly runId: string;
  readonly dir: string;
  readonly file: string;
  private readonly cwd: string;
  private readonly root: string;
  private readonly opts: RunJournalOptions;
  private readonly logger: Logger;
  private readonly resume?: { plan: ResumePlan; force: boolean; allowRepeatWrites: boolean };
  private fd: number | undefined;
  private seq = 0;
  /** MAC of the last record written: the next record chains to it. */
  private prev = "";
  /** Set once an append failed: every later append throws it again. */
  private failure: JournalWriteError | undefined;
  /** Set when a fault seam simulated the process dying: nothing more is written. */
  private killed = false;
  private began = false;
  private closed = false;
  private secrets: string[] = [];
  private consumed = new Set<string>();
  /** Per-run HMAC key; lives only here and in the run's private state dir. */
  private key: Buffer | undefined;
  private lock: RunLock | undefined;
  /** Last live usage record per attempt: time and spend, for throttling. */
  private lastUsage = new Map<string, { tokens: number; costUsd: number }>();
  /** Visits already recorded as run without an enforced sandbox. */
  private uncontainedVisits = new Set<string>();

  private constructor(opts: RunJournalOptions, resume?: ResumeJournalOptions) {
    this.opts = opts;
    this.runId = opts.runId;
    this.cwd = opts.cwd ?? process.cwd();
    this.root = opts.stateRoot ?? runStateRoot();
    this.dir = journalDir(this.cwd, opts.runId, this.root);
    this.file = path.join(this.dir, JOURNAL_FILE);
    this.logger = opts.logger ?? quietLogger;
    if (resume) {
      this.resume = {
        plan: resume.plan,
        force: resume.force === true,
        allowRepeatWrites: resume.allowRepeatWrites === true,
      };
      this.lock = resume.lock;
      const records = resume.read.records;
      this.seq = records.length;
      this.prev = records.length > 0 ? (records[records.length - 1].h as string) : "";
      this.key = loadRunKey(path.join(this.dir, KEY_FILE));
    }
  }

  /** A journal for a new run. Nothing touches disk until the executor calls `begin`. */
  static create(opts: RunJournalOptions): RunJournal {
    return new RunJournal(opts);
  }

  /** A journal that continues `opts.read` (already repaired, under `opts.lock`) under the resume plan. */
  static openForResume(opts: ResumeJournalOptions): RunJournal {
    return new RunJournal(opts, opts);
  }

  /** False once an append failed (or the process was simulated dead): the run cannot be resumed past that point. */
  get active(): boolean {
    return !this.failure && !this.killed;
  }

  private releaseLock(): void {
    try {
      this.lock?.release();
    } catch {
      // nothing to do
    }
    this.lock = undefined;
  }

  /** Mark the journal failed and throw: the run must stop here. */
  private fail(what: string, err?: unknown): never {
    this.failure = new JournalWriteError(err === undefined ? what : `${what} (${errText(err)})`);
    this.closeFd();
    this.logger.error(`  ${this.failure.message}`);
    throw this.failure;
  }

  private simulatedDeath(err: unknown): never {
    // Test seam: nothing after this point reaches the disk.
    this.killed = true;
    this.closeFd();
    this.releaseLock();
    throw err;
  }

  private append(type: string, fields: Record<string, unknown>): void {
    if (this.failure) throw this.failure;
    if (this.killed) return;
    if (!this.key) return this.fail("no signing key for this run");
    const body: Record<string, unknown> = {
      v: JOURNAL_SCHEMA_VERSION,
      seq: this.seq + 1,
      type,
      at: new Date().toISOString(),
      ...fields,
    };
    const h = chainMac(this.key, this.runId, this.seq + 1, this.prev, body);
    const record = { ...body, h } as unknown as JournalRecord;
    if (this.opts.faults?.beforeAppend) {
      try {
        this.opts.faults.beforeAppend(record);
      } catch (err) {
        this.simulatedDeath(err);
      }
    }
    // Head first: a crash before the journal append leaves the record recoverable, never lost.
    try {
      writeJournalHead(this.dir, this.key, this.runId, { seq: this.seq + 1, record });
    } catch (err) {
      this.fail(`could not write the head file in ${this.dir}`, err);
    }
    if (this.opts.faults?.afterHeadUpdate) {
      try {
        this.opts.faults.afterHeadUpdate(record);
      } catch (err) {
        this.simulatedDeath(err);
      }
    }
    try {
      if (this.fd === undefined) {
        const c = fs.constants;
        this.fd = fs.openSync(this.file, c.O_WRONLY | c.O_APPEND | c.O_CREAT | NOFOLLOW, 0o600);
      }
      const line = JSON.stringify(record) + "\n";
      if (this.opts.faults?.writeJournal) this.opts.faults.writeJournal(this.fd, line);
      else fs.writeSync(this.fd, line);
      fs.fsyncSync(this.fd);
    } catch (err) {
      this.fail(`could not write ${this.file}`, err);
    }
    this.seq++;
    this.prev = h;
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
          this.killed = true;
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
      makePrivateDir(this.dir);
      assertStateOutsideWorkspace(this.dir, this.cwd);
    } catch (err) {
      if (err instanceof JournalLocationError) return this.fail(err.message);
      return this.fail(
        `could not set up the run's journal in ${this.dir}; set SWENY_STATE_DIR to a writable dir, ` +
          `or pass --no-journal (the run then cannot be resumed)`,
        err,
      );
    }
    try {
      this.lock = acquireRunLock(this.dir);
      const key = createRunKey(path.join(this.dir, KEY_FILE));
      writeRunMeta(this.dir, key, this.runId, workspaceScope(this.cwd));
      writeJournalHead(this.dir, key, this.runId, { seq: 0, record: null });
      this.key = key;
    } catch (err) {
      this.releaseLock();
      this.fail(
        `could not set up the run's journal in ${this.dir}; set SWENY_STATE_DIR to a writable dir, ` +
          `or pass --no-journal (the run then cannot be resumed)`,
        err,
      );
    }
    pruneJournals(this.cwd, this.opts.keep ?? JOURNAL_KEEP, this.runId, this.root);
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
      ...(info.decider ? { decider: info.decider } : {}),
    });
  }

  deciderResume(): JournalDeciderState | undefined {
    return this.resume?.plan.decider;
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
        ...(visit.rung ? { rung: visit.rung } : {}),
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

  route(from: string, to: string | null, rung?: RouteRung, decider?: DeciderCounters): void {
    this.append("route", { from, to, ...(rung ? { rung } : {}), ...(decider ? { decider } : {}) });
  }

  /**
   * Journal one usage report, synchronously, whenever it raises the attempt's
   * spend (reports are cumulative; the largest figure seen per unit counts).
   * Nothing is held back: harnesses report once per model turn (Claude Code
   * per assistant message, ACP per usage update), so every turn's spend is on
   * disk before the next turn runs, and a process killed at any point has lost
   * at most the turn it was in.
   */
  usage(node: string, iteration: number, attempt: number, usage: NodeUsage, final: boolean): void {
    const s = spendOf(usage);
    if (s.tokens === undefined && s.costUsd === undefined) return;
    const tokens = s.tokens ?? 0;
    const costUsd = s.costUsd ?? 0;
    const k = `${visitKey(node, iteration)}|${attempt}`;
    const last = this.lastUsage.get(k);
    if (last && tokens <= last.tokens && costUsd <= last.costUsd) return;
    this.lastUsage.set(k, {
      tokens: Math.max(tokens, last?.tokens ?? 0),
      costUsd: Math.max(costUsd, last?.costUsd ?? 0),
    });
    this.append("usage", { node, iteration, attempt, tokens, cost_usd: costUsd, final });
  }

  uncontained(node: string, iteration: number): void {
    const k = visitKey(node, iteration);
    if (this.uncontainedVisits.has(k)) return;
    this.uncontainedVisits.add(k);
    this.append("agent:unsandboxed", { node, iteration });
  }

  degraded(): string[] {
    const nodes = this.resume?.plan.unsandboxed ?? [];
    if (nodes.length === 0) return [];
    return [
      `journal_unsandboxed: an earlier attempt ran ${nodes.join(", ")} without an enforced sandbox, so its ` +
        `journaled spend and write records could have been edited by that agent`,
    ];
  }

  priorSpend(): Spend | undefined {
    return this.resume ? { ...this.resume.plan.priorSpend } : undefined;
  }

  /** Close the run: `run:end` (when the journal still works), then release the lock. Never throws. */
  end(status: "success" | "failed" | "crashed"): void {
    if (this.began && !this.closed && this.active) {
      try {
        this.append("run:end", { status });
      } catch {
        // already reported by append
      }
    }
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
          // Look back from a little before the intent (clock skew between this host and the provider).
          const intentAt = Date.parse(String(plan?.intents.get(key)?.at ?? ""));
          const since = Number.isFinite(intentAt) ? new Date(intentAt - 5 * 60_000).toISOString() : undefined;
          const probe = await probeProvider(tool.name, (args ?? {}) as Record<string, unknown>, key, skill, ctx, since);
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
        // A write the journal cannot record is never sent: append throws first.
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
