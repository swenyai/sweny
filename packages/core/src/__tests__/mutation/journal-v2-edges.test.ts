/**
 * Edge assertions found by mutation testing of the authenticated journal
 * (format v2): where run keys live, how a forged or impossible journal is
 * refused, usage journaling, and what the tool fingerprint covers. A resume
 * trusts this file, so each refusal is pinned with its message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  JOURNAL_FILE,
  JOURNAL_SCHEMA_VERSION,
  JournalIntegrityError,
  JournalKeyError,
  RunJournal,
  USAGE_JOURNAL_INTERVAL_MS,
  buildResumePlan,
  checkJournalAgainstWorkflow,
  checkRecordSequence,
  journalDir,
  loadRunKey,
  readJournal,
  runKeyDir,
  runKeyFile,
  runSecretValues,
  swenyStateDir,
  toolsHash,
  type JournalRecord,
} from "../../journal.js";
import { createWriteStageState } from "../../safe-outputs.js";
import type { NodeResult, Skill, Workflow } from "../../types.js";

const RUN = "20260930-120000-0a0b0c";
const KEY = Buffer.alloc(32, 7);
const dirs: string[] = [];
let KEYDIR = "";
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sweny-journal-v2-"));
  dirs.push(d);
  return d;
}
beforeEach(() => {
  KEYDIR = tmp();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ─── Where keys live ──────────────────────────────────────────────

describe("run key location", () => {
  it("SWENY_STATE_DIR wins, resolved; a blank one is ignored", () => {
    expect(swenyStateDir({ SWENY_STATE_DIR: "/a/b" })).toBe("/a/b");
    expect(swenyStateDir({ SWENY_STATE_DIR: "rel/x" })).toBe(resolve("rel/x"));
    expect(swenyStateDir({ SWENY_STATE_DIR: "/a/b", XDG_STATE_HOME: "/xdg" })).toBe("/a/b");
    expect(swenyStateDir({ SWENY_STATE_DIR: "   ", XDG_STATE_HOME: "/xdg" })).toBe(join("/xdg", "sweny"));
    expect(swenyStateDir({ SWENY_STATE_DIR: "", XDG_STATE_HOME: "/xdg" })).toBe(join("/xdg", "sweny"));
  });

  it("then an absolute XDG_STATE_HOME, then ~/.local/state", () => {
    expect(swenyStateDir({ XDG_STATE_HOME: "/xdg" })).toBe(join("/xdg", "sweny"));
    const home = join(homedir(), ".local", "state", "sweny");
    expect(swenyStateDir({ XDG_STATE_HOME: "relative/state" })).toBe(home);
    expect(swenyStateDir({ XDG_STATE_HOME: "" })).toBe(home);
    expect(swenyStateDir({})).toBe(home);
  });

  it("keys sit under run-keys, one file per workspace and run, named by a hash of the real path", () => {
    expect(runKeyDir({ SWENY_STATE_DIR: "/s" })).toBe(join("/s", "run-keys"));
    const cwd = tmp();
    const file = runKeyFile(cwd, RUN, "/k");
    expect(file).toBe(join("/k", `${sha256(realpathSync(cwd)).slice(0, 16)}-${RUN}.key`));
    expect(runKeyFile(tmp(), RUN, "/k")).not.toBe(file);
    expect(runKeyFile(cwd, "20260930-120000-ffffff", "/k")).not.toBe(file);
    expect(runKeyFile(cwd, RUN).startsWith(runKeyDir())).toBe(true);
    // A workspace that does not exist yet still gets a stable name.
    expect(runKeyFile("/no/such/dir", RUN, "/k")).toBe(
      join("/k", `${sha256(resolve("/no/such/dir")).slice(0, 16)}-${RUN}.key`),
    );
  });
});

describe("run key files", () => {
  const keyFile = (text: string) => {
    const file = join(tmp(), "k.key");
    writeFileSync(file, text);
    return file;
  };

  it("loads a 64-character lowercase hex key, trimmed", () => {
    expect(loadRunKey(keyFile(KEY.toString("hex") + "\n"))).toStrictEqual(KEY);
    expect(loadRunKey(keyFile("  " + KEY.toString("hex") + "  "))).toStrictEqual(KEY);
  });

  it("refuses a missing key and a malformed one, naming the file and what to do", () => {
    const tail =
      "A journal can only be resumed by the user (and state dir) that started the run; set SWENY_STATE_DIR to that dir, or start a new run.";
    const gone = join(tmp(), "nope.key");
    expect(() => loadRunKey(gone)).toThrow(JournalKeyError);
    expect(() => loadRunKey(gone)).toThrow(`cannot verify the run journal: its key ${gone} is missing. ${tail}`);
    for (const bad of [
      "",
      "abc",
      "g".repeat(64),
      "A".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
      KEY.toString("hex") + "\nextra",
    ]) {
      const f = keyFile(bad);
      expect(() => loadRunKey(f), bad).toThrow(
        `cannot verify the run journal: its key ${f} is not a valid key. ${tail}`,
      );
    }
    try {
      loadRunKey(gone);
    } catch (e) {
      expect((e as Error).name).toBe("JournalKeyError");
    }
  });

  it("a journal cannot be read or resumed without its key", () => {
    const cwd = tmp();
    const dir = journalDir(cwd, RUN);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, JOURNAL_FILE), signed(1, "run:start") + "\n");
    expect(() => readJournal(join(dir, JOURNAL_FILE), { keyDir: KEYDIR })).toThrow(JournalKeyError);
    writeFileSync(runKeyFile(cwd, RUN, KEYDIR), KEY.toString("hex") + "\n");
    expect(readJournal(join(dir, JOURNAL_FILE), { keyDir: KEYDIR }).records).toHaveLength(1);
    const plan = buildResumePlan([startRec()]);
    const read = { file: join(dir, JOURNAL_FILE), records: [startRec()], truncatedBytes: 0 };
    expect(() => RunJournal.openForResume({ runId: RUN, cwd: tmp(), keyDir: KEYDIR, read, plan })).toThrow(
      JournalKeyError,
    );
  });
});

function signed(seq: number, type: string, fields: Record<string, unknown> = {}): string {
  const body = { v: JOURNAL_SCHEMA_VERSION, seq, type, at: "t", ...fields };
  return JSON.stringify({ ...body, h: createHmac("sha256", KEY).update(JSON.stringify(body)).digest("hex") });
}

// ─── Records ──────────────────────────────────────────────────────

let seq = 0;
function rec(type: string, fields: Record<string, unknown> = {}): JournalRecord {
  return { v: JOURNAL_SCHEMA_VERSION, seq: ++seq, type, at: "t", ...fields };
}
const startRec = (over: Record<string, unknown> = {}) =>
  rec("run:start", {
    run_id: RUN,
    workflow_id: "w",
    workflow_entry: "a",
    workflow_hash: "wh",
    instruction_hash: "ih",
    input_hash: "nh",
    tools_hash: "th",
    input: {},
    input_redacted: false,
    ...over,
  });
const ok = (): NodeResult => ({ status: "success", data: {}, toolCalls: [] });
const failed = (): NodeResult => ({ status: "failed", data: {}, toolCalls: [] });
const ns = (node: string, iteration = 1) => rec("node:start", { node, iteration });
const end = (node: string, result: unknown = ok(), iteration = 1) =>
  rec("node:end", { node, iteration, result, write_state: { counts: [], total: 0, seen: [] } });
const cp = (node: string, iteration = 1) =>
  rec("node:checkpoint", { node, iteration, result: ok(), intents: [], agent_failed: false, attempt: 1 });
const route = (from: string, to: unknown) => rec("route", { from, to });
const wr = (type: "output:intent" | "output:applied", key: unknown, node = "a", extra: Record<string, unknown> = {}) =>
  rec(type, { node, iteration: 1, key, tool: "github_create_issue", ...extra });
const resume = () => rec("run:resume");

function integrity(recs: JournalRecord[]): string {
  try {
    checkRecordSequence(recs);
  } catch (e) {
    expect(e).toBeInstanceOf(JournalIntegrityError);
    expect((e as Error).name).toBe("JournalIntegrityError");
    return (e as Error).message;
  }
  throw new Error("expected the sequence to be refused");
}

/** The sequence is refused at `offender`, with exactly this reason. */
function refusedAt(prefix: JournalRecord[], offender: JournalRecord, why: string): void {
  const msg = integrity([...prefix, offender]);
  expect(msg).toBe(
    `run journal record ${offender.seq} (${offender.type}) ${why}. The journal was edited or does not come from this run; start a new run.`,
  );
}

describe("checkRecordSequence: what an executor never writes", () => {
  it("accepts a whole run, with writes, a loop, a resume and a restart", () => {
    expect(() =>
      checkRecordSequence([
        startRec(),
        ns("a"),
        cp("a"),
        wr("output:intent", "k1"),
        wr("output:applied", "k1"),
        wr("output:applied", "k2", "a", { recovered: true }),
        end("a"),
        route("a", "b"),
        ns("b"),
        end("b", failed()),
        resume(),
        ns("b"),
        end("b"),
        route("b", "a"),
        ns("a", 2),
        end("a", ok(), 2),
        route("a", null),
        rec("run:end", { status: "success" }),
        resume(),
      ]),
    ).not.toThrow();
    for (const status of ["success", "failed", "crashed"]) {
      expect(() => checkRecordSequence([startRec(), rec("run:end", { status })])).not.toThrow();
    }
  });

  it("the journal starts with one run:start that names the run and entry node", () => {
    refusedAt([], ns("a"), "is not run:start");
    refusedAt([startRec()], startRec(), "is a second run:start");
    refusedAt([], startRec({ run_id: "" }), "is missing the run id or entry node");
    refusedAt([], startRec({ run_id: 5 }), "is missing the run id or entry node");
    refusedAt([], startRec({ workflow_entry: "" }), "is missing the run id or entry node");
    refusedAt([], startRec({ workflow_entry: undefined }), "is missing the run id or entry node");
    refusedAt([startRec()], rec("mystery"), "has an unknown type");
  });

  it("nothing but a resume may follow run:end", () => {
    refusedAt([startRec(), rec("run:end", { status: "success" })], ns("a"), "comes after run:end");
    refusedAt(
      [startRec(), rec("run:end", { status: "failed" })],
      rec("run:end", { status: "failed" }),
      "comes after run:end",
    );
    expect(() =>
      checkRecordSequence([startRec(), rec("run:end", { status: "failed" }), resume(), ns("a")]),
    ).not.toThrow();
    refusedAt([startRec()], rec("run:end", { status: "weird" }), "has an unknown status");
    refusedAt([startRec()], rec("run:end", {}), "has an unknown status");
  });

  it("a visit needs a real node and a positive whole iteration", () => {
    for (const bad of [
      rec("node:start", { node: "a", iteration: 0 }),
      rec("node:start", { node: "a", iteration: 1.5 }),
      rec("node:start", { node: "a", iteration: -1 }),
      rec("node:start", { node: "a", iteration: "1" }),
      rec("node:start", { node: "a" }),
      rec("node:start", { node: "", iteration: 1 }),
      rec("node:start", { node: 5, iteration: 1 }),
      rec("node:start", { iteration: 1 }),
    ]) {
      refusedAt([startRec()], bad, "has no valid node or iteration");
    }
  });

  it("a visit starts only where the last route pointed, once the last one ended and was routed", () => {
    refusedAt([startRec(), ns("a")], ns("b"), "starts b while a is still running");
    refusedAt([startRec(), ns("a"), end("a")], ns("b"), "starts b before a was routed");
    refusedAt([startRec(), ns("a"), end("a"), route("a", "b")], ns("c"), "starts c, but the run was routed to b");
    refusedAt(
      [startRec(), ns("a"), end("a"), route("a", null)],
      ns("c"),
      "starts c, but the run was routed to the end",
    );
    refusedAt([startRec()], ns("zzz"), "starts zzz, but the run was routed to a");
    refusedAt([startRec()], ns("a", 2), "starts a at the wrong iteration");
    refusedAt([startRec(), ns("a"), end("a"), route("a", "a")], ns("a", 3), "starts a at the wrong iteration");
    expect(() => checkRecordSequence([startRec(), ns("a"), end("a"), route("a", "a"), ns("a", 2)])).not.toThrow();
  });

  it("a restart after a resume is only for the same unfinished or failed, unrouted visit", () => {
    expect(() => checkRecordSequence([startRec(), ns("a"), resume(), ns("a")])).not.toThrow();
    expect(() => checkRecordSequence([startRec(), ns("a"), end("a", failed()), resume(), ns("a")])).not.toThrow();
    // Finished fine: not a restart.
    refusedAt([startRec(), ns("a"), end("a"), resume()], ns("a"), "starts a before a was routed");
    // No resume in between: not a restart.
    refusedAt([startRec(), ns("a"), end("a", failed())], ns("a"), "starts a before a was routed");
    // Another node, or another iteration.
    refusedAt([startRec(), ns("a"), end("a", failed()), resume()], ns("b"), "starts b before a was routed");
    refusedAt([startRec(), ns("a"), resume()], ns("a", 2), "starts a while a is still running");
    // Failed but already routed on: the route stands.
    refusedAt(
      [startRec(), ns("a"), end("a", failed()), route("a", "a"), resume()],
      ns("a"),
      "starts a at the wrong iteration",
    );
    // A restart is spent: a second one needs another resume.
    refusedAt(
      [startRec(), ns("a"), end("a", failed()), resume(), ns("a"), end("a", failed())],
      ns("a"),
      "starts a before a was routed",
    );
  });

  it("checkpoints, writes, usage and ends belong to the open visit", () => {
    refusedAt([startRec()], cp("a"), "is outside any open node visit");
    refusedAt([startRec(), ns("a"), end("a")], cp("a"), "is outside any open node visit");
    refusedAt([startRec(), ns("a")], cp("b"), "names b#1, but the open visit is a#1");
    refusedAt([startRec(), ns("a")], cp("a", 2), "names a#2, but the open visit is a#1");
    refusedAt([startRec(), ns("a")], end("b"), "names b#1, but the open visit is a#1");
    refusedAt([startRec()], end("a"), "is outside any open node visit");
    refusedAt([startRec(), ns("a")], wr("output:intent", "k", "b"), "names b#1, but the open visit is a#1");
  });

  it("a visit is checkpointed once, and writes come after the checkpoint with a key and an intent", () => {
    refusedAt([startRec(), ns("a"), cp("a")], cp("a"), "checkpoints a visit twice");
    refusedAt([startRec(), ns("a")], wr("output:intent", "k"), "records a write before the visit's checkpoint");
    refusedAt([startRec(), ns("a")], wr("output:applied", "k"), "records a write before the visit's checkpoint");
    refusedAt([startRec(), ns("a"), cp("a")], wr("output:intent", ""), "has no idempotency key");
    refusedAt([startRec(), ns("a"), cp("a")], wr("output:applied", undefined), "has no idempotency key");
    refusedAt([startRec(), ns("a"), cp("a")], wr("output:applied", "k"), "has no matching intent");
    refusedAt(
      [startRec(), ns("a"), cp("a"), wr("output:intent", "k1")],
      wr("output:applied", "k2"),
      "has no matching intent",
    );
    refusedAt(
      [startRec(), ns("a"), cp("a")],
      wr("output:applied", "k", "a", { recovered: "yes" }),
      "has no matching intent",
    );
    expect(() =>
      checkRecordSequence([startRec(), ns("a"), cp("a"), wr("output:applied", "k", "a", { recovered: true })]),
    ).not.toThrow();
  });

  it("a node:end carries a result with a status", () => {
    for (const result of [undefined, null, "failed", 5, {}, { status: 5 }]) {
      const bad = rec("node:end", { node: "a", iteration: 1, result, write_state: { counts: [], total: 0, seen: [] } });
      refusedAt([startRec(), ns("a")], bad, "has no result");
    }
  });

  it("a route follows exactly one finished visit, from its node, to a real target or the end", () => {
    refusedAt([startRec()], route("a", "b"), "routes before any visit ended");
    refusedAt([startRec(), ns("a")], route("a", "b"), "routes before any visit ended");
    refusedAt([startRec(), ns("a"), end("a"), route("a", "b")], route("a", "c"), "routes a a second time");
    refusedAt([startRec(), ns("a"), end("a")], route("zzz", "b"), "routes from zzz, but the visit that ended is a");
    refusedAt([startRec(), ns("a"), end("a")], route("a", ""), "has no valid target");
    refusedAt([startRec(), ns("a"), end("a")], route("a", 5), "has no valid target");
    refusedAt([startRec(), ns("a"), end("a")], route("a", undefined), "has no valid target");
    expect(() => checkRecordSequence([startRec(), ns("a"), end("a"), route("a", null)])).not.toThrow();
  });

  it("usage belongs to the open visit and carries finite non-negative amounts", () => {
    const usage = (over: Record<string, unknown> = {}) =>
      rec("usage", { node: "a", iteration: 1, attempt: 0, tokens: 1, cost_usd: 1, final: false, ...over });
    expect(() => checkRecordSequence([startRec(), ns("a"), usage(), usage({ tokens: 0, cost_usd: 0 })])).not.toThrow();
    for (const bad of [
      { tokens: -1 },
      { cost_usd: -0.5 },
      { tokens: NaN },
      { cost_usd: Infinity },
      { tokens: "1" },
      { cost_usd: null },
      { attempt: -1 },
      { attempt: "0" },
    ]) {
      refusedAt([startRec(), ns("a")], usage(bad), "has invalid amounts");
    }
    refusedAt([startRec()], usage(), "is outside any open node visit");
    refusedAt([startRec(), ns("a")], usage({ node: "b" }), "names b#1, but the open visit is a#1");
  });
});

// ─── Journal against the workflow ─────────────────────────────────

describe("checkJournalAgainstWorkflow", () => {
  const wf = {
    id: "w",
    name: "W",
    description: "",
    entry: "a",
    nodes: { a: {}, b: {} },
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a", max_iterations: 2 },
    ],
  } as unknown as Workflow;
  const check = (...recs: JournalRecord[]) => checkJournalAgainstWorkflow(recs, wf);

  it("accepts a journal that follows the workflow", () => {
    expect(check()).toBeUndefined();
    expect(check(startRec(), ns("a"), route("a", "b"), ns("b"), route("b", "a"), route("a", null))).toBeUndefined();
    expect(check(route("a", "b"))).toBeUndefined();
  });

  it("refuses a different entry node, only when the first record is the start", () => {
    expect(check(startRec({ workflow_entry: "x" }))).toBe("the run started at node x, but the workflow's entry is a");
    expect(check(ns("a"), startRec({ workflow_entry: "x" }))).toBeUndefined();
  });

  it("refuses a visit to a node the workflow does not have", () => {
    expect(check(startRec(), ns("zzz"))).toBe("the journal visits node zzz, which this workflow does not have");
    expect(check(startRec(), ns("a"), rec("node:end", { node: "zzz" }))).toBeUndefined();
  });

  it("refuses a route that is not an edge, but never an ending", () => {
    expect(check(route("a", "zzz"))).toBe("the journal routes a -> zzz, which is not an edge of this workflow");
    expect(check(route("b", "b"))).toBe("the journal routes b -> b, which is not an edge of this workflow");
    expect(check(route("b", "a"), route("zzz", null))).toBeUndefined();
  });

  it("counts each edge's use against its own max_iterations", () => {
    expect(check(route("b", "a"), route("b", "a"))).toBeUndefined();
    expect(check(route("b", "a"), route("b", "a"), route("b", "a"))).toBe(
      "the journal routes b -> a 3 times; the edge allows 2",
    );
    expect(
      check(route("a", "b"), route("a", "b"), route("a", "b"), route("a", "b"), route("b", "a"), route("b", "a")),
    ).toBeUndefined();
  });

  it("reports the first problem in journal order", () => {
    expect(check(startRec(), ns("zzz"), route("a", "zzz"))).toBe(
      "the journal visits node zzz, which this workflow does not have",
    );
    expect(check(startRec({ workflow_entry: "x" }), ns("zzz"))).toBe(
      "the run started at node x, but the workflow's entry is a",
    );
  });
});

// ─── A new run: files, keys and usage ─────────────────────────────

const wfx: Workflow = {
  id: "w",
  name: "W",
  description: "",
  entry: "a",
  nodes: { a: { name: "A", instruction: "do a", skills: [] } },
  edges: [],
};
const beginInfo = () => ({
  workflow: wfx,
  input: {},
  sources: {},
  skills: new Map<string, Skill>(),
  config: {},
  writeState: createWriteStageState(),
});
const records = (j: RunJournal) => readJournal(j.file, { keyDir: KEYDIR }).records;
const create = (over: Partial<Parameters<typeof RunJournal.create>[0]> = {}) =>
  RunJournal.create({ keyDir: KEYDIR, runId: RUN, cwd: tmp(), ...over });

describe("a new run: private files", () => {
  it("creates the key dir, the run dir and the lock private to the user", () => {
    const keys = join(tmp(), "keys");
    const j = create({ keyDir: keys });
    j.begin(beginInfo());
    expect(statSync(keys).mode & 0o777).toBe(0o700);
    expect(statSync(j.dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(j.dir, "journal.lock")).mode & 0o777).toBe(0o600);
    expect(statSync(j.file).mode & 0o777).toBe(0o600);
    j.end("success");
  });

  it("without a writable key dir the run is not journaled, and says why", () => {
    const blocker = join(tmp(), "afile");
    writeFileSync(blocker, "x");
    const warn = vi.fn();
    const j = create({ keyDir: blocker, logger: { info() {}, warn, error() {}, debug() {} } });
    j.begin(beginInfo());
    expect(warn).toHaveBeenCalledTimes(2);
    const first = warn.mock.calls[0][0] as string;
    expect(first.startsWith(`  run journal: could not write the run key under ${blocker} (`)).toBe(true);
    expect(first.endsWith("); set SWENY_STATE_DIR to a writable dir")).toBe(true);
    expect(warn.mock.calls[1][0]).toBe("  run journal: no signing key for this run; this run cannot be resumed");
    expect(j.active).toBe(false);
    expect(existsSync(j.file)).toBe(false);
    j.nodeStart("a", 1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("end() writes one run:end however often it is called", () => {
    const j = create();
    j.begin(beginInfo());
    j.end("success");
    j.end("failed");
    expect(records(j).map((r) => [r.type, r.status])).toStrictEqual([
      ["run:start", undefined],
      ["run:end", "success"],
    ]);
  });
});

describe("usage records", () => {
  let now = 10_000;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  const usages = (j: RunJournal) => records(j).filter((r) => r.type === "usage");
  const begun = () => {
    const j = create();
    j.begin(beginInfo());
    return j;
  };

  it("records tokens and cost for an attempt, and nothing when the harness reported neither", () => {
    const j = begun();
    j.usage("a", 1, 0, {}, false);
    j.usage("a", 1, 0, { numTurns: 3 }, true);
    expect(usages(j)).toHaveLength(0);
    j.usage("a", 1, 0, { inputTokens: 5, outputTokens: 2, costUsd: 0.5 }, false);
    expect(usages(j)).toHaveLength(1);
    expect(usages(j)[0]).toMatchObject({ node: "a", iteration: 1, attempt: 0, tokens: 7, cost_usd: 0.5, final: false });
  });

  it("a missing half is zero", () => {
    const j = begun();
    j.usage("a", 1, 0, { costUsd: 0.25 }, false);
    j.usage("a", 1, 1, { inputTokens: 4 }, false);
    expect(usages(j).map((r) => [r.tokens, r.cost_usd])).toStrictEqual([
      [0, 0.25],
      [4, 0],
    ]);
  });

  it("live reports are throttled: one per interval, and only when spend grew", () => {
    const j = begun();
    j.usage("a", 1, 0, { inputTokens: 10 }, false);
    now += USAGE_JOURNAL_INTERVAL_MS - 1;
    j.usage("a", 1, 0, { inputTokens: 20 }, false);
    expect(usages(j)).toHaveLength(1);
    now += 1;
    j.usage("a", 1, 0, { inputTokens: 20 }, false);
    expect(usages(j).map((r) => r.tokens)).toStrictEqual([10, 20]);
    now += USAGE_JOURNAL_INTERVAL_MS;
    j.usage("a", 1, 0, { inputTokens: 20 }, false);
    j.usage("a", 1, 0, { inputTokens: 5 }, false);
    expect(usages(j)).toHaveLength(2);
    j.usage("a", 1, 0, { inputTokens: 20, costUsd: 0.01 }, false);
    expect(usages(j).map((r) => [r.tokens, r.cost_usd])).toStrictEqual([
      [10, 0],
      [20, 0],
      [20, 0.01],
    ]);
  });

  it("a lower non-growing report is dropped even after the interval, but growth in either unit counts", () => {
    const j = begun();
    j.usage("a", 1, 0, { inputTokens: 10, costUsd: 1 }, false);
    now += USAGE_JOURNAL_INTERVAL_MS * 2;
    j.usage("a", 1, 0, { inputTokens: 10, costUsd: 1 }, false);
    j.usage("a", 1, 0, { inputTokens: 9, costUsd: 1 }, false);
    j.usage("a", 1, 0, { inputTokens: 10, costUsd: 0.5 }, false);
    expect(usages(j)).toHaveLength(1);
    j.usage("a", 1, 0, { inputTokens: 11, costUsd: 0.5 }, false);
    expect(usages(j)).toHaveLength(2);
  });

  it("the final report ignores the throttle but still only records growth", () => {
    const j = begun();
    j.usage("a", 1, 0, { inputTokens: 10, costUsd: 1 }, false);
    j.usage("a", 1, 0, { inputTokens: 10, costUsd: 1 }, true);
    j.usage("a", 1, 0, { inputTokens: 9, costUsd: 1 }, true);
    expect(usages(j)).toHaveLength(1);
    j.usage("a", 1, 0, { inputTokens: 10, costUsd: 2 }, true);
    j.usage("a", 1, 0, { inputTokens: 11, costUsd: 2 }, true);
    expect(usages(j).map((r) => [r.tokens, r.cost_usd, r.final])).toStrictEqual([
      [10, 1, false],
      [10, 2, true],
      [11, 2, true],
    ]);
  });

  it("a first report is always recorded, final or not, even a tiny one", () => {
    const j = begun();
    j.usage("a", 1, 0, { inputTokens: 1 }, true);
    expect(usages(j)).toHaveLength(1);
    expect(usages(j)[0].final).toBe(true);
  });

  it("remembers the largest spend seen per unit, not the last report's", () => {
    const j = begun();
    j.usage("a", 1, 0, { inputTokens: 100, costUsd: 1 }, false);
    now += USAGE_JOURNAL_INTERVAL_MS;
    j.usage("a", 1, 0, { inputTokens: 50, costUsd: 2 }, false);
    j.usage("a", 1, 0, { inputTokens: 80, costUsd: 2 }, true);
    j.usage("a", 1, 0, { inputTokens: 100, costUsd: 3 }, true);
    expect(usages(j).map((r) => [r.tokens, r.cost_usd])).toStrictEqual([
      [100, 1],
      [50, 2],
      [100, 3],
    ]);
  });

  it("tracks each node, iteration and attempt on its own", () => {
    const j = begun();
    j.usage("a", 1, 0, { inputTokens: 10 }, false);
    j.usage("a", 1, 1, { inputTokens: 10 }, false);
    j.usage("a", 2, 0, { inputTokens: 10 }, false);
    j.usage("b", 1, 0, { inputTokens: 10 }, false);
    expect(usages(j).map((r) => [r.node, r.iteration, r.attempt])).toStrictEqual([
      ["a", 1, 0],
      ["a", 1, 1],
      ["a", 2, 0],
      ["b", 1, 0],
    ]);
  });

  it("priorSpend is a copy of what the resumed run already spent, and unknown for a fresh run", () => {
    expect(create().priorSpend()).toBeUndefined();
    const recs = [
      startRec(),
      ns("a"),
      rec("usage", { node: "a", iteration: 1, attempt: 0, tokens: 3, cost_usd: 0.5, final: true }),
    ];
    const plan = buildResumePlan(recs);
    const cwd = tmp();
    mkdirSync(KEYDIR, { recursive: true });
    writeFileSync(runKeyFile(cwd, RUN, KEYDIR), KEY.toString("hex") + "\n");
    const j = RunJournal.openForResume({
      runId: RUN,
      cwd,
      keyDir: KEYDIR,
      read: { file: join(journalDir(cwd, RUN), JOURNAL_FILE), records: recs, truncatedBytes: 0 },
      plan,
    });
    expect(j.priorSpend()).toStrictEqual({ tokens: 3, costUsd: 0.5 });
    expect(j.priorSpend()).not.toBe(plan.priorSpend);
    j.priorSpend()!.tokens = 99;
    expect(j.priorSpend()).toStrictEqual({ tokens: 3, costUsd: 0.5 });
  });
});

// ─── Secrets and the tool fingerprint ─────────────────────────────

const skillOf = (over: Record<string, unknown> = {}): Skill =>
  ({
    id: "s",
    name: "S",
    description: "d",
    category: "git",
    instruction: "use it",
    config: { TOKEN: { description: "", env: "S_TOKEN", required: true }, REGION: { description: "" } },
    tools: [
      {
        name: "t1",
        description: "first",
        input_schema: { type: "object" },
        access: "read",
        handler: async () => 1,
      },
      {
        name: "t2",
        description: "second",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
        access: "write",
        handler: async () => 2,
      },
    ],
    mcp: { type: "stdio", command: "npx", args: ["-y", "pkg"], env: { A: "1", B: "2" }, headers: { H: "v" } },
    mcpAliases: { t1: ["x"] },
    ...over,
  }) as unknown as Skill;
const hashOf = (s: Skill, version = "1.0.0", harness = "claude-code", secrets: string[] = []) =>
  toolsHash(new Map([[s.id, s]]), version, harness, secrets);

describe("runSecretValues", () => {
  const sk = (config: Record<string, { env?: string }> | undefined) =>
    ({ id: "s", name: "s", description: "", category: "git", config, tools: [] }) as unknown as Skill;

  it("collects secret env values and skill config values whose key looks secret, longest first", () => {
    const env = {
      MY_VAR: "config-secret-value",
      OTHER_VAR: "not-a-secret-key-value",
      GITHUB_TOKEN: "gh-secret-value",
      SHORT_TOKEN: "short",
      UNSET_VAR: undefined,
    };
    const skills = [
      sk({ API_TOKEN: { env: "MY_VAR" }, NAME: { env: "OTHER_VAR" }, NOENV: {}, GONE_TOKEN: { env: "UNSET_VAR" } }),
      sk(undefined),
    ];
    expect(runSecretValues(skills, env)).toStrictEqual(["config-secret-value", "gh-secret-value"]);
    expect(runSecretValues(undefined, env)).toStrictEqual(["gh-secret-value"]);
    expect(runSecretValues([], {})).toStrictEqual([]);
  });
});

describe("toolsHash fingerprint", () => {
  const base = hashOf(skillOf());

  it("is stable for the same skill, and independent of tool and config order", () => {
    expect(hashOf(skillOf())).toBe(base);
    const s = skillOf();
    s.tools = [...s.tools].reverse();
    s.config = Object.fromEntries(Object.entries(s.config).reverse());
    expect(hashOf(s)).toBe(base);
  });

  it("changes with each field that decides what the tools do", () => {
    const tool = (over: Record<string, unknown>) => {
      const s = skillOf();
      s.tools = [{ ...s.tools[0], ...over } as never, s.tools[1]];
      return s;
    };
    const variants: Record<string, Skill> = {
      id: skillOf({ id: "other" }),
      name: skillOf({ name: "Other" }),
      description: skillOf({ description: "other" }),
      category: skillOf({ category: "observability" }),
      instruction: skillOf({ instruction: "use it differently" }),
      configKey: skillOf({
        config: { TOKEN: { description: "", env: "S_TOKEN", required: true }, ZONE: { description: "" } },
      }),
      configEnv: skillOf({
        config: { TOKEN: { description: "", env: "OTHER_TOKEN", required: true }, REGION: { description: "" } },
      }),
      configRequired: skillOf({ config: { TOKEN: { description: "", env: "S_TOKEN" }, REGION: { description: "" } } }),
      toolName: tool({ name: "t0" }),
      toolDescription: tool({ description: "changed" }),
      toolSchema: tool({ input_schema: { type: "object", required: ["x"] } }),
      toolAccess: tool({ access: "write" }),
      toolAccessAbsent: tool({ access: undefined }),
      toolHandler: tool({ handler: async () => 99 }),
      toolNoHandler: tool({ handler: undefined }),
      mcpType: skillOf({
        mcp: { type: "http", command: "npx", args: ["-y", "pkg"], env: { A: "1", B: "2" }, headers: { H: "v" } },
      }),
      mcpCommand: skillOf({
        mcp: { type: "stdio", command: "node", args: ["-y", "pkg"], env: { A: "1", B: "2" }, headers: { H: "v" } },
      }),
      mcpArgs: skillOf({
        mcp: { type: "stdio", command: "npx", args: ["-y", "other"], env: { A: "1", B: "2" }, headers: { H: "v" } },
      }),
      mcpUrl: skillOf({
        mcp: {
          type: "stdio",
          command: "npx",
          args: ["-y", "pkg"],
          url: "https://m.test",
          env: { A: "1", B: "2" },
          headers: { H: "v" },
        },
      }),
      mcpEnvName: skillOf({
        mcp: { type: "stdio", command: "npx", args: ["-y", "pkg"], env: { A: "1", C: "2" }, headers: { H: "v" } },
      }),
      mcpHeaderName: skillOf({
        mcp: { type: "stdio", command: "npx", args: ["-y", "pkg"], env: { A: "1", B: "2" }, headers: { I: "v" } },
      }),
      mcpNoEnv: skillOf({ mcp: { type: "stdio", command: "npx", args: ["-y", "pkg"], headers: { H: "v" } } }),
      mcpNoHeaders: skillOf({ mcp: { type: "stdio", command: "npx", args: ["-y", "pkg"], env: { A: "1", B: "2" } } }),
      mcpNoArgs: skillOf({ mcp: { type: "stdio", command: "npx", env: { A: "1", B: "2" }, headers: { H: "v" } } }),
      mcpGone: skillOf({ mcp: undefined }),
      aliases: skillOf({ mcpAliases: { t1: ["y"] } }),
      aliasesGone: skillOf({ mcpAliases: undefined }),
    };
    for (const [what, s] of Object.entries(variants)) expect(hashOf(s), what).not.toBe(base);
    expect(new Set(Object.values(variants).map((s) => hashOf(s))).size).toBe(Object.keys(variants).length);
  });

  it("does not change with MCP env or header values: rotating a token is not a tool change", () => {
    const rotated = skillOf({
      mcp: {
        type: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { A: "other", B: "values" },
        headers: { H: "rotated" },
      },
    });
    expect(hashOf(rotated)).toBe(base);
  });

  it("redacts secrets out of MCP args and url before hashing, so a rotated secret leaves the same hash", () => {
    const withSecret = (value: string) =>
      skillOf({ mcp: { type: "http", command: "npx", args: ["--key", value], url: `https://m.test/?k=${value}` } });
    const a = hashOf(withSecret("secret-value-AAAA"), "1", "h", ["secret-value-AAAA"]);
    const b = hashOf(withSecret("secret-value-BBBB"), "1", "h", ["secret-value-BBBB"]);
    expect(a).toBe(b);
    expect(hashOf(withSecret("secret-value-AAAA"), "1", "h")).not.toBe(
      hashOf(withSecret("secret-value-BBBB"), "1", "h"),
    );
  });

  it("changes with the sweny version and the harness, and a missing one differs from a named one", () => {
    expect(hashOf(skillOf(), "1.0.1")).not.toBe(base);
    expect(hashOf(skillOf(), "1.0.0", "codex")).not.toBe(base);
    expect(toolsHash(new Map([["s", skillOf()]]))).not.toBe(base);
    expect(toolsHash(new Map([["s", skillOf()]]), "1.0.0")).not.toBe(base);
    expect(toolsHash(new Map([["s", skillOf()]]))).toBe(toolsHash(new Map([["s", skillOf()]]), undefined, undefined));
  });

  it("tolerates a skill with no config, tools or optional fields", () => {
    const bare = { id: "b" } as unknown as Skill;
    expect(() => toolsHash(new Map([["b", bare]]))).not.toThrow();
    expect(toolsHash(new Map([["b", bare]]))).toMatch(/^[0-9a-f]{64}$/);
  });
});

// A read of the journal's own file leaves nothing behind in the workspace but the journal.
describe("workspace contents", () => {
  it("the signing key is never written inside the workspace", () => {
    const cwd = tmp();
    const j = RunJournal.create({ keyDir: KEYDIR, runId: RUN, cwd });
    j.begin(beginInfo());
    j.end("success");
    const inWorkspace = readFileSync(j.file, "utf-8") + readFileSync(join(j.dir, ".gitignore"), "utf-8");
    expect(inWorkspace).not.toContain(readFileSync(runKeyFile(cwd, RUN, KEYDIR), "utf-8").trim());
    expect(runKeyFile(cwd, RUN, KEYDIR).startsWith(cwd)).toBe(false);
  });
});
