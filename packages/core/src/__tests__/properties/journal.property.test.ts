// Property-based and adversarial tests for the run journal (journal.ts):
// any truncation recovers to the last complete record, damage in the middle is
// refused (never a silently skipped node), replay never marks a visit
// succeeded unless the journal recorded it as succeeded, and (checked against
// the run's head pointer) no suffix of the journal can be cut away unnoticed.

import { describe, it, expect, afterAll } from "vitest";
import * as fc from "fast-check";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JOURNAL_FILE,
  JOURNAL_SCHEMA_VERSION,
  JournalRollbackError,
  JournalVersionError,
  RunJournal,
  buildResumePlan,
  journalDir,
  loadRunKey,
  readJournal,
  runKeyFile,
  type JournalHead,
  type JournalRecord,
} from "../../journal.js";
import { createWriteStageState } from "../../safe-outputs.js";
import type { NodeResult, Workflow } from "../../types.js";
import { params } from "./config.js";

const root = mkdtempSync(join(tmpdir(), "sweny-journal-prop-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const file = join(root, "journal.ndjson");
// Records are authenticated with a per-run key; built journals use this one.
const KEY = randomBytes(32);
// The two exhaustive specs read the journal once per byte (a few thousand
// authenticated reads, each a file write + read); 5s is too tight on slow runners.
const EXHAUSTIVE_TIMEOUT_MS = 60_000;
process.env.SWENY_STATE_DIR = join(root, "state");

// ─── Building valid journals ─────────────────────────────────────

type Status = "success" | "failed" | "skipped";

interface Step {
  node: string;
  status: Status;
  checkpoint: boolean;
  end: boolean;
  route: "none" | "next" | "end";
  restart: boolean;
  resume: boolean;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  node: fc.constantFrom("a", "b", "c"),
  status: fc.constantFrom<Status>("success", "failed", "skipped"),
  checkpoint: fc.boolean(),
  end: fc.boolean(),
  route: fc.constantFrom<"none" | "next" | "end">("none", "next", "end"),
  restart: fc.boolean(),
  resume: fc.boolean(),
});

const scriptArb = fc.record({
  steps: fc.array(stepArb, { minLength: 1, maxLength: 10 }),
  runEnd: fc.constantFrom<"success" | "failed" | "crashed" | undefined>(undefined, "success", "failed", "crashed"),
});

const result = (status: Status): NodeResult => ({ status, data: {}, toolCalls: [] });

/** What a correct reader must conclude about each visit: key -> its last node:end status. */
function modelEnds(records: Array<Record<string, unknown>>): Map<string, Status | undefined> {
  const ends = new Map<string, Status | undefined>();
  for (const r of records) {
    const key = `${String(r.node)}#${String(r.iteration)}`;
    if (r.type === "node:start") ends.set(key, undefined);
    else if (r.type === "node:end" && ends.has(key)) ends.set(key, (r.result as NodeResult).status);
  }
  return ends;
}

interface Built {
  /** One serialized record per line, newline included. */
  lines: string[];
  /** The records as parsed back from the lines. */
  records: JournalRecord[];
}

function buildJournal(script: { steps: Step[]; runEnd?: "success" | "failed" | "crashed" }): Built {
  const raw: Array<{ type: string; fields: Record<string, unknown> }> = [
    {
      type: "run:start",
      fields: {
        run_id: "20260930-120000-0a0b0c",
        workflow_id: "w",
        workflow_entry: "a",
        workflow_hash: "h",
        instruction_hash: "h",
        input_hash: "h",
        tools_hash: "h",
        input: {},
        input_redacted: false,
      },
    },
  ];
  // Only sequences the executor can write (checkRecordSequence refuses the rest):
  // a new visit starts where the last route pointed; a visit is restarted only
  // after a resume, when it never ended or ended failed without a route.
  const counts: Record<string, number> = {};
  let prev: { node: string; iteration: number; ended: boolean; failed: boolean; routed: boolean } | undefined;
  let next: string | null = "a";
  let resumed = false;
  const checkpointed = new Set<string>();
  for (const s of script.steps) {
    if (s.resume) {
      raw.push({ type: "run:resume", fields: {} });
      resumed = true;
    }
    const canRestart = resumed && !!prev && (!prev.ended || (prev.failed && !prev.routed));
    let visit: { node: string; iteration: number };
    if (s.restart && canRestart) visit = { node: prev!.node, iteration: prev!.iteration };
    else {
      if (prev && (!prev.ended || !prev.routed)) continue;
      if (next === null) continue;
      counts[next] = (counts[next] ?? 0) + 1;
      visit = { node: next, iteration: counts[next] };
    }
    resumed = false;
    prev = { ...visit, ended: false, failed: false, routed: false };
    raw.push({ type: "node:start", fields: { ...visit } });
    const key = `${visit.node}#${visit.iteration}`;
    if (s.checkpoint && !checkpointed.has(key)) {
      checkpointed.add(key);
      raw.push({
        type: "node:checkpoint",
        fields: { ...visit, result: result(s.status), intents: [], agent_failed: false, attempt: 1 },
      });
    }
    if (s.end) {
      raw.push({
        type: "node:end",
        fields: { ...visit, result: result(s.status), write_state: { counts: [], total: 0, seen: [] } },
      });
      prev.ended = true;
      prev.failed = s.status === "failed";
      if (s.route !== "none") {
        const to = s.route === "end" ? null : visit.node === "a" ? "b" : "a";
        raw.push({ type: "route", fields: { from: visit.node, to } });
        prev.routed = true;
        next = to;
      }
    }
  }
  if (script.runEnd) raw.push({ type: "run:end", fields: { status: script.runEnd } });

  const lines = raw.map((r, i) => {
    const body = { v: JOURNAL_SCHEMA_VERSION, seq: i + 1, type: r.type, at: "2026-09-30T00:00:00.000Z", ...r.fields };
    const h = createHmac("sha256", KEY).update(JSON.stringify(body)).digest("hex");
    return JSON.stringify({ ...body, h }) + "\n";
  });
  return { lines, records: lines.map((l) => JSON.parse(l) as JournalRecord) };
}

/**
 * Parse raw bytes with the key but without a head pointer: the record-level
 * invariants hold whatever the head says. The head-pointer properties pass one.
 */
function readBytes(buf: Buffer, opts?: { repair?: boolean; head?: JournalHead | false }, key: Buffer = KEY) {
  writeFileSync(file, buf);
  return readJournal(file, { head: false, ...opts, key });
}

/** Records complete in a prefix of a built journal: whole lines, plus a final record that only lost its newline. */
function completeIn(prefix: Buffer, lines: string[]): { n: number; validBytes: number; whole: boolean } {
  let n = 0;
  let validBytes = 0;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] === 0x0a) {
      n++;
      validBytes = i + 1;
    }
  }
  const tail = prefix.subarray(validBytes).toString("utf-8");
  const whole = tail.length > 0 && n < lines.length && tail === lines[n].slice(0, -1);
  return { n: whole ? n + 1 : n, validBytes, whole };
}

/** The replay invariants, checked against the records the plan was built from. */
function checkPlan(records: JournalRecord[]): void {
  const plan = buildResumePlan(records);
  const ends = modelEnds(records);

  // Visits replay in order, and at most the last one is not a replay.
  plan.visits.forEach((v, i) => {
    if (i < plan.visits.length - 1) expect(v.action).toBe("replay");
  });

  const orderKeys: string[] = [];
  for (const r of records) {
    if (r.type !== "node:start") continue;
    const key = `${String(r.node)}#${String(r.iteration)}`;
    if (!orderKeys.includes(key)) orderKeys.push(key);
  }

  for (const v of plan.visits) {
    const key = `${v.node}#${v.iteration}`;
    if (v.action !== "replay") continue;
    // A replayed visit has a recorded end, and replays exactly the status it recorded.
    expect(ends.get(key)).toBeDefined();
    expect(v.status).toBe(ends.get(key));
    // "Succeeded" is never invented: it needs a journaled node:end that says so.
    if (v.status === "success") {
      expect(records.some((r) => r.type === "node:end" && r.node === v.node && r.iteration === v.iteration)).toBe(true);
    }
    // A failed final visit that was not routed on is re-run, not replayed.
    if (key === orderKeys[orderKeys.length - 1] && v.status === "failed") expect(typeof v.next).toBe("string");
  }

  // Never an end the journal did not record.
  for (const [key, end] of plan.ends) expect(end.result.status).toBe(ends.get(key));
  // A visit that never ended is never a replay, so it can never read as a success.
  for (const [key, status] of ends) {
    if (status !== undefined) continue;
    const visit = plan.visits.find((v) => `${v.node}#${v.iteration}` === key);
    if (visit) expect(visit.action).not.toBe("replay");
  }

  if (plan.finished) {
    expect(plan.visits.every((v) => v.action === "replay")).toBe(true);
    expect(plan.visits[plan.visits.length - 1]?.next).toBeNull();
  }
}

// ─── Properties ──────────────────────────────────────────────────

describe("journal: truncation recovers to the last complete record", () => {
  it("any byte-level truncation of a valid journal reads back exactly the records that were complete", () => {
    fc.assert(
      fc.property(scriptArb, fc.integer({ min: 0, max: 1_000_000 }), (script, cutRaw) => {
        const { lines, records } = buildJournal(script);
        const buf = Buffer.from(lines.join(""), "utf-8");
        const cut = cutRaw % (buf.length + 1);
        const prefix = buf.subarray(0, cut);

        // Records complete in the prefix = newlines in the prefix, plus a final
        // record cut exactly at its newline (complete JSON is never torn).
        const { n, validBytes, whole } = completeIn(prefix, lines);

        const read = readBytes(prefix);
        expect(read.records).toEqual(records.slice(0, n));
        expect(read.truncatedBytes).toBe(whole ? 0 : cut - validBytes);
        expect(read.corruptAtLine).toBeUndefined();

        // Repair cuts a torn tail back to the last complete record (or restores
        // a lost final newline) and is stable.
        const repaired = readBytes(prefix, { repair: true });
        expect(repaired.records).toEqual(records.slice(0, n));
        expect(statSync(file).size).toBe(whole ? cut + 1 : validBytes);
        const again = readJournal(file, { key: KEY, head: false });
        expect(again.truncatedBytes).toBe(0);
        expect(again.records).toEqual(records.slice(0, n));

        // What survives always plans a resume that respects the journal.
        if (n >= 1) checkPlan(read.records);
        else expect(() => buildResumePlan(read.records)).toThrow(/run:start/);
      }),
      params(150),
    );
  });

  it(
    "a journal written by the real RunJournal recovers at every possible truncation point",
    () => {
      const wf: Workflow = {
        id: "w",
        name: "W",
        description: "",
        entry: "a",
        nodes: { a: { name: "A", instruction: "do a", skills: [] }, b: { name: "B", instruction: "do b", skills: [] } },
        edges: [{ from: "a", to: "b" }],
      };
      const cwd = mkdtempSync(join(root, "real-"));
      const runId = "20260930-120000-0a0b0c";
      const j = RunJournal.create({ runId, cwd });
      j.begin({
        workflow: wf,
        input: {},
        sources: { "nodes.a.instruction": { content: "do a" } },
        skills: new Map(),
        config: {},
        writeState: createWriteStageState(),
      });
      j.nodeStart("a", 1);
      j.nodeEnd("a", 1, result("success"), createWriteStageState());
      j.route("a", "b");
      j.nodeStart("b", 1);
      j.nodeEnd("b", 1, result("failed"), createWriteStageState());
      j.end("failed");

      const full = readFileSync(join(journalDir(cwd, runId), JOURNAL_FILE));
      const runKey = loadRunKey(runKeyFile(cwd, runId));
      const whole = readBytes(full, undefined, runKey);
      expect(whole.truncatedBytes).toBe(0);
      expect(whole.records.map((r) => r.type)).toEqual([
        "run:start",
        "node:start",
        "node:end",
        "route",
        "node:start",
        "node:end",
        "run:end",
      ]);

      let complete = 0;
      for (let cut = 0; cut <= full.length; cut++) {
        if (cut > 0 && full[cut - 1] === 0x0a) complete++;
        // Cut exactly before a newline: that record is whole and authenticates.
        const n = cut > 0 && full[cut] === 0x0a ? complete + 1 : complete;
        const read = readBytes(full.subarray(0, cut), undefined, runKey);
        expect(read.records).toHaveLength(n);
        expect(read.records).toEqual(whole.records.slice(0, n));
        expect(read.corruptAtLine).toBeUndefined();
      }
    },
    EXHAUSTIVE_TIMEOUT_MS,
  );
});

describe("journal: byte corruption is detected, never silently skipped", () => {
  it("damage anywhere but the tail is refused (or harmless); the reader never returns an altered or gapped history", () => {
    fc.assert(
      fc.property(
        scriptArb,
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 255 }),
        (script, kRaw, delta) => {
          const { lines, records } = buildJournal(script);
          const buf = Buffer.from(lines.join(""), "utf-8");
          const k = kRaw % buf.length;
          const mutated = Buffer.from(buf);
          mutated[k] = (buf[k] + delta) % 256;

          // Offset of the newline that ends the second-to-last record. A byte at or
          // after it can only damage the final record, which is a torn tail.
          const lineBytes = lines.map((l) => Buffer.byteLength(l));
          const N = lines.length;
          const tailStart = N >= 2 ? lineBytes.slice(0, N - 1).reduce((a, b) => a + b, 0) - 1 : 0;

          let read: ReturnType<typeof readJournal>;
          try {
            read = readBytes(mutated);
          } catch (err) {
            // The one other refusal: a damaged version field reads as a newer format.
            expect(err).toBeInstanceOf(JournalVersionError);
            return;
          }

          // Whatever is returned is an exact prefix of the real history: no record altered, none skipped.
          expect(read.records.length).toBeLessThanOrEqual(N);
          read.records.forEach((r, i) => expect(r).toEqual(records[i]));

          if (k < tailStart) {
            // Valid records follow the damage: it must be reported, unless the byte change was a no-op in meaning.
            expect(read.corruptAtLine !== undefined || read.records.length === N).toBe(true);
          } else if (read.corruptAtLine === undefined) {
            // Tail damage costs at most the last two records (the damaged one, or two merged by a lost newline).
            expect(N - read.records.length).toBeLessThanOrEqual(2);
          }

          // Repair never cuts valid records out of a file with mid-file damage.
          const repaired = readBytes(mutated, { repair: true });
          if (repaired.corruptAtLine !== undefined) {
            expect(readFileSync(file).equals(mutated)).toBe(true);
          } else {
            expect(readJournal(file, { key: KEY, head: false }).truncatedBytes).toBe(0);
          }
        },
      ),
      params(300),
    );
  });

  it(
    "flipping a single byte anywhere in a real two-visit journal is never accepted as a different history",
    () => {
      const { lines, records } = buildJournal({
        steps: [
          { node: "a", status: "success", checkpoint: true, end: true, route: "next", restart: false, resume: false },
          { node: "b", status: "failed", checkpoint: false, end: true, route: "end", restart: false, resume: false },
        ],
        runEnd: "failed",
      });
      const buf = Buffer.from(lines.join(""), "utf-8");
      for (let k = 0; k < buf.length; k++) {
        const mutated = Buffer.from(buf);
        mutated[k] ^= 0x01;
        let read: ReturnType<typeof readJournal>;
        try {
          read = readBytes(mutated);
        } catch (err) {
          expect(err).toBeInstanceOf(JournalVersionError);
          continue;
        }
        read.records.forEach((r, i) => expect(r).toEqual(records[i]));
      }
    },
    EXHAUSTIVE_TIMEOUT_MS,
  );
});

describe("journal: replay never marks a node succeeded that was not recorded as succeeded", () => {
  it("for any valid journal, replayed visits carry exactly the recorded status", () => {
    fc.assert(
      fc.property(scriptArb, (script) => {
        const { records } = buildJournal(script);
        checkPlan(records);
      }),
      params(300),
    );
  });

  it("a visit with a checkpoint but no end is resumed at its write stage, never replayed as done", () => {
    fc.assert(
      fc.property(fc.constantFrom<Status>("success", "failed", "skipped"), (status) => {
        const { records } = buildJournal({
          steps: [{ node: "a", status, checkpoint: true, end: false, route: "none", restart: false, resume: false }],
        });
        const plan = buildResumePlan(records);
        expect(plan.visits).toHaveLength(1);
        expect(plan.visits[0].action).toBe("write-stage");
        expect(plan.finished).toBe(false);
      }),
      params(10),
    );
  });
});

describe("journal: no suffix can be cut away unnoticed (head pointer)", () => {
  const headAt = (records: JournalRecord[], seq: number): JournalHead => ({
    seq,
    mac: seq > 0 ? (records[seq - 1].h as string) : "",
  });

  it("any byte-level truncation is refused unless what is left reaches the head pointer", () => {
    fc.assert(
      fc.property(scriptArb, fc.integer({ min: 0, max: 1_000_000 }), fc.boolean(), (script, cutRaw, crashWindow) => {
        const { lines, records } = buildJournal(script);
        const N = lines.length;
        // The head names the last record, or (crash between the append and the head update) the one before it.
        const head = headAt(records, crashWindow ? N - 1 : N);
        const buf = Buffer.from(lines.join(""), "utf-8");
        const cut = cutRaw % (buf.length + 1);
        const prefix = buf.subarray(0, cut);
        const { n } = completeIn(prefix, lines);

        let read: ReturnType<typeof readJournal> | undefined;
        let error: unknown;
        try {
          read = readBytes(prefix, { repair: true, head });
        } catch (err) {
          error = err;
        }
        if (n >= head.seq) {
          // At the head, or one whole record past it: the history is intact.
          expect(error).toBeUndefined();
          expect(read!.records).toEqual(records.slice(0, n));
          if (head.seq > 0) expect(read!.records[head.seq - 1]).toEqual(records[head.seq - 1]);
        } else {
          // Any shorter journal, torn tail or not, is a rollback, and is left exactly as found.
          expect(error).toBeInstanceOf(JournalRollbackError);
          expect(readFileSync(file).equals(prefix)).toBe(true);
        }
      }),
      params(300),
    );
  });

  it("a journal accepted against a head always holds the exact record the head names", () => {
    fc.assert(
      fc.property(scriptArb, scriptArb, fc.boolean(), (scriptA, scriptB, crashWindow) => {
        const a = buildJournal(scriptA);
        const b = buildJournal(scriptB);
        const head = headAt(a.records, crashWindow ? a.lines.length - 1 : a.lines.length);
        let read: ReturnType<typeof readJournal> | undefined;
        try {
          read = readBytes(Buffer.from(b.lines.join(""), "utf-8"), { head });
        } catch (err) {
          expect(err).toBeInstanceOf(JournalRollbackError);
          return;
        }
        expect([head.seq, head.seq + 1]).toContain(read.records.length);
        if (head.seq > 0) expect(read.records[head.seq - 1]).toEqual(a.records[head.seq - 1]);
      }),
      params(300),
    );
  });

  it("an unterminated tail that is complete JSON must authenticate; it is never trimmed as torn", () => {
    const tailArb = fc.oneof(
      // The next record, well formed, with a wrong MAC.
      fc
        .uint8Array({ minLength: 32, maxLength: 32 })
        .map((b) => ({ forgedRecord: true as const, h: Buffer.from(b).toString("hex") })),
      // Any other complete JSON value.
      fc.jsonValue().map((value) => ({ forgedRecord: false as const, value })),
    );
    fc.assert(
      fc.property(scriptArb, tailArb, (script, tail) => {
        const { lines, records } = buildJournal(script);
        const N = lines.length;
        const text = tail.forgedRecord
          ? JSON.stringify({
              v: JOURNAL_SCHEMA_VERSION,
              seq: N + 1,
              type: "route",
              at: "x",
              from: "a",
              to: null,
              h: tail.h,
            })
          : JSON.stringify(tail.value);
        const buf = Buffer.concat([Buffer.from(lines.join(""), "utf-8"), Buffer.from(text, "utf-8")]);
        let read: ReturnType<typeof readJournal>;
        try {
          read = readBytes(buf, { repair: true, head: headAt(records, N) });
        } catch (err) {
          // A JSON object whose `v` is a number above the format: refused as a newer format.
          expect(err).toBeInstanceOf(JournalVersionError);
          return;
        }
        expect(read.forgedAtLine).toBe(N + 1);
        expect(read.records).toEqual(records);
        expect(readFileSync(file).equals(buf)).toBe(true);
      }),
      params(300),
    );
  });

  it(
    "a real RunJournal: every truncation short of its last record is refused, so journaled spend is never lost",
    () => {
      const wf: Workflow = {
        id: "w",
        name: "W",
        description: "",
        entry: "a",
        nodes: { a: { name: "A", instruction: "do a", skills: [] }, b: { name: "B", instruction: "do b", skills: [] } },
        edges: [{ from: "a", to: "b" }],
      };
      const cwd = mkdtempSync(join(root, "head-"));
      const runId = "20261001-120000-0d0e0f";
      const j = RunJournal.create({ runId, cwd });
      j.begin({
        workflow: wf,
        input: {},
        sources: {},
        skills: new Map(),
        config: {},
        writeState: createWriteStageState(),
      });
      j.nodeStart("a", 1);
      j.usage("a", 1, 1, { inputTokens: 90, outputTokens: 0, costUsd: 0.5 }, true);
      j.nodeEnd("a", 1, result("success"), createWriteStageState());
      j.route("a", "b");
      j.nodeStart("b", 1);
      j.usage("b", 1, 1, { inputTokens: 20, outputTokens: 0 }, true);
      j.nodeEnd("b", 1, result("failed"), createWriteStageState());
      j.end("failed");

      const real = join(journalDir(cwd, runId), JOURNAL_FILE);
      const full = readFileSync(real);
      const spend = buildResumePlan(readJournal(real).records).priorSpend;
      expect(spend).toEqual({ tokens: 110, costUsd: 0.5 });

      for (let cut = 0; cut <= full.length; cut++) {
        writeFileSync(real, full.subarray(0, cut));
        if (cut >= full.length - 1) {
          // Whole, or the last record without its newline: the full history and its spend.
          expect(buildResumePlan(readJournal(real).records).priorSpend).toEqual(spend);
        } else {
          expect(() => readJournal(real), `cut at ${cut}`).toThrow(JournalRollbackError);
        }
      }
    },
    EXHAUSTIVE_TIMEOUT_MS,
  );
});
