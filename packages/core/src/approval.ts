/**
 * The CLI publisher (RFC 0002 M2, #576): `sweny publish <run> [--approve]`.
 *
 * A run in approval mode froze its writes into bundles (`approval-bundle.ts`)
 * and ended each visit with `pending` receipts naming a digest. Publishing a
 * run, for each bundle its authenticated journal names:
 *
 * 1. verifies the bundle's bytes against the digest and the visit it claims;
 * 2. refuses expired bundles and runs whose agent ran without an enforced
 *    sandbox (such an agent could have rewritten the run's state);
 * 3. prints the exact calls it would make;
 * 4. with `approve`: authenticates `local:<os user>` against the declared
 *    approvers, consumes the visit's one approval by creating
 *    `<state>/approvals/<proposal key>` with `O_EXCL`, and sends each call
 *    byte for byte, recording an intent before and a receipt after every send.
 *
 * At most once: a send is never repeated. A second publish of the same visit
 * finds the approval consumed and sends nothing; it reports what the first
 * one recorded, and a write with an intent but no receipt (the process died
 * between the send and its receipt) as `unknown: not resent`. Bundle files the
 * journal does not name (orphans of a crash before `node:end`, or planted)
 * are reported and never sent.
 *
 * The consumption marker protects one state root on one machine. It does not
 * protect against a copied state root, or the OS user deleting it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger, Skill, ToolContext } from "./types.js";
import { isRefusal, refusalReason } from "./types.js";
import { JOURNAL_FILE, journalDir, readJournal, runStateRoot, type JournalRecord } from "./journal.js";
import { actorTrusted, refOf, urlOf } from "./safe-outputs.js";
import { BUNDLES_DIR, proposalKey, sha256Hex, type ApprovalBundle, type BundleWrite } from "./approval-bundle.js";

export { BUNDLES_DIR, type ApprovalBundle, type BundleWrite } from "./approval-bundle.js";

/** Test seams: a throw simulates the process dying at that point. */
export interface PublishFaults {
  /** After write `n`'s send returned, before its receipt reaches the disk. */
  afterSend?(n: number): void;
}

/** What happened to one frozen write. */
export interface PublishReceipt {
  n: number;
  type: string;
  via: string;
  target?: string;
  /**
   * `unknown`: its send started and no receipt was recorded (a crash), so it
   * may have gone out; it is never resent. `not sent`: the publish stopped
   * before it.
   */
  status: "sent" | "failed" | "refused" | "unknown" | "not sent";
  reason?: string;
  ref?: string | number;
  url?: string;
}

export type BundleState = "awaiting approval" | "published" | "incomplete" | "already published" | "refused";

export interface PublishedBundle {
  digest: string;
  node: string;
  iteration: number;
  state: BundleState;
  /** Why it was refused. Fixed wording. */
  reason?: string;
  /** Who approved it (`local:<os user>`). */
  approver?: string;
  writes: BundleWrite[];
  /** Per write, once it was approved (this publish or an earlier one). */
  receipts?: PublishReceipt[];
}

export interface PublishResult {
  bundles: PublishedBundle[];
  /** Bundle files the run's journal does not name: never sent. */
  orphans: string[];
}

export interface PublishRunOptions {
  runId: string;
  /** The run's workspace (its real path names the run's state dir). Default: process.cwd(). */
  cwd?: string;
  /** Where run journals live (default {@link runStateRoot}). Approvals live beside it. */
  stateRoot?: string;
  /** Send. Without it the bundles are verified and printed, nothing more. */
  approve: boolean;
  /** Skills that send the writes (their write tools are called directly, never through the journal wrapper). */
  skills: Map<string, Skill>;
  config: Record<string, string>;
  logger: Logger;
  /** The approving OS user. Default: `os.userInfo().username`. */
  user?: string;
  /** Where the printout goes. Default: the logger. */
  print?: (line: string) => void;
  now?: () => number;
  faults?: PublishFaults;
  /** The operator's GITHUB_API_URL, for GitHub writes on GHES. */
  githubApiUrl?: string;
}

/** The approvals dir for a state root: `<state>/approvals`, beside `<state>/runs`. */
export function approvalsDir(stateRoot: string = runStateRoot()): string {
  return path.join(path.dirname(stateRoot), "approvals");
}

interface LogLine {
  t: "approved" | "intent" | "sent" | "failed" | "refused";
  n?: number;
  digest?: string;
  by?: string;
  at?: string;
  reason?: string;
  ref?: string | number;
  url?: string;
}

function readLog(file: string): LogLine[] {
  const out: LogLine[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LogLine);
    } catch {
      // A torn last line (the process died mid-write): what it recorded did not happen for sure.
    }
  }
  return out;
}

/** An append-only, fsynced log: the consumption marker and every send's intent and receipt. */
class ApprovalLog {
  private constructor(private readonly fd: number) {}

  /** Consume the approval: `O_EXCL`, so exactly one publish ever gets it. Undefined when it was already consumed. */
  static consume(file: string): ApprovalLog | undefined {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const c = fs.constants;
    try {
      return new ApprovalLog(
        fs.openSync(file, c.O_WRONLY | c.O_APPEND | c.O_CREAT | c.O_EXCL | (c.O_NOFOLLOW ?? 0), 0o600),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return undefined;
      throw err;
    }
  }

  append(line: LogLine): void {
    fs.writeSync(this.fd, JSON.stringify(line) + "\n");
    fs.fsyncSync(this.fd);
  }

  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      // already closed
    }
  }
}

/** Each write's outcome as the log records it. */
export function receiptsFromLog(writes: BundleWrite[], log: LogLine[]): PublishReceipt[] {
  return writes.map((w) => {
    const base = { n: w.n, type: w.type, via: w.via, ...(w.target ? { target: w.target } : {}) };
    const done = [...log].reverse().find((l) => l.n === w.n && l.t !== "intent" && l.t !== "approved");
    if (done) {
      return {
        ...base,
        status: done.t as "sent" | "failed" | "refused",
        ...(done.reason ? { reason: done.reason } : {}),
        ...(done.ref !== undefined ? { ref: done.ref } : {}),
        ...(done.url ? { url: done.url } : {}),
      };
    }
    if (log.some((l) => l.t === "intent" && l.n === w.n)) return { ...base, status: "unknown", reason: "not resent" };
    return { ...base, status: "not sent", reason: "the publish stopped before it" };
  });
}

/** Visits whose authenticated `node:end` names a digest in a `pending` receipt, in journal order. */
function namedBundles(records: JournalRecord[]): Map<string, { node: string; iteration: number }> {
  const named = new Map<string, { node: string; iteration: number }>();
  for (const r of records) {
    if (r.type !== "node:end") continue;
    const outputs = (r.result as { outputs?: unknown } | undefined)?.outputs;
    if (!Array.isArray(outputs)) continue;
    for (const o of outputs as { status?: unknown; digest?: unknown }[]) {
      if (o?.status === "pending" && typeof o.digest === "string" && /^[0-9a-f]{64}$/.test(o.digest)) {
        if (!named.has(o.digest)) named.set(o.digest, { node: r.node as string, iteration: r.iteration as number });
      }
    }
  }
  return named;
}

/**
 * Whether any map child generation of the run recorded an agent without an
 * enforced sandbox (#576: children's write requests reach the parent's bundle).
 * A raw scan: a child's records chain to its own run id, which only its `run:start` names.
 */
function childRanUnsandboxed(childrenDir: string): boolean {
  if (!fs.existsSync(childrenDir)) return false;
  for (const slot of fs.readdirSync(childrenDir)) {
    const slotDir = path.join(childrenDir, slot);
    if (!fs.statSync(slotDir).isDirectory()) continue;
    for (const gen of fs.readdirSync(slotDir)) {
      const file = path.join(slotDir, gen, JOURNAL_FILE);
      if (fs.existsSync(file) && fs.readFileSync(file, "utf-8").includes('"type":"agent:unsandboxed"')) return true;
    }
  }
  return false;
}

const label = (w: BundleWrite) => `[${w.n}] ${w.type} via ${w.via}${w.target ? ` -> ${w.target}` : ""}`;

/** Verify, print and (with `approve`) send every bundle a run's journal names. */
export async function publishRun(o: PublishRunOptions): Promise<PublishResult> {
  const root = o.stateRoot ?? runStateRoot();
  const cwd = o.cwd ?? process.cwd();
  const dir = journalDir(cwd, o.runId, root);
  const print = o.print ?? ((l: string) => o.logger.info(l));
  const now = (o.now ?? Date.now)();
  const file = path.join(dir, JOURNAL_FILE);
  if (!fs.existsSync(file)) throw new Error(`no run journal for ${o.runId} in this workspace`);
  const read = readJournal(file);
  if (read.corruptAtLine !== undefined || read.forgedAtLine !== undefined) {
    throw new Error(`the journal of run ${o.runId} fails authentication; nothing is published`);
  }
  const unsandboxed =
    read.records.some((r) => r.type === "agent:unsandboxed") || childRanUnsandboxed(path.join(dir, "children"));
  const named = namedBundles(read.records);

  const bundleDir = path.join(dir, BUNDLES_DIR);
  const onDisk = fs.existsSync(bundleDir)
    ? fs
        .readdirSync(bundleDir)
        .filter((f) => /^[0-9a-f]{64}\.json$/.test(f))
        .map((f) => f.slice(0, 64))
    : [];
  const orphans = onDisk.filter((d) => !named.has(d)).sort();
  for (const d of orphans) print(`! bundle ${d}: not named by the run's journal (orphan); never sent`);
  if (named.size === 0) print(`run ${o.runId} has no bundle waiting for approval`);

  const approver = `local:${o.user ?? os.userInfo().username}`;
  const bundles: PublishedBundle[] = [];
  for (const [digest, visit] of named) {
    const refused = (reason: string, writes: BundleWrite[] = []): void => {
      print(`✗ bundle ${digest} (${visit.node}): refused, ${reason}`);
      bundles.push({ digest, ...visit, state: "refused", reason, writes });
    };
    const bfile = path.join(bundleDir, `${digest}.json`);
    if (!fs.existsSync(bfile)) {
      refused("bundle file missing");
      continue;
    }
    const bytes = fs.readFileSync(bfile);
    if (sha256Hex(bytes) !== digest) {
      refused("bundle bytes do not match its digest");
      continue;
    }
    let bundle: ApprovalBundle;
    try {
      bundle = JSON.parse(bytes.toString("utf-8")) as ApprovalBundle;
    } catch {
      refused("bundle is not JSON");
      continue;
    }
    const p = bundle.proposal;
    if (
      p?.run !== o.runId ||
      p.node !== visit.node ||
      p.iteration !== visit.iteration ||
      !Array.isArray(bundle.writes)
    ) {
      refused("bundle does not belong to this visit");
      continue;
    }
    const writes = bundle.writes;
    const logFile = path.join(approvalsDir(root), proposalKey(p));

    print(`bundle ${digest}`);
    print(
      `  run ${p.run}, node ${p.node} (visit ${p.iteration}), created ${bundle.created_at}, expires ${bundle.expires_at}`,
    );
    for (const w of writes) {
      print(`  ${label(w)}: ${w.tool}`);
      print(`      ${JSON.stringify(w.args)}`);
    }

    if (fs.existsSync(logFile)) {
      const receipts = receiptsFromLog(writes, readLog(logFile));
      const by = readLog(logFile).find((l) => l.t === "approved")?.by;
      print(`  already published${by ? ` (approved by ${by})` : ""}; nothing is sent again`);
      printReceipts(receipts, print);
      bundles.push({
        digest,
        ...visit,
        state: "already published",
        ...(by ? { approver: by } : {}),
        writes,
        receipts,
      });
      continue;
    }
    if (unsandboxed) {
      refused("the run had an agent without an enforced sandbox", writes);
      continue;
    }
    const expires = Date.parse(bundle.expires_at);
    if (!Number.isFinite(expires) || now > expires) {
      refused("bundle expired", writes);
      continue;
    }
    if (!o.approve) {
      print(`  awaiting approval: sweny publish ${o.runId} --approve`);
      bundles.push({ digest, ...visit, state: "awaiting approval", writes });
      continue;
    }
    if (bundle.approvers?.length && !actorTrusted({ trusted_actors: bundle.approvers }, { login: approver })) {
      refused("approver not trusted", writes);
      continue;
    }
    const tools = writes.map((w) => o.skills.get(w.via)?.tools.find((t) => t.name === w.tool && t.access === "write"));
    const missing = writes.find((_, i) => !tools[i]);
    if (missing) {
      refused(`skill ${missing.via} is not configured`, writes);
      continue;
    }

    const log = ApprovalLog.consume(logFile);
    if (!log) {
      // Another publish consumed it between the check above and here.
      const receipts = receiptsFromLog(writes, readLog(logFile));
      printReceipts(receipts, print);
      bundles.push({ digest, ...visit, state: "already published", writes, receipts });
      continue;
    }
    try {
      log.append({ t: "approved", digest, by: approver, at: new Date(now).toISOString() });
      print(`  approved by ${approver}`);
      const ctx: ToolContext = {
        config: o.config,
        logger: o.logger,
        ...(o.githubApiUrl ? { githubApiUrl: o.githubApiUrl } : {}),
      };
      for (const [i, w] of writes.entries()) {
        // The intent is on disk before the send: a crash after it reads as unknown, never as unsent.
        log.append({ t: "intent", n: w.n });
        let output: unknown;
        try {
          output = await tools[i]!.handler(w.args, ctx);
        } catch (err) {
          o.logger.warn(`  ${label(w)} failed: ${err instanceof Error ? err.message : String(err)}`);
          log.append({ t: "failed", n: w.n, reason: "send failed" });
          break;
        }
        o.faults?.afterSend?.(w.n);
        if (isRefusal(output)) {
          log.append({ t: "refused", n: w.n, reason: refusalReason(output) });
          break;
        }
        const ref = refOf(output);
        const url = urlOf(output);
        log.append({ t: "sent", n: w.n, ...(ref !== undefined ? { ref } : {}), ...(url ? { url } : {}) });
      }
    } finally {
      log.close();
    }
    const receipts = receiptsFromLog(writes, readLog(logFile));
    printReceipts(receipts, print);
    bundles.push({
      digest,
      ...visit,
      state: receipts.every((r) => r.status === "sent") ? "published" : "incomplete",
      approver,
      writes,
      receipts,
    });
  }
  return { bundles, orphans };
}

function printReceipts(receipts: PublishReceipt[], print: (l: string) => void): void {
  for (const r of receipts) {
    const where = r.target ? ` -> ${r.target}` : "";
    const extra = r.status === "sent" ? (r.url ?? (r.ref !== undefined ? String(r.ref) : "")) : (r.reason ?? "");
    print(`  [${r.n}] ${r.type}${where}: ${r.status}${extra ? `: ${extra}` : ""}`);
  }
}
