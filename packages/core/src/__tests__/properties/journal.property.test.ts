// Property-based and adversarial tests for the run journal (journal.ts):
// any truncation recovers to the last complete record, damage in the middle is
// refused (never a silently skipped node), and replay never marks a visit
// succeeded unless the journal recorded it as succeeded.

import { describe, it, expect, afterAll } from "vitest";
import * as fc from "fast-check";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JOURNAL_FILE,
  JOURNAL_SCHEMA_VERSION,
  JournalVersionError,
  RunJournal,
  buildResumePlan,
  journalDir,
  readJournal,
  type JournalRecord,
} from "../../journal.js";
import { createWriteStageState } from "../../safe-outputs.js";
import type { NodeResult, Workflow } from "../../types.js";
import { params } from "./config.js";

const root = mkdtempSync(join(tmpdir(), "sweny-journal-prop-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const file = join(root, "journal.ndjson");

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
  const counts: Record<string, number> = {};
  let prev: { node: string; iteration: number } | undefined;
  for (const s of script.steps) {
    if (s.resume) raw.push({ type: "run:resume", fields: {} });
    let visit: { node: string; iteration: number };
    if (s.restart && prev) visit = prev;
    else {
      counts[s.node] = (counts[s.node] ?? 0) + 1;
      visit = { node: s.node, iteration: counts[s.node] };
    }
    prev = visit;
    raw.push({ type: "node:start", fields: { ...visit } });
    if (s.checkpoint) {
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
      if (s.route !== "none") {
        raw.push({
          type: "route",
          fields: { from: visit.node, to: s.route === "end" ? null : visit.node === "a" ? "b" : "a" },
        });
      }
    }
  }
  if (script.runEnd) raw.push({ type: "run:end", fields: { status: script.runEnd } });

  const lines = raw.map((r, i) => {
    const body = { v: JOURNAL_SCHEMA_VERSION, seq: i + 1, type: r.type, at: "2026-09-30T00:00:00.000Z", ...r.fields };
    const h = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
    return JSON.stringify({ ...body, h }) + "\n";
  });
  return { lines, records: lines.map((l) => JSON.parse(l) as JournalRecord) };
}

function readBytes(buf: Buffer, opts?: { repair?: boolean }) {
  writeFileSync(file, buf);
  return readJournal(file, opts);
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

        // Records complete in the prefix = newlines in the prefix.
        let n = 0;
        let validBytes = 0;
        for (let i = 0; i < prefix.length; i++) {
          if (prefix[i] === 0x0a) {
            n++;
            validBytes = i + 1;
          }
        }

        const read = readBytes(prefix);
        expect(read.records).toEqual(records.slice(0, n));
        expect(read.truncatedBytes).toBe(cut - validBytes);
        expect(read.corruptAtLine).toBeUndefined();

        // Repair cuts the file back to the last complete record and is stable.
        const repaired = readBytes(prefix, { repair: true });
        expect(repaired.records).toEqual(records.slice(0, n));
        expect(statSync(file).size).toBe(validBytes);
        const again = readJournal(file);
        expect(again.truncatedBytes).toBe(0);
        expect(again.records).toEqual(records.slice(0, n));

        // What survives always plans a resume that respects the journal.
        if (n >= 1) checkPlan(read.records);
        else expect(() => buildResumePlan(read.records)).toThrow(/run:start/);
      }),
      params(150),
    );
  });

  it("a journal written by the real RunJournal recovers at every possible truncation point", () => {
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
    const whole = readBytes(full);
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
      const read = readBytes(full.subarray(0, cut));
      expect(read.records).toHaveLength(complete);
      expect(read.records).toEqual(whole.records.slice(0, complete));
      expect(read.corruptAtLine).toBeUndefined();
    }
  });
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
            expect(readJournal(file).truncatedBytes).toBe(0);
          }
        },
      ),
      params(300),
    );
  });

  it("flipping a single byte anywhere in a real two-visit journal is never accepted as a different history", () => {
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
  });
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
