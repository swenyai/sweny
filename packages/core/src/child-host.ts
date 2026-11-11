/**
 * Child-run hosts for map nodes (#575, RFC 0002 M1).
 *
 * {@link createJournalChildHost}: each child is a journaled run in a slot under
 * the parent run's private directory, one directory per generation:
 *
 *   <state>/runs/<ws>/<parent run>/children/<sha256(logical id)[:16]>/g<N>/
 *
 * A generation is an ordinary run directory (key, head, meta, lock, journal)
 * whose run id `<logical id>@g<N>` is bound into every record's chain MAC, and
 * whose `run:start` names its parent. `pruneJournals` removes the slots with
 * the parent. Which generation a child gets is {@link childAction}; the slot
 * lock is held while it is decided.
 *
 * {@link createMemoryChildHost}: no journal (`--no-journal`, tests): every
 * child is generation 1 and nothing resumes.
 */

import fs from "node:fs";
import path from "node:path";

import {
  RunJournal,
  acquireRunLock,
  buildResumePlan,
  journalDir,
  journaledSpend,
  loadJournalHead,
  loadRunKey,
  readJournal,
  runStateRoot,
  JOURNAL_FILE,
  type JournalRecord,
} from "./journal.js";
import {
  childAction,
  generationRunId,
  type ChildRun,
  type ChildRunHost,
  type ChildRunRef,
  type GenerationState,
} from "./map.js";
import type { AgentHarness } from "./harness/types.js";
import type { Logger, Observer } from "./types.js";

export interface JournalChildHostOptions {
  /** The parent run's id (its journal's run id). */
  parentRunId: string;
  /** The workspace (the parent journal's `cwd`). Default: process.cwd(). */
  cwd?: string;
  /** Where run journals live. Default {@link runStateRoot}. */
  stateRoot?: string;
  /** The parent run's directory (`RunJournal.dir`). Default: derived from `cwd`, `stateRoot` and `parentRunId`. */
  parentDir?: string;
  swenyVersion?: string;
  /** Environment whose secret-named values the child journals redact. Never written. */
  env?: Record<string, string | undefined>;
  logger?: Logger;
  /** A fresh harness per child. Absent: children use the parent's. */
  harness?: () => AgentHarness;
  /** Receives each child's own events. */
  observer?: (ref: ChildRunRef, generation: number) => Observer | undefined;
}

const GEN_RE = /^g([1-9][0-9]*)$/;

/** The generation numbers in a slot, ascending. */
function generationsIn(slotDir: string): number[] {
  let names: string[];
  try {
    names = fs.readdirSync(slotDir);
  } catch {
    return [];
  }
  return names
    .map((n) => GEN_RE.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/**
 * What one generation's journal shows (see {@link GenerationState}). A
 * directory whose key or head was never written, or whose head is at seq 0,
 * is `empty`: the crash came before the first record, so nothing was spent.
 * A journal that fails authentication throws.
 */
export function generationState(dir: string, runId: string): GenerationState {
  const file = path.join(dir, JOURNAL_FILE);
  let key: Buffer;
  try {
    key = loadRunKey(path.join(dir, "key"));
  } catch {
    // No key: empty, unless records exist, which must never be forgotten (their spend) or resumed.
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      throw new Error(`child run ${runId}: its journal has records but no key; start a new parent run`);
    }
    return "empty";
  }
  if (!fs.existsSync(path.join(dir, "head.json"))) return "empty";
  const head = loadJournalHead(dir, key, runId);
  if (head.seq === 0) return "empty";
  const read = readJournal(file, { key, runId, head });
  if (read.forgedAtLine !== undefined || read.corruptAtLine !== undefined) {
    throw new Error(`child run ${runId}: its journal is damaged or was edited; start a new parent run`);
  }
  return stateOf(read.records);
}

function stateOf(records: JournalRecord[]): GenerationState {
  const last = records[records.length - 1];
  if (!last || last.type !== "run:end") return "unfinished";
  if (last.status === "success") return "success";
  if (last.status === "failed") return "failed";
  return "unfinished";
}

/** A host whose children are journaled runs in slots under the parent run (see the file comment). */
export function createJournalChildHost(opts: JournalChildHostOptions): ChildRunHost {
  const cwd = opts.cwd ?? process.cwd();
  const root = opts.stateRoot ?? runStateRoot();
  const childrenDir = path.join(opts.parentDir ?? journalDir(cwd, opts.parentRunId, root), "children");
  const slotDir = (ref: ChildRunRef) => path.join(childrenDir, ref.slot);
  const genDir = (ref: ChildRunRef, n: number) => path.join(slotDir(ref), `g${n}`);

  const open = async (ref: ChildRunRef, { fresh, force }: { fresh: boolean; force?: boolean }): Promise<ChildRun> => {
    const slot = slotDir(ref);
    fs.mkdirSync(slot, { recursive: true, mode: 0o700 });
    const slotLock = acquireRunLock(slot);
    let journal: RunJournal;
    let generation: number;
    let action: ReturnType<typeof childAction>;
    try {
      const gens = generationsIn(slot);
      const latest = gens.length > 0 ? gens[gens.length - 1] : undefined;
      const state =
        latest === undefined ? undefined : generationState(genDir(ref, latest), generationRunId(ref, latest));
      action = childAction(state, fresh);
      generation = action === "launch" ? 1 : action === "retry" ? latest! + 1 : latest!;
      const dir = genDir(ref, generation);
      const runId = generationRunId(ref, generation);
      const base = {
        runId,
        cwd,
        dir,
        stateRoot: root,
        prune: false,
        ...(opts.swenyVersion ? { swenyVersion: opts.swenyVersion } : {}),
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.logger ? { logger: opts.logger } : {}),
      };
      if (action === "recreate") fs.rmSync(dir, { recursive: true, force: true });
      if (action === "resume" || action === "replay") {
        const lock = acquireRunLock(dir);
        try {
          const read = readJournal(path.join(dir, JOURNAL_FILE), { repair: true, runId });
          if (read.forgedAtLine !== undefined || read.corruptAtLine !== undefined) {
            throw new Error(`child run ${runId}: its journal is damaged or was edited; start a new parent run`);
          }
          journal = RunJournal.openForResume({
            ...base,
            read,
            plan: buildResumePlan(read.records),
            lock,
            force: force === true,
          });
        } catch (err) {
          lock.release();
          throw err;
        }
      } else {
        journal = RunJournal.create({
          ...base,
          parent: {
            run: ref.parentRun,
            node: ref.node,
            iteration: ref.iteration,
            key: ref.key,
            generation,
            items_hash: ref.itemsHash,
          },
        });
      }
    } finally {
      slotLock.release();
    }
    const harness = opts.harness?.();
    const observer = opts.observer?.(ref, generation);
    return {
      runId: generationRunId(ref, generation),
      generation,
      action,
      journal,
      ...(harness ? { harness } : {}),
      ...(observer ? { observer } : {}),
      end: (status) => journal.end(status),
      detach: () => journal.detach(),
      crashed: () => journal.detach(),
    };
  };

  const spent = (refs: ChildRunRef[]) => {
    const total = { tokens: 0, costUsd: 0 };
    for (const ref of refs) {
      for (const n of generationsIn(slotDir(ref))) {
        const dir = genDir(ref, n);
        const runId = generationRunId(ref, n);
        try {
          if (generationState(dir, runId) === "empty") continue;
          const s = journaledSpend(readJournal(path.join(dir, JOURNAL_FILE), { runId }).records);
          total.tokens += s.tokens;
          total.costUsd += s.costUsd;
        } catch {
          // A generation that cannot be read adds nothing here; opening its slot reports it.
        }
      }
    }
    return total;
  };

  return { runId: opts.parentRunId, open, spent };
}

export interface MemoryChildHostOptions {
  /** The parent run's id. Default `run`. */
  runId?: string;
  harness?: () => AgentHarness;
  observer?: (ref: ChildRunRef, generation: number) => Observer | undefined;
}

/** A host with no journal: every child is a new generation 1, nothing resumes, nothing is spent before. */
export function createMemoryChildHost(opts: MemoryChildHostOptions = {}): ChildRunHost {
  return {
    runId: opts.runId ?? "run",
    open: async (ref) => {
      const harness = opts.harness?.();
      const observer = opts.observer?.(ref, 1);
      return {
        runId: generationRunId(ref, 1),
        generation: 1,
        action: "launch",
        ...(harness ? { harness } : {}),
        ...(observer ? { observer } : {}),
        end: () => {},
        detach: () => {},
        crashed: () => {},
      };
    },
  };
}
