/**
 * Edge assertions found by mutation testing of journal.ts: hashing, redaction
 * (what must never reach disk), record verification and torn-tail repair, the
 * resume plan, and the provider lookup that stops a resume from writing twice.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  JOURNAL_DIR,
  JOURNAL_FILE,
  JournalLockedError,
  JournalMismatchError,
  JournalVersionError,
  REDACTED,
  RunJournal,
  buildResumePlan,
  canonicalHash,
  collectSecretValues,
  findJournalRun,
  instructionHash,
  isSecretKey,
  journalDir,
  listJournalRuns,
  markerToken,
  mayRepeatWrites,
  pruneJournals,
  readJournal,
  redact,
  toolsHash,
  workflowHashOf,
  type JournalRecord,
  type ResumeJournalOptions,
  type ResumePlan,
} from "../../journal.js";
import { createWriteStageState } from "../../safe-outputs.js";
import { CURRENT_SPEC_VERSION } from "../../migrations.js";
import type { NodeResult, Skill, Workflow } from "../../types.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sweny-journal-edges-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const RUN = "20260930-120000-0a0b0c";

describe("hashing", () => {
  it("canonicalHash is sha256 of key-sorted JSON with undefined dropped", () => {
    expect(canonicalHash({ b: 1, a: [{ d: 2, c: undefined, b: { z: 1, y: 2 } }] })).toBe(
      sha('{"a":[{"b":{"y":2,"z":1},"d":2}],"b":1}'),
    );
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    expect(canonicalHash(undefined)).toBe(sha("null"));
    expect(canonicalHash(null)).toBe(sha("null"));
    expect(canonicalHash("s")).toBe(sha('"s"'));
    expect(canonicalHash({})).toBe(sha("{}"));
  });

  it("workflowHashOf binds the effective spec_version", () => {
    const wf = { id: "w", entry: "a", nodes: {}, edges: [] } as unknown as Workflow;
    expect(workflowHashOf(wf)).toBe(canonicalHash({ ...wf, spec_version: String(CURRENT_SPEC_VERSION) }));
    expect(workflowHashOf({ ...wf, spec_version: "1" } as Workflow)).toBe(canonicalHash({ ...wf, spec_version: "1" }));
  });

  it("instructionHash hashes each source's content, empty when absent", () => {
    expect(instructionHash({ a: { content: "x" }, b: { content: "y" } })).toBe(canonicalHash({ a: "x", b: "y" }));
    expect(instructionHash({ a: undefined as never })).toBe(canonicalHash({ a: "" }));
    expect(instructionHash({})).toBe(canonicalHash({}));
  });

  it("toolsHash covers skill ids, sorted tool names with access, mcp presence, versions", () => {
    const skill = (id: string, tools: [string, "read" | "write" | undefined][], mcp?: Skill["mcp"]): Skill => ({
      id,
      name: id,
      description: "",
      category: "git",
      config: {},
      tools: tools.map(([name, access]) => ({
        name,
        description: "",
        input_schema: { type: "object" },
        ...(access ? { access } : {}),
        handler: async () => null,
      })),
      ...(mcp ? { mcp } : {}),
    });
    const b = skill(
      "b",
      [
        ["t2", undefined],
        ["t1", "read"],
      ],
      { url: "https://m.test" },
    );
    const a = skill("a", [["x", "write"]], { command: "npx" });
    const c = skill("c", [], { type: "stdio" });
    const forward = new Map([
      ["b", b],
      ["a", a],
      ["c", c],
    ]);
    const reverse = new Map([
      ["c", c],
      ["a", a],
      ["b", b],
    ]);
    const expected = canonicalHash({
      skills: [
        { id: "a", tools: ["x:write"], mcp: "npx" },
        { id: "b", tools: ["t1:read", "t2:unclassified"], mcp: "https://m.test" },
        { id: "c", tools: [], mcp: "mcp" },
      ],
      sweny: "1.2.3",
      harness: "codex",
    });
    expect(toolsHash(forward, "1.2.3", "codex")).toBe(expected);
    expect(toolsHash(reverse, "1.2.3", "codex")).toBe(expected);
    expect(toolsHash(new Map([["d", skill("d", [])]]))).toBe(
      canonicalHash({ skills: [{ id: "d", tools: [], mcp: null }], sweny: null, harness: null }),
    );
    expect(toolsHash(forward, "1.2.3", "codex")).not.toBe(toolsHash(forward, "1.2.4", "codex"));
    expect(toolsHash(forward, "1.2.3", "codex")).not.toBe(toolsHash(forward, "1.2.3", "pi"));
  });

  it("markerToken is a fixed prefix plus the first 24 key characters", () => {
    expect(markerToken("0123456789abcdef0123456789abcdef")).toBe("swenyk0123456789abcdef01234567");
    expect(markerToken("abc")).toBe("swenykabc");
  });
});

describe("secret detection", () => {
  it("isSecretKey matches the credential vocabulary however it is spelled", () => {
    for (const k of [
      "GITHUB_TOKEN",
      "apiKey",
      "api-key",
      "client-secret",
      "Authorization",
      "DB_PASSWORD",
      "passwd",
      "private_key",
      "Set-Cookie",
      "session_id",
      "AWS_CREDENTIALS",
    ]) {
      expect(isSecretKey(k), k).toBe(true);
    }
    for (const k of ["title", "name", "body", "key", "monkey", "number", "id", ""]) {
      expect(isSecretKey(k), k).toBe(false);
    }
  });

  it("collectSecretValues keeps secret-named values of 8+ characters, longest first, deduplicated", () => {
    expect(
      collectSecretValues(
        { GITHUB_TOKEN: "12345678", API_KEY: "1234567", NAME: "notasecretvalue", PASSWORD: "longer-password-value" },
        undefined,
        { client_secret: "12345678", other_token: undefined, x_token: "abcdefghij" },
      ),
    ).toStrictEqual(["longer-password-value", "abcdefghij", "12345678"]);
    expect(collectSecretValues()).toStrictEqual([]);
  });
});

describe("redact", () => {
  const scrub = (s: string) => redact(s).value as string;
  const tok = (prefix: string, n: number, alphabet = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6") =>
    prefix + alphabet.repeat(3).slice(0, n);

  it("redacts GitHub tokens of 20+ characters for every prefix, and not shorter or other prefixes", () => {
    for (const p of ["ghp_", "ghu_", "gho_", "ghs_", "ghr_"]) {
      expect(scrub(`x ${tok(p, 20)} y`)).toBe(`x ${REDACTED} y`);
      expect(scrub(`x ${tok(p, 19)} y`)).toBe(`x ${tok(p, 19)} y`);
    }
    expect(scrub(tok("ghx_", 30))).toBe(tok("ghx_", 30));
    expect(scrub(tok("ghp_", 30).replace("ghp_", "ghp_!"))).not.toContain(REDACTED);
    expect(scrub(`x${tok("ghp_", 30)}`)).toBe(`x${tok("ghp_", 30)}`);
  });

  it("redacts the remaining token shapes at their minimum length", () => {
    const cases: [string, number, number][] = [
      ["github_pat_", 20, 19],
      ["sk-", 20, 19],
      ["xoxb-", 10, 9],
      ["xoxa-", 10, 9],
      ["xoxp-", 10, 9],
      ["xoxr-", 10, 9],
      ["xoxs-", 10, 9],
      ["lin_api_", 20, 19],
    ];
    for (const [prefix, min, short] of cases) {
      expect(scrub(`k=${tok(prefix, min)}!`), prefix).toBe(`k=${REDACTED}!`);
      expect(scrub(`k=${tok(prefix, short)}!`), prefix).toBe(`k=${tok(prefix, short)}!`);
    }
    expect(scrub(tok("xoxz-", 20))).toBe(tok("xoxz-", 20));
  });

  it("matches the full character class of each shape, not just its first characters", () => {
    expect(scrub(`${tok("github_pat_", 20)}_${tok("", 5)}`)).toBe(REDACTED);
    expect(scrub("sk-ant-api03-abc_DEF-ghi1234567890")).toBe(REDACTED);
    expect(scrub(`${"xoxb-"}12345-67890-abcde`)).toBe(REDACTED);
    expect(scrub("sk-" + "a".repeat(10) + " " + "b".repeat(10))).toBe(`sk-${"a".repeat(10)} ${"b".repeat(10)}`);
  });

  it("redacts an AWS key id only at exactly 16 trailing characters", () => {
    expect(scrub("id AKIAABCDEFGHIJKLMNOP end")).toBe(`id ${REDACTED} end`);
    expect(scrub("id AKIAABCDEFGHIJKLMNO end")).toBe("id AKIAABCDEFGHIJKLMNO end");
    expect(scrub("id AKIAABCDEFGHIJKLMNOPQ end")).toBe("id AKIAABCDEFGHIJKLMNOPQ end");
    expect(scrub("id AKIAabcdefghijklmnop end")).toBe("id AKIAabcdefghijklmnop end");
  });

  it("redacts a whole private key block, each block separately", () => {
    const block = (kind: string) => `-----BEGIN ${kind}PRIVATE KEY-----\nMIIabc\ndef\n-----END ${kind}PRIVATE KEY-----`;
    expect(scrub(`a ${block("RSA ")} b ${block("")} c ${block("OPENSSH ")} d`)).toBe(
      `a ${REDACTED} b ${REDACTED} c ${REDACTED} d`,
    );
    expect(scrub("-----BEGIN rsa PRIVATE KEY-----\nx\n-----END rsa PRIVATE KEY-----")).toContain("BEGIN rsa");
  });

  it("redacts every occurrence and works on repeated calls (global regex state)", () => {
    const s = `${tok("ghp_", 24)} and ${tok("ghp_", 30)}`;
    expect(scrub(s)).toBe(`${REDACTED} and ${REDACTED}`);
    expect(scrub(s)).toBe(`${REDACTED} and ${REDACTED}`);
    expect(redact(s).redacted).toBe(true);
    expect(redact(s).redacted).toBe(true);
  });

  it("redacts every occurrence of a known secret value and reports it", () => {
    const r = redact({ a: "x s3cretvalue y s3cretvalue", b: ["s3cretvalue"], c: "clean" }, ["s3cretvalue"]);
    expect(r).toStrictEqual({ value: { a: `x ${REDACTED} y ${REDACTED}`, b: [REDACTED], c: "clean" }, redacted: true });
    expect(redact({ a: "clean" }, ["s3cretvalue"])).toStrictEqual({ value: { a: "clean" }, redacted: false });
    expect(redact("plain")).toStrictEqual({ value: "plain", redacted: false });
  });

  it("replaces non-empty strings under secret keys, wherever they are", () => {
    const r = redact({
      GITHUB_TOKEN: "x",
      nested: { apiKey: "short", list: [{ password: "p" }] },
      empty: "",
      token: "",
    });
    expect(r.value).toStrictEqual({
      GITHUB_TOKEN: REDACTED,
      nested: { apiKey: REDACTED, list: [{ password: REDACTED }] },
      empty: "",
      token: "",
    });
    expect(r.redacted).toBe(true);
    expect(redact({ token: "" }).redacted).toBe(false);
  });

  it("keeps numbers, booleans and null, even under secret-looking keys, and drops undefined and functions", () => {
    const r = redact({
      inputTokens: 5,
      tokenCount: 0,
      flag: true,
      none: null,
      gone: undefined,
      fn: () => 1,
      nested: [1, false, null],
    });
    expect(r.value).toStrictEqual({ inputTokens: 5, tokenCount: 0, flag: true, none: null, nested: [1, false, null] });
    expect("gone" in (r.value as object)).toBe(false);
    expect("fn" in (r.value as object)).toBe(false);
    expect(r.redacted).toBe(false);
    expect(redact({ token: 5 }).redacted).toBe(false);
  });

  it("cuts anything nested deeper than 64 levels", () => {
    const wrap = (n: number) => {
      let v: unknown = "leaf";
      for (let i = 0; i < n; i++) v = [v];
      return v;
    };
    const unwrap = (v: unknown, n: number) => {
      let cur = v;
      for (let i = 0; i < n; i++) cur = (cur as unknown[])[0];
      return cur;
    };
    expect(unwrap(redact(wrap(64)).value, 64)).toBe("leaf");
    expect(unwrap(redact(wrap(65)).value, 65)).toBeNull();
    expect(unwrap(redact(wrap(100)).value, 65)).toBeNull();
  });
});

// ─── Record verification ──────────────────────────────────────────

function line(
  seq: number,
  type: string,
  fields: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
): string {
  const body = { v: 1, seq, type, at: "2026-01-01T00:00:00.000Z", ...fields };
  return JSON.stringify({ ...body, h: sha(JSON.stringify(body)).slice(0, 16), ...over });
}

function journalFile(text: string): string {
  const file = join(tmp(), JOURNAL_FILE);
  writeFileSync(file, text);
  return file;
}

describe("readJournal", () => {
  it("reads a clean file", () => {
    const lines = [
      line(1, "run:start"),
      line(2, "node:start", { node: "a" }),
      line(3, "route", { from: "a", to: null }),
    ];
    const file = journalFile(lines.join("\n") + "\n");
    expect(readJournal(file)).toStrictEqual({ file, records: lines.map((l) => JSON.parse(l)), truncatedBytes: 0 });
  });

  it("drops a torn tail, and only truncates the file when asked", () => {
    const good = [line(1, "run:start"), line(2, "route")].join("\n") + "\n";
    const torn = '{"v":1,"seq":3,"type":"no';
    const file = journalFile(good + torn);
    const r = readJournal(file);
    expect(r.records).toHaveLength(2);
    expect(r.truncatedBytes).toBe(Buffer.byteLength(torn));
    expect("corruptAtLine" in r).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(good + torn);
    readJournal(file, { repair: true });
    expect(readFileSync(file, "utf-8")).toBe(good);
    expect(readJournal(file, { repair: true }).truncatedBytes).toBe(0);
  });

  it("treats a whole record with no trailing newline as torn", () => {
    const first = line(1, "run:start") + "\n";
    const second = line(2, "route");
    const r = readJournal(journalFile(first + second));
    expect(r.records).toHaveLength(1);
    expect(r.truncatedBytes).toBe(Buffer.byteLength(second));
  });

  it("a bad line with garbage after it is a torn tail: repairable", () => {
    const good = line(1, "run:start") + "\n";
    const file = journalFile(good + "garbage\n" + "more garbage\n");
    const r = readJournal(file, { repair: true });
    expect(r.records).toHaveLength(1);
    expect("corruptAtLine" in r).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(good);
  });

  it("a bad line followed by a record-shaped line is mid-file damage: reported, never repaired", () => {
    const l1 = line(1, "run:start");
    const l2 = line(2, "route", {}, { h: "0000000000000000" });
    const l3 = line(3, "route");
    const text = [l1, l2, l3].join("\n") + "\n";
    const file = journalFile(text);
    const r = readJournal(file, { repair: true });
    expect(r.records).toHaveLength(1);
    expect(r.corruptAtLine).toBe(2);
    expect(r.truncatedBytes).toBe(Buffer.byteLength(l2) + Buffer.byteLength(l3) + 2);
    expect(readFileSync(file, "utf-8")).toBe(text);
  });

  it("reports the first bad line when several come before a record-shaped one", () => {
    const text = [line(1, "run:start"), "bad one", "bad two", '{"v":1,"h":"abc"}'].join("\n") + "\n";
    expect(readJournal(journalFile(text)).corruptAtLine).toBe(2);
  });

  it("only a JSON object with a numeric v and a string h looks like a record", () => {
    for (const after of ['{"v":"1","h":"x"}', '{"v":1}', '{"v":1,"h":5}', "null", "[]", "7", "not json"]) {
      const r = readJournal(journalFile([line(1, "run:start"), "bad", after].join("\n") + "\n"));
      expect("corruptAtLine" in r, after).toBe(false);
    }
    expect(
      readJournal(journalFile([line(1, "run:start"), "bad", '{"v":1,"h":"abc"}'].join("\n") + "\n")).corruptAtLine,
    ).toBe(2);
  });

  it("rejects records that are not objects, are out of sequence, mis-versioned, mistyped or unsigned", () => {
    const body = { v: 1, seq: 1, type: "run:start", at: "t" };
    const signed = (b: object) => JSON.stringify({ ...b, h: sha(JSON.stringify(b)).slice(0, 16) });
    const bad = [
      "[]",
      "null",
      "7",
      '"s"',
      signed({ ...body, seq: 2 }),
      signed({ ...body, seq: "1" }),
      signed({ ...body, v: 0 }),
      signed({ ...body, v: "1" }),
      signed({ ...body, type: 5 }),
      JSON.stringify(body),
      JSON.stringify({ ...body, h: 5 }),
      JSON.stringify({ ...body, h: "0000000000000000" }),
    ];
    for (const b of bad) {
      const r = readJournal(journalFile(b + "\n"));
      expect(r.records, b).toHaveLength(0);
      expect(r.truncatedBytes, b).toBe(Buffer.byteLength(b) + 1);
    }
  });

  it("an edited field fails the checksum", () => {
    const edited = line(1, "route", { from: "a", to: "b" }).replace('"to":"b"', '"to":"c"');
    expect(readJournal(journalFile(edited + "\n")).records).toHaveLength(0);
  });

  it("refuses a newer format with the version in the message", () => {
    const file = journalFile(line(1, "run:start") + "\n" + line(2, "route", {}, { v: 2 }) + "\n");
    expect(() => readJournal(file)).toThrow(JournalVersionError);
    expect(() => readJournal(file)).toThrow(
      "run journal format v2 is newer than this sweny understands (v1); upgrade sweny to resume it",
    );
    try {
      readJournal(file);
    } catch (e) {
      expect((e as Error).name).toBe("JournalVersionError");
    }
  });
});

describe("journal errors", () => {
  it("name what changed and how to proceed", () => {
    const e = new JournalMismatchError(["the workflow", "the input"]);
    expect(e.name).toBe("JournalMismatchError");
    expect(e.what).toStrictEqual(["the workflow", "the input"]);
    expect(e.message).toBe(
      "cannot resume: the workflow, the input changed since this run was journaled. " +
        "Resuming would mix results from two different runs. Start a new run, or pass --force to resume anyway.",
    );
    const l = new JournalLockedError(42);
    expect(l.name).toBe("JournalLockedError");
    expect(l.message).toBe("run journal is in use by process 42; wait for it to finish (or stop it) before resuming");
  });
});

// ─── Journals on disk ─────────────────────────────────────────────

function seedRuns(cwd: string, ids: string[], withFile = true): void {
  for (const id of ids) {
    const d = join(cwd, JOURNAL_DIR, id);
    mkdirSync(d, { recursive: true });
    if (withFile) writeFileSync(join(d, JOURNAL_FILE), line(1, "run:start") + "\n");
  }
}

describe("journal directory", () => {
  it("lists only well-formed run ids that have a journal, oldest first", () => {
    const cwd = tmp();
    seedRuns(cwd, ["20260102-000000-000002", "20260101-000000-000001"]);
    seedRuns(cwd, ["20260103-000000-000003"], false);
    seedRuns(cwd, [
      "20260101-000000-00000G",
      "20260101-000000-ABCDEF",
      "20260101-000000-0000001",
      "20260101-000000-00001",
      "x20260101-000000-000001",
      "20260101-000000-000001x",
      "notarun",
    ]);
    expect(listJournalRuns(cwd)).toStrictEqual(["20260101-000000-000001", "20260102-000000-000002"]);
    expect(listJournalRuns(join(cwd, "missing"))).toStrictEqual([]);
    expect(journalDir(cwd, "r")).toBe(join(cwd, JOURNAL_DIR, "r"));
  });

  it("finds a run by exact id or a unique prefix", () => {
    const cwd = tmp();
    seedRuns(cwd, ["20260101-000000-aaaaaa", "20260101-000000-aabbbb", "20260202-000000-cccccc"]);
    expect(findJournalRun("20260101-000000-aaaaaa", cwd)).toBe("20260101-000000-aaaaaa");
    expect(findJournalRun("20260202", cwd)).toBe("20260202-000000-cccccc");
    expect(findJournalRun("20260101", cwd)).toBeUndefined();
    expect(findJournalRun("20260101-000000-aaa", cwd)).toBe("20260101-000000-aaaaaa");
    expect(findJournalRun("2027", cwd)).toBeUndefined();
  });

  it("prunes the oldest beyond keep, whole directories, never the excepted run", () => {
    const cwd = tmp();
    const ids = [
      "20260101-000000-000001",
      "20260102-000000-000002",
      "20260103-000000-000003",
      "20260104-000000-000004",
      "20260105-000000-000005",
    ];
    seedRuns(cwd, ids);
    writeFileSync(join(cwd, JOURNAL_DIR, ids[0], "extra.txt"), "x");
    expect(pruneJournals(cwd, 3)).toBe(2);
    expect(listJournalRuns(cwd)).toStrictEqual(ids.slice(2));
    expect(existsSync(journalDir(cwd, ids[0]))).toBe(false);
    expect(pruneJournals(cwd, 3)).toBe(0);
    // The current run counts toward the cap and is never removed, even when it is the oldest.
    expect(pruneJournals(cwd, 2, ids[2])).toBe(1);
    expect(listJournalRuns(cwd)).toStrictEqual([ids[2], ids[4]]);
    expect(pruneJournals(cwd, 0, ids[4])).toBe(1);
    expect(listJournalRuns(cwd)).toStrictEqual([ids[4]]);
  });
});

// ─── Resume plan ──────────────────────────────────────────────────

let seqCounter = 0;
function rec(type: string, fields: Record<string, unknown> = {}): JournalRecord {
  return { v: 1, seq: ++seqCounter, type, at: "t", ...fields };
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
const ok = (data: Record<string, unknown> = {}): NodeResult => ({ status: "success", data, toolCalls: [] });
const failed = (): NodeResult => ({ status: "failed", data: {}, toolCalls: [] });
const ws = (total: number) => ({ counts: [["a:issue", total]], total, seen: ["k"] });
const nodeStart = (node: string, iteration = 0) => rec("node:start", { node, iteration });
const nodeEnd = (node: string, result: NodeResult, iteration = 0, total = 1) =>
  rec("node:end", { node, iteration, result, write_state: ws(total) });
const checkpoint = (node: string, iteration = 0) =>
  rec("node:checkpoint", { node, iteration, result: ok(), intents: [], agent_failed: false, attempt: 1 });
const route = (from: string, to: string | null | undefined) => rec("route", { from, to });

describe("buildResumePlan", () => {
  it("refuses a journal with no run:start", () => {
    expect(() => buildResumePlan([rec("node:start", { node: "a", iteration: 0 })])).toThrow(
      "run journal has no run:start record; nothing to resume",
    );
  });

  it("a run killed before any node starts resumes at the entry", () => {
    const plan = buildResumePlan([startRec({ workflow_entry: "entry" })]);
    expect(plan.visits).toStrictEqual([]);
    expect(plan.freshNode).toBe("entry");
    expect(plan.finished).toBe(false);
    expect(plan.attempts).toBe(1);
    expect(plan.runId).toBe(RUN);
    expect("writeState" in plan).toBe(false);
    expect("lastStatus" in plan).toBe(false);
  });

  it("replays finished visits with their route, and picks up at the first unfinished one", () => {
    const plan = buildResumePlan([
      startRec(),
      nodeStart("a"),
      nodeEnd("a", ok(), 0, 1),
      route("a", "b"),
      nodeStart("b"),
      checkpoint("b"),
      nodeStart("c"),
      nodeEnd("c", ok(), 0, 9),
    ]);
    expect(plan.visits).toStrictEqual([
      { node: "a", iteration: 0, action: "replay", status: "success", next: "b", applied: 0, unconfirmed: 0 },
      { node: "b", iteration: 0, action: "write-stage", applied: 0, unconfirmed: 0 },
    ]);
    expect(plan.freshNode).toBeUndefined();
    expect(plan.finished).toBe(false);
    expect(plan.writeState).toStrictEqual(ws(1));
    expect([...plan.checkpoints.keys()]).toStrictEqual(["b#0"]);
    expect([...plan.ends.keys()]).toStrictEqual(["a#0", "c#0"]);
  });

  it("an unfinished visit with no checkpoint re-runs", () => {
    const plan = buildResumePlan([startRec(), nodeStart("a")]);
    expect(plan.visits).toStrictEqual([{ node: "a", iteration: 0, action: "rerun", applied: 0, unconfirmed: 0 }]);
    expect(plan.freshNode).toBeUndefined();
  });

  it("a finished run whose last route ended it is finished; one routed on continues at the next node", () => {
    const done = buildResumePlan([startRec(), nodeStart("a"), nodeEnd("a", ok()), route("a", null)]);
    expect(done.finished).toBe(true);
    expect(done.visits[0].next).toBeNull();
    expect(done.freshNode).toBeUndefined();
    const undefinedTo = buildResumePlan([startRec(), nodeStart("a"), nodeEnd("a", ok()), route("a", undefined)]);
    expect(undefinedTo.finished).toBe(true);
    const routed = buildResumePlan([startRec(), nodeStart("a"), nodeEnd("a", ok()), route("a", "b")]);
    expect(routed.finished).toBe(false);
    expect(routed.freshNode).toBe("b");
    const unrouted = buildResumePlan([startRec(), nodeStart("a"), nodeEnd("a", ok())]);
    expect(unrouted.finished).toBe(false);
    expect(unrouted.freshNode).toBeUndefined();
    expect(unrouted.visits[0].next).toBeUndefined();
  });

  it("the last visit re-runs when it ended failed and was not routed on; a failed visit routed on is complete", () => {
    const stuck = buildResumePlan([startRec(), nodeStart("a"), nodeEnd("a", failed())]);
    expect(stuck.visits.map((v) => v.action)).toStrictEqual(["rerun"]);
    const stuckWithCp = buildResumePlan([startRec(), nodeStart("a"), checkpoint("a"), nodeEnd("a", failed())]);
    expect(stuckWithCp.visits.map((v) => v.action)).toStrictEqual(["write-stage"]);
    const routedOn = buildResumePlan([startRec(), nodeStart("a"), nodeEnd("a", failed()), route("a", "recover")]);
    expect(routedOn.visits.map((v) => [v.action, v.status])).toStrictEqual([["replay", "failed"]]);
    expect(routedOn.freshNode).toBe("recover");
    const earlier = buildResumePlan([
      startRec(),
      nodeStart("a"),
      nodeEnd("a", failed()),
      nodeStart("b"),
      nodeEnd("b", ok()),
      route("b", null),
    ]);
    expect(earlier.visits.map((v) => v.action)).toStrictEqual(["replay", "replay"]);
    expect(earlier.finished).toBe(true);
  });

  it("a route belongs to the latest visit of its node", () => {
    const plan = buildResumePlan([
      startRec(),
      nodeStart("a", 0),
      nodeEnd("a", ok(), 0),
      route("a", "b"),
      nodeStart("b", 0),
      nodeEnd("b", ok(), 0),
      route("b", "a"),
      nodeStart("a", 1),
      nodeEnd("a", ok(), 1),
      route("a", "done"),
    ]);
    expect(plan.visits.map((v) => [v.node, v.iteration, v.next])).toStrictEqual([
      ["a", 0, "b"],
      ["b", 0, "a"],
      ["a", 1, "done"],
    ]);
    expect(plan.freshNode).toBe("done");
  });

  it("a visit started again drops its earlier end and route", () => {
    const plan = buildResumePlan([
      startRec(),
      nodeStart("a"),
      nodeEnd("a", failed()),
      route("a", "b"),
      rec("run:resume", { attempt: 2 }),
      nodeStart("a"),
    ]);
    expect(plan.visits).toStrictEqual([{ node: "a", iteration: 0, action: "rerun", applied: 0, unconfirmed: 0 }]);
    expect(plan.ends.size).toBe(0);
    const again = buildResumePlan([
      startRec(),
      nodeStart("a"),
      nodeEnd("a", failed()),
      rec("run:resume"),
      nodeStart("a"),
      nodeEnd("a", ok({ v: 2 })),
      route("a", null),
    ]);
    expect(again.visits[0]).toMatchObject({ action: "replay", status: "success", next: null });
    expect(again.finished).toBe(true);
    expect((again.ends.get("a#0")!.result as NodeResult).data).toStrictEqual({ v: 2 });
  });

  it("ignores checkpoints, ends and routes for visits that never started", () => {
    const plan = buildResumePlan([
      startRec(),
      checkpoint("ghost"),
      nodeEnd("ghost", ok()),
      route("ghost", "x"),
      nodeStart("a"),
    ]);
    expect(plan.checkpoints.size).toBe(0);
    expect(plan.ends.size).toBe(0);
    expect(plan.visits.map((v) => v.node)).toStrictEqual(["a"]);
  });

  it("counts resumes and tracks the last run:end", () => {
    expect(buildResumePlan([startRec(), rec("run:end", { status: "failed" })]).lastStatus).toBe("failed");
    expect(
      buildResumePlan([startRec(), rec("run:end", { status: "failed" }), rec("run:resume")]).lastStatus,
    ).toBeUndefined();
    const twice = buildResumePlan([
      startRec(),
      rec("run:resume"),
      rec("run:resume"),
      rec("run:end", { status: "success" }),
    ]);
    expect(twice.attempts).toBe(3);
    expect(twice.lastStatus).toBe("success");
  });

  it("counts a visit's own receipts and unconfirmed intents only", () => {
    const out = (type: string, node: string, iteration: number, key: string) =>
      rec(type, { node, iteration, key, tool: "github_create_issue" });
    const plan = buildResumePlan([
      startRec(),
      nodeStart("a"),
      out("output:intent", "a", 0, "k1"),
      out("output:applied", "a", 0, "k1"),
      out("output:intent", "a", 0, "k2"),
      out("output:intent", "a", 1, "k3"),
      out("output:applied", "b", 0, "k4"),
    ]);
    expect(plan.visits[0]).toMatchObject({ applied: 1, unconfirmed: 1 });
    expect([...plan.intents.keys()]).toStrictEqual(["k1", "k2", "k3"]);
    expect([...plan.receipts.keys()]).toStrictEqual(["k1", "k4"]);
  });
});

describe("mayRepeatWrites", () => {
  const wf = {
    id: "w",
    entry: "a",
    nodes: {
      writer: { name: "W", instruction: "x", skills: [] },
      reader: { name: "R", instruction: "x", skills: [], permissions: "read" },
      emitter: { name: "E", instruction: "x", skills: [], outputs: [{ type: "issue" }] },
    },
    edges: [],
  } as unknown as Workflow;
  const plan = (...visits: [string, "replay" | "rerun" | "write-stage"][]) =>
    ({
      visits: visits.map(([node, action]) => ({ node, iteration: 0, action, applied: 0, unconfirmed: 0 })),
    }) as unknown as ResumePlan;

  it("lists re-run nodes that could write outside safe outputs", () => {
    expect(
      mayRepeatWrites(plan(["writer", "rerun"], ["reader", "rerun"], ["emitter", "rerun"], ["ghost", "rerun"]), wf, {}),
    ).toStrictEqual(["writer"]);
    expect(mayRepeatWrites(plan(["writer", "replay"], ["writer", "write-stage"]), wf, {})).toStrictEqual([]);
  });

  it("a dry run repeats nothing", () => {
    expect(mayRepeatWrites(plan(["writer", "rerun"]), wf, { dryRun: true })).toStrictEqual([]);
    expect(mayRepeatWrites(plan(["writer", "rerun"]), wf, { dryRun: "true" })).toStrictEqual(["writer"]);
    expect(mayRepeatWrites(plan(["writer", "rerun"]), wf, { dryRun: false })).toStrictEqual(["writer"]);
    expect(mayRepeatWrites(plan(["writer", "rerun"]), wf, null)).toStrictEqual(["writer"]);
    expect(mayRepeatWrites(plan(["writer", "rerun"]), wf, undefined)).toStrictEqual(["writer"]);
    expect(mayRepeatWrites(plan(["writer", "rerun"]), wf, "dryRun")).toStrictEqual(["writer"]);
  });
});

// ─── The journal itself ───────────────────────────────────────────

const wf: Workflow = {
  id: "w",
  name: "W",
  description: "",
  entry: "a",
  nodes: { a: { name: "A", instruction: "do a", skills: [] } },
  edges: [],
};

function beginInfo(over: Partial<Parameters<RunJournal["begin"]>[0]> = {}) {
  return {
    workflow: wf,
    input: { n: 1 },
    sources: { "nodes.a.instruction": { content: "do a" } },
    skills: new Map<string, Skill>(),
    config: {},
    writeState: createWriteStageState(),
    ...over,
  };
}

function records(j: RunJournal): JournalRecord[] {
  return readJournal(j.file).records;
}

/** Records appended by a resumed journal: their seq continues the old file, so they are read unverified. */
function rawRecords(file: string): JournalRecord[] {
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as JournalRecord);
}

describe("RunJournal: a new run", () => {
  it("records the start with hashes and a redacted input, and keeps the journal out of commits", () => {
    const cwd = tmp();
    const j = RunJournal.create({
      runId: RUN,
      cwd,
      workflowFile: "wf.yml",
      swenyVersion: "1.2.3",
      env: { GITHUB_TOKEN: "super-secret-value" },
    });
    const info = beginInfo({
      input: { token: "abc", n: 1, note: "has super-secret-value inside" },
      harnessId: "claude-code",
      config: { LINEAR_API_KEY: "linear-credential-1" },
    });
    j.begin(info);
    const [start] = records(j);
    expect(start).toMatchObject({
      type: "run:start",
      run_id: RUN,
      workflow_id: "w",
      workflow_entry: "a",
      workflow_file: "wf.yml",
      workflow_hash: workflowHashOf(wf),
      instruction_hash: instructionHash(info.sources),
      input_hash: canonicalHash(info.input),
      tools_hash: toolsHash(info.skills, "1.2.3", "claude-code"),
      harness: { id: "claude-code" },
      sweny_version: "1.2.3",
      input: { token: REDACTED, n: 1, note: `has ${REDACTED} inside` },
      input_redacted: true,
    });
    expect(readFileSync(join(j.dir, ".gitignore"), "utf-8")).toBe("*\n");
    expect(readFileSync(join(j.dir, "journal.lock"), "utf-8")).toBe(String(process.pid));
    j.end("success");
    expect(existsSync(join(j.dir, "journal.lock"))).toBe(false);
    expect(records(j).map((r) => [r.type, r.seq])).toStrictEqual([
      ["run:start", 1],
      ["run:end", 2],
    ]);
    expect(records(j)[1].status).toBe("success");
  });

  it("omits the optional start fields when they are not set, and starts only once", () => {
    const j = RunJournal.create({ runId: RUN, cwd: tmp() });
    j.begin(beginInfo());
    j.begin(beginInfo());
    const [start, ...rest] = records(j);
    expect(rest).toStrictEqual([]);
    for (const k of ["workflow_file", "harness", "sweny_version"]) expect(k in start).toBe(false);
    expect(start.input_redacted).toBe(false);
  });

  it("prunes older journals beyond keep when a run begins", () => {
    const cwd = tmp();
    seedRuns(cwd, ["20260101-000000-000001", "20260102-000000-000002", "20260103-000000-000003"]);
    RunJournal.create({ runId: RUN, cwd, keep: 2 }).begin(beginInfo());
    expect(listJournalRuns(cwd)).toStrictEqual(["20260103-000000-000003", RUN]);
    const cwd2 = tmp();
    seedRuns(cwd2, ["20260101-000000-000001"]);
    RunJournal.create({ runId: RUN, cwd: cwd2 }).begin(beginInfo());
    expect(listJournalRuns(cwd2)).toHaveLength(2);
  });

  it("journals node records with secrets scrubbed and tool inputs dropped", () => {
    const j = RunJournal.create({ runId: RUN, cwd: tmp(), env: { API_TOKEN: "env-secret-value" } });
    j.begin(beginInfo());
    j.nodeStart("a", 0);
    const result = {
      status: "success",
      data: { note: "uses env-secret-value", apiKey: "k" },
      toolCalls: [
        { tool: "t1", input: { secret: "x" }, status: "ok" },
        { tool: "t2", input: { y: 1 } },
      ],
      usage: { inputTokens: 3 },
      evals: [],
      skippedWrites: [],
      harness: { id: "h" },
      degraded: ["d"],
      outputs: [],
    } as unknown as NodeResult;
    j.checkpoint("a", 0, {
      result,
      intents: [{ type: "issue", body: "env-secret-value", recordedAt: 1 }],
      agentRunFailed: false,
      attempt: 2,
    });
    const ws = createWriteStageState();
    ws.counts.set("a:issue", 1);
    ws.total = 1;
    ws.seen.add("key1");
    j.nodeEnd("a", 0, result, ws);
    j.route("a", null);
    j.end("failed");
    const [start, ns, cp, end, rt, fin] = records(j);
    expect(start.type).toBe("run:start");
    expect(records(j).map((r) => r.type)).toStrictEqual([
      "run:start",
      "node:start",
      "node:checkpoint",
      "node:end",
      "route",
      "run:end",
    ]);
    expect(ns).toMatchObject({ node: "a", iteration: 0 });
    const expectedResult = {
      status: "success",
      data: { note: `uses ${REDACTED}`, apiKey: REDACTED },
      toolCalls: [
        { tool: "t1", input: null, status: "ok" },
        { tool: "t2", input: null },
      ],
      usage: { inputTokens: 3 },
      evals: [],
      skippedWrites: [],
      harness: { id: "h" },
      degraded: ["d"],
      outputs: [],
    };
    expect(cp.result).toStrictEqual(expectedResult);
    expect(cp.intents).toStrictEqual([{ type: "issue", body: REDACTED, recordedAt: 1 }]);
    expect(cp).toMatchObject({ node: "a", iteration: 0, agent_failed: false, attempt: 2 });
    expect(end.result).toStrictEqual(expectedResult);
    expect(end.write_state).toStrictEqual({ counts: [["a:issue", 1]], total: 1, seen: ["key1"] });
    expect(rt).toMatchObject({ from: "a", to: null });
    expect(fin).toMatchObject({ status: "failed" });
  });

  it("a minimal result carries only status, data and tool calls", () => {
    const j = RunJournal.create({ runId: RUN, cwd: tmp() });
    j.begin(beginInfo());
    j.nodeEnd("a", 0, { status: "success", toolCalls: [{ tool: "t", input: 1 }] } as never, createWriteStageState());
    expect(records(j)[1].result).toStrictEqual({
      status: "success",
      data: {},
      toolCalls: [{ tool: "t", input: null }],
    });
    j.nodeEnd("a", 1, { status: "success" } as never, createWriteStageState());
    expect((records(j)[2].result as NodeResult).toolCalls).toStrictEqual([]);
  });

  it("a write failure disables the journal with a warning that names the file", () => {
    const cwd = tmp();
    writeFileSync(join(cwd, ".sweny"), "a file where the directory should be");
    const warn = vi.fn();
    const j = RunJournal.create({ runId: RUN, cwd, logger: { info() {}, warn, error() {}, debug() {} } });
    j.begin(beginInfo());
    expect(j.active).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg.startsWith(`  run journal: could not write ${j.file} (`)).toBe(true);
    expect(msg.endsWith("); this run cannot be resumed past this point")).toBe(true);
    j.nodeStart("a", 0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a fault at an append stops everything after it and releases the lock", () => {
    class Kill extends Error {}
    const j = RunJournal.create({
      runId: RUN,
      cwd: tmp(),
      faults: {
        beforeAppend(r) {
          if (r.type === "node:start") throw new Kill("boom");
        },
      },
    });
    j.begin(beginInfo());
    expect(() => j.nodeStart("a", 0)).toThrow(Kill);
    expect(j.active).toBe(false);
    expect(existsSync(join(j.dir, "journal.lock"))).toBe(false);
    j.nodeEnd("a", 0, { status: "success", data: {}, toolCalls: [] }, createWriteStageState());
    j.end("crashed");
    expect(records(j).map((r) => r.type)).toStrictEqual(["run:start"]);
  });
});

function resumeFrom(recs: JournalRecord[], over: Partial<ResumeJournalOptions> = {}, cwd = tmp()) {
  const plan = buildResumePlan(recs);
  const warn = vi.fn();
  const info = vi.fn();
  const j = RunJournal.openForResume({
    runId: RUN,
    cwd,
    read: { file: join(journalDir(cwd, RUN), JOURNAL_FILE), records: recs, truncatedBytes: 0 },
    plan,
    logger: { info, warn, error() {}, debug() {} },
    ...over,
  });
  return { j, plan, warn, info, cwd };
}

function matchingStart(info = beginInfo(), extra: Record<string, unknown> = {}) {
  return startRec({
    workflow_hash: workflowHashOf(info.workflow),
    instruction_hash: instructionHash(info.sources),
    input_hash: canonicalHash(info.input),
    tools_hash: toolsHash(info.skills, undefined, undefined),
    ...extra,
  });
}

describe("RunJournal: resume", () => {
  it("refuses a changed run, naming every change in order, and writes nothing", () => {
    const { j } = resumeFrom([matchingStart()]);
    const changed = beginInfo({
      workflow: { ...wf, name: "other" },
      sources: { x: { content: "different" } },
      input: { n: 2 },
      skills: new Map([
        ["s", { id: "s", name: "s", description: "", category: "git", config: {}, tools: [] } as Skill],
      ]),
    });
    let err: unknown;
    try {
      j.begin(changed);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(JournalMismatchError);
    expect((err as JournalMismatchError).what).toStrictEqual([
      "the workflow",
      "instructions, rules or context files",
      "the input",
      "the configured skills, agent or sweny version",
    ]);
    expect(j.active).toBe(false);
    expect(existsSync(j.file)).toBe(false);
    expect(existsSync(join(j.dir, "journal.lock"))).toBe(false);
  });

  it("each change is detected on its own", () => {
    const check = (what: string, over: Partial<ReturnType<typeof beginInfo>>) => {
      const { j } = resumeFrom([matchingStart()]);
      try {
        j.begin(beginInfo(over));
      } catch (e) {
        expect((e as JournalMismatchError).what).toStrictEqual([what]);
        return;
      }
      throw new Error(`no mismatch for ${what}`);
    };
    check("the workflow", { workflow: { ...wf, name: "other" } });
    check("instructions, rules or context files", { sources: {} });
    check("the input", { input: { n: 2 } });
    check("the configured skills, agent or sweny version", { harnessId: "codex" });
  });

  it("an unchanged resume appends run:resume and restores the write counters", () => {
    const ws = { counts: [["a:issue", 2]], total: 2, seen: ["k1", "k2"] };
    const recs = [
      matchingStart(),
      nodeStart("a"),
      rec("node:end", { node: "a", iteration: 0, result: ok(), write_state: ws }),
      route("a", "b"),
    ];
    const { j, warn } = resumeFrom(recs);
    const info = beginInfo();
    j.begin(info);
    expect(warn).not.toHaveBeenCalled();
    expect(info.writeState.counts).toStrictEqual(new Map([["a:issue", 2]]));
    expect(info.writeState.total).toBe(2);
    expect(info.writeState.seen).toStrictEqual(new Set(["k1", "k2"]));
    const resumed = rawRecords(j.file)[0];
    expect(resumed).toMatchObject({
      type: "run:resume",
      seq: 5,
      attempt: 2,
      forced: false,
      allow_repeat_writes: false,
    });
    expect("changed" in resumed).toBe(false);
  });

  it("--force resumes a changed run, warning and recording what changed", () => {
    const { j, warn } = resumeFrom([matchingStart(), rec("run:resume")], { force: true, allowRepeatWrites: true });
    j.begin(beginInfo({ workflow: { ...wf, name: "other" }, input: { n: 2 } }));
    expect(warn).toHaveBeenCalledWith("  resume --force: the workflow, the input changed since the run was journaled");
    expect(rawRecords(j.file)[0]).toMatchObject({
      type: "run:resume",
      attempt: 3,
      forced: true,
      allow_repeat_writes: true,
      changed: ["the workflow", "the input"],
    });
  });

  it("--force with nothing changed is not a forced resume", () => {
    const { j, warn } = resumeFrom([matchingStart()], { force: true });
    j.begin(beginInfo());
    expect(warn).not.toHaveBeenCalled();
    expect(rawRecords(j.file)[0]).toMatchObject({ forced: false });
  });

  it("hands back each journaled visit once: a result, a checkpoint, or nothing to replay", () => {
    const result = ok({ v: 1 });
    const recs = [
      matchingStart(),
      nodeStart("a"),
      nodeEnd("a", result),
      route("a", "b"),
      nodeStart("b"),
      rec("node:checkpoint", {
        node: "b",
        iteration: 0,
        result: ok({ cp: 1 }),
        intents: [{ type: "issue", recordedAt: 1 }],
        agent_failed: true,
        attempt: 3,
      }),
    ];
    const { j } = resumeFrom(recs);
    const first = j.replay("a", 0);
    expect(first).toStrictEqual({ kind: "complete", result, next: "b" });
    expect((first as { result: NodeResult }).result).not.toBe(result);
    expect(j.replay("a", 0)).toBeUndefined();
    expect(j.replay("a", 1)).toBeUndefined();
    expect(j.replay("zzz", 0)).toBeUndefined();
    expect(j.replay("b", 0)).toStrictEqual({
      kind: "checkpoint",
      result: ok({ cp: 1 }),
      intents: [{ type: "issue", recordedAt: 1 }],
      agentRunFailed: true,
      attempt: 3,
    });
    expect(RunJournal.create({ runId: RUN, cwd: tmp() }).replay("a", 0)).toBeUndefined();
  });

  it("replay carries next only when the route was journaled, null included", () => {
    const withNull = resumeFrom([matchingStart(), nodeStart("a"), nodeEnd("a", ok()), route("a", null)]).j.replay(
      "a",
      0,
    );
    expect(withNull).toStrictEqual({ kind: "complete", result: ok(), next: null });
    const without = resumeFrom([matchingStart(), nodeStart("a"), nodeEnd("a", ok())]).j.replay("a", 0);
    expect(without).toStrictEqual({ kind: "complete", result: ok() });
    expect("next" in (without as object)).toBe(false);
    const rerun = resumeFrom([matchingStart(), nodeStart("a")]).j.replay("a", 0);
    expect(rerun).toBeUndefined();
  });

  it("does not write a checkpoint the journal already has", () => {
    const { j } = resumeFrom([matchingStart(), nodeStart("a"), checkpoint("a")]);
    j.begin(beginInfo());
    j.checkpoint("a", 0, { result: ok(), intents: [], agentRunFailed: false, attempt: 1 });
    j.checkpoint("a", 1, { result: ok(), intents: [], agentRunFailed: false, attempt: 1 });
    const types = rawRecords(j.file).map((r) => [r.type, r.iteration]);
    expect(types).toStrictEqual([
      ["run:resume", undefined],
      ["node:checkpoint", 1],
    ]);
  });

  it("refuses while another live process holds the journal, but not a stale, own or garbled lock", () => {
    const cwd = tmp();
    const lockAt = (text: string) => {
      mkdirSync(journalDir(cwd, RUN), { recursive: true });
      writeFileSync(join(journalDir(cwd, RUN), "journal.lock"), text);
    };
    const open = () => resumeFrom([matchingStart()], {}, cwd);
    lockAt(String(process.ppid));
    expect(() => open()).toThrow(
      `run journal is in use by process ${process.ppid}; wait for it to finish (or stop it) before resuming`,
    );
    for (const text of [String(process.pid), "999999999", "garbage", "0", "-5", "1.5", ""]) {
      lockAt(text);
      expect(() => open(), text).not.toThrow();
      expect(readFileSync(join(journalDir(cwd, RUN), "journal.lock"), "utf-8")).toBe(String(process.pid));
    }
  });
});

// ─── Idempotent writes ────────────────────────────────────────────

interface Fake {
  skill: Skill;
  writes: { tool: string; args: Record<string, unknown> }[];
  reads: { tool: string; args: Record<string, unknown> }[];
}

function fakeProvider(
  id: string,
  writeTools: Record<string, unknown>,
  readTools: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {},
  readAccess: "read" | "write" = "read",
): Fake {
  const writes: Fake["writes"] = [];
  const reads: Fake["reads"] = [];
  const mk = (name: string, access: "read" | "write", out: unknown, log: Fake["writes"]) => ({
    name,
    description: "",
    input_schema: { type: "object" },
    access,
    handler: async (args: Record<string, unknown>) => {
      log.push({ tool: name, args });
      return typeof out === "function" ? (out as (a: Record<string, unknown>) => unknown)(args) : out;
    },
  });
  return {
    skill: {
      id,
      name: id,
      description: "",
      category: "git",
      config: {},
      tools: [
        ...Object.entries(writeTools).map(([n, o]) => mk(n, "write", o, writes)),
        ...Object.entries(readTools).map(([n, o]) => mk(n, readAccess, o, reads)),
      ],
    },
    writes,
    reads,
  };
}

const NODE = "report";
const keyOf = (tool: string, args: unknown, iteration = 0) => canonicalHash({ node: NODE, iteration, tool, args });

/** A resumed journal whose plan has these keys pending (an intent, no receipt) or already applied. */
function pendingJournal(
  opts: {
    pending?: string[];
    receipts?: Record<string, unknown>;
    checkpointed?: boolean;
    allowRepeatWrites?: boolean;
  } = {},
) {
  const recs = [matchingStart()];
  const r = resumeFrom(recs, { allowRepeatWrites: opts.allowRepeatWrites === true });
  const out = (type: string, key: string, output?: unknown) =>
    rec(type, { node: NODE, iteration: 0, key, tool: "x", ...(output !== undefined ? { output } : {}) }) as never;
  for (const k of opts.pending ?? []) r.plan.intents.set(k, out("output:intent", k));
  for (const [k, o] of Object.entries(opts.receipts ?? {})) r.plan.receipts.set(k, out("output:applied", k, o));
  if (opts.checkpointed) r.plan.checkpoints.set(`${NODE}#0`, checkpoint(NODE) as never);
  return r;
}

async function call(j: RunJournal, fake: Fake, tool: string, args: Record<string, unknown>, iteration = 0) {
  const wrapped = j.wrapWrites(NODE, iteration, new Map([[fake.skill.id, fake.skill]]));
  const t = wrapped.get(fake.skill.id)!.tools.find((x) => x.name === tool)!;
  return t.handler(args, { config: {}, logger: { info() {}, warn() {}, error() {}, debug() {} } });
}

describe("wrapWrites", () => {
  it("leaves read tools alone and wraps the rest, keeping the skill's other fields", () => {
    const fake = fakeProvider("github", { github_create_issue: {} }, { github_search_issues: {} });
    const { j } = pendingJournal();
    const wrapped = j.wrapWrites(NODE, 0, new Map([["github", fake.skill]])).get("github")!;
    expect(wrapped.id).toBe("github");
    expect(wrapped.tools.find((t) => t.name === "github_search_issues")).toBe(fake.skill.tools[1]);
    expect(wrapped.tools.find((t) => t.name === "github_create_issue")).not.toBe(fake.skill.tools[0]);
  });

  it("journals an intent then a slim receipt around a normal write, adding the marker to the body", async () => {
    const fake = fakeProvider("github", {
      github_create_issue: {
        number: 5,
        html_url: "https://x.test/5",
        title: "secret title",
        body: "b",
        labels: [{ name: "x" }],
      },
    });
    const { j } = pendingJournal();
    const args = { repo: "o/r", title: "T", body: "Hello" };
    const out = await call(j, fake, "github_create_issue", args);
    const key = keyOf("github_create_issue", args);
    expect(fake.writes).toStrictEqual([
      { tool: "github_create_issue", args: { ...args, body: `Hello\n\n<!-- sweny-output ${markerToken(key)} -->` } },
    ]);
    expect(out).toMatchObject({ number: 5, title: "secret title" });
    const [intent, applied] = rawRecords(j.file);
    expect(intent).toMatchObject({ type: "output:intent", node: NODE, iteration: 0, key, tool: "github_create_issue" });
    expect(applied).toMatchObject({ type: "output:applied", key, output: { number: 5, html_url: "https://x.test/5" } });
    expect("recovered" in applied).toBe(false);
    expect(applied.output).toStrictEqual({ number: 5, html_url: "https://x.test/5" });
  });

  it("puts the marker alone in an empty body and in the right field per tool", async () => {
    const fake = fakeProvider("p", {
      github_create_issue: {},
      github_add_comment: {},
      linear_create_issue: {},
      linear_add_comment: {},
      github_add_labels: {},
      other_tool: {},
    });
    const { j } = pendingJournal();
    const cases: [string, Record<string, unknown>, string | undefined][] = [
      ["github_create_issue", { title: "t" }, "body"],
      ["github_add_comment", { body: "c" }, "body"],
      ["linear_create_issue", { title: "t", description: "d" }, "description"],
      ["linear_add_comment", { issueId: "i", body: "c" }, "body"],
      ["github_add_labels", { labels: ["x"] }, undefined],
      ["other_tool", { body: "keep" }, undefined],
    ];
    for (const [tool, args, field] of cases) {
      await call(j, fake, tool, args);
      const sent = fake.writes[fake.writes.length - 1].args;
      if (!field) {
        expect(sent, tool).toStrictEqual(args);
        continue;
      }
      const marker = `<!-- sweny-output ${markerToken(keyOf(tool, args))} -->`;
      const prev = typeof args[field] === "string" ? (args[field] as string) : "";
      expect(sent[field], tool).toBe(prev ? `${prev}\n\n${marker}` : marker);
    }
  });

  it("does not re-send a write whose receipt is in the journal", async () => {
    const fake = fakeProvider("github", { github_create_issue: { number: 1 } });
    const args = { repo: "o/r", title: "T" };
    const key = keyOf("github_create_issue", args);
    const { j, info } = pendingJournal({ receipts: { [key]: { number: 9 } } });
    expect(await call(j, fake, "github_create_issue", args)).toStrictEqual({ number: 9 });
    expect(fake.writes).toStrictEqual([]);
    expect(info).toHaveBeenCalledWith(
      "  run journal: github_create_issue already applied before the crash; not re-sent",
      { node: NODE },
    );
    const none = pendingJournal({ receipts: { [key]: undefined } });
    none.plan.receipts.set(key, rec("output:applied", { node: NODE, iteration: 0, key, tool: "x" }) as never);
    expect(await call(none.j, fake, "github_create_issue", args)).toBeNull();
  });

  it("keys a write by node, iteration, tool and arguments", async () => {
    const fake = fakeProvider("github", { github_create_issue: {} });
    const args = { repo: "o/r", title: "T" };
    const other = pendingJournal({ receipts: { [keyOf("github_create_issue", args, 1)]: { number: 1 } } });
    await call(other.j, fake, "github_create_issue", args, 0);
    expect(fake.writes).toHaveLength(1);
    await call(other.j, fake, "github_create_issue", args, 1);
    expect(fake.writes).toHaveLength(1);
    await call(other.j, fake, "github_create_issue", { ...args, title: "U" }, 1);
    expect(fake.writes).toHaveLength(2);
  });

  it("does not look at the provider when nothing is pending and the write stage is not replayed", async () => {
    const fake = fakeProvider("github", { github_create_issue: {} }, { github_search_issues: { items: [] } });
    const { j } = pendingJournal();
    await call(j, fake, "github_create_issue", { repo: "o/r", title: "T" });
    expect(fake.reads).toStrictEqual([]);
    expect(fake.writes).toHaveLength(1);
  });

  it("finds a pending github issue by its marker and does not re-send it", async () => {
    const args = { repo: "o/r", title: "T", body: "B" };
    const key = keyOf("github_create_issue", args);
    const hit = {
      number: 5,
      html_url: "https://x.test/5",
      url: "https://api.x/5",
      title: "t",
      body: `B <!-- sweny-output ${markerToken(key)} -->`,
      id: 77,
      success: true,
      reused: false,
      junk: "z",
      labels: [{ id: 1 }],
      nested: { id: 9, junk: "z", empty: { junk: 1 } },
      bad: { id: { x: 1 } },
    };
    const fake = fakeProvider(
      "github",
      { github_create_issue: {} },
      { github_search_issues: { items: [{ number: 1, body: "unrelated" }, { number: 2, body: 5 }, hit] } },
    );
    const { j, info } = pendingJournal({ pending: [key] });
    const out = await call(j, fake, "github_create_issue", args);
    expect(fake.writes).toStrictEqual([]);
    expect(fake.reads).toStrictEqual([
      { tool: "github_search_issues", args: { query: `${markerToken(key)} in:body is:issue`, repo: "o/r" } },
    ]);
    expect(out).toStrictEqual({
      number: 5,
      html_url: "https://x.test/5",
      url: "https://api.x/5",
      id: 77,
      success: true,
      reused: false,
      nested: { id: 9 },
    });
    expect(info).toHaveBeenCalledWith("  run journal: github_create_issue found on the provider; not re-sent", {
      node: NODE,
    });
    const recovered = rawRecords(j.file).find((r) => r.type === "output:applied")!;
    expect(recovered).toMatchObject({ key, tool: "github_create_issue", recovered: true, output: out });
  });

  it("sends a pending github issue when the search finds no marker", async () => {
    const args = { repo: "o/r", title: "T" };
    const key = keyOf("github_create_issue", args);
    const fake = fakeProvider(
      "github",
      { github_create_issue: { number: 1 } },
      { github_search_issues: { items: [{ number: 1, body: "unrelated" }] } },
    );
    const { j } = pendingJournal({ pending: [key] });
    await call(j, fake, "github_create_issue", args);
    expect(fake.writes).toHaveLength(1);
  });

  it("finds a pending github comment by issue number, matching strings and numbers alike", async () => {
    const args = { repo: "o/r", issue_number: 7, body: "hi" };
    const key = keyOf("github_add_comment", args);
    const fake = fakeProvider(
      "github",
      { github_add_comment: {} },
      { github_search_issues: { items: [{ number: "7" }] } },
    );
    const { j } = pendingJournal({ pending: [key] });
    expect(await call(j, fake, "github_add_comment", args)).toStrictEqual({});
    expect(fake.writes).toStrictEqual([]);
    expect(fake.reads[0].args).toStrictEqual({ query: `${markerToken(key)} in:comments`, repo: "o/r" });
    const miss = fakeProvider(
      "github",
      { github_add_comment: {} },
      { github_search_issues: { items: [{ number: 8 }] } },
    );
    const again = pendingJournal({ pending: [key] });
    await call(again.j, miss, "github_add_comment", args);
    expect(miss.writes).toHaveLength(1);
  });

  it("re-applies idempotent writes without searching", async () => {
    for (const tool of ["github_add_labels", "github_set_issue_state", "linear_set_issue_state", "github_create_pr"]) {
      const args = { repo: "o/r", n: 1 };
      const fake = fakeProvider("p", { [tool]: { ok: 1 } });
      const { j } = pendingJournal({ pending: [keyOf(tool, args)] });
      await call(j, fake, tool, args);
      expect(fake.writes, tool).toStrictEqual([{ tool, args }]);
    }
  });

  it("finds a pending linear issue by its marker", async () => {
    const args = { teamId: "T", title: "x", description: "d" };
    const key = keyOf("linear_create_issue", args);
    const node = { id: "i1", identifier: "OFF-1", url: "https://linear.app/x", title: "x", junk: 1 };
    const fake = fakeProvider(
      "linear",
      { linear_create_issue: {} },
      { linear_search_issues: { searchIssues: { nodes: [node] } } },
    );
    const { j } = pendingJournal({ pending: [key] });
    expect(await call(j, fake, "linear_create_issue", args)).toStrictEqual({
      issueCreate: { issue: { id: "i1", identifier: "OFF-1", url: "https://linear.app/x" } },
    });
    expect(fake.writes).toStrictEqual([]);
    expect(fake.reads).toStrictEqual([{ tool: "linear_search_issues", args: { query: markerToken(key), limit: 5 } }]);
    const empty = fakeProvider(
      "linear",
      { linear_create_issue: {} },
      { linear_search_issues: { searchIssues: { nodes: [] } } },
    );
    await call(pendingJournal({ pending: [key] }).j, empty, "linear_create_issue", args);
    expect(empty.writes).toHaveLength(1);
  });

  it("finds a pending linear comment by its marker in the issue's comments", async () => {
    const args = { issueId: "i1", body: "hi" };
    const key = keyOf("linear_add_comment", args);
    const comments = [
      { id: "c0", body: "other" },
      { id: "c1", body: `hi <!-- sweny-output ${markerToken(key)} -->` },
      { id: "c2", body: 5 },
    ];
    const fake = fakeProvider(
      "linear",
      { linear_add_comment: {} },
      { linear_list_comments: { issue: { comments: { nodes: comments } } } },
    );
    const { j } = pendingJournal({ pending: [key] });
    expect(await call(j, fake, "linear_add_comment", args)).toStrictEqual({ commentCreate: { comment: { id: "c1" } } });
    expect(fake.writes).toStrictEqual([]);
    expect(fake.reads).toStrictEqual([{ tool: "linear_list_comments", args: { issueId: "i1" } }]);
    const none = fakeProvider(
      "linear",
      { linear_add_comment: {} },
      { linear_list_comments: { issue: { comments: { nodes: [{ id: "c0", body: "other" }] } } } },
    );
    await call(pendingJournal({ pending: [key] }).j, none, "linear_add_comment", args);
    expect(none.writes).toHaveLength(1);
  });

  it("an unconfirmable pending write fails with the reason unless repeats are allowed", async () => {
    const cases: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
      [
        "github_create_issue",
        { repo: "o/r", title: "T" },
        { github_search_issues: {} },
        "search returned no result list",
      ],
      [
        "github_create_issue",
        { repo: "o/r", title: "T" },
        { github_search_issues: { items: "x" } },
        "search returned no result list",
      ],
      [
        "github_create_issue",
        { repo: "o/r", title: "T" },
        { github_search_issues: null },
        "search returned no result list",
      ],
      ["github_create_issue", { repo: "o/r", title: "T" }, {}, "no github_search_issues tool configured"],
      [
        "github_add_comment",
        { repo: "o/r", issue_number: 1, body: "b" },
        {
          github_search_issues: () => {
            throw new Error("rate limited");
          },
        },
        "rate limited",
      ],
      [
        "linear_create_issue",
        { teamId: "T", title: "x" },
        { linear_search_issues: {} },
        "search returned no result list",
      ],
      [
        "linear_create_issue",
        { teamId: "T", title: "x" },
        { linear_search_issues: { searchIssues: { nodes: "x" } } },
        "search returned no result list",
      ],
      ["linear_add_comment", { issueId: "i", body: "b" }, { linear_list_comments: {} }, "comment list unavailable"],
      [
        "linear_add_comment",
        { issueId: "i", body: "b" },
        { linear_list_comments: { issue: { comments: {} } } },
        "comment list unavailable",
      ],
      ["slack_post", { text: "x" }, {}, "no lookup for slack_post"],
    ];
    for (const [tool, args, reads, reason] of cases) {
      const key = keyOf(tool, args);
      const mk = () => fakeProvider(tool.startsWith("linear") ? "linear" : "github", { [tool]: { ok: 1 } }, reads);
      const refused = mk();
      await expect(call(pendingJournal({ pending: [key] }).j, refused, tool, args)).rejects.toThrow(
        `cannot confirm whether ${tool} was applied before the crash (${reason}); check the target, then resume with --allow-repeat-writes to send it again`,
      );
      expect(refused.writes, tool).toStrictEqual([]);
      const allowed = mk();
      await call(pendingJournal({ pending: [key], allowRepeatWrites: true }).j, allowed, tool, args);
      expect(allowed.writes, tool).toHaveLength(1);
    }
  });

  it("a search tool that is not read-only is not used", async () => {
    const args = { repo: "o/r", title: "T" };
    const key = keyOf("github_create_issue", args);
    const fake = fakeProvider("github", { github_create_issue: {} }, { github_search_issues: { items: [] } }, "write");
    await expect(call(pendingJournal({ pending: [key] }).j, fake, "github_create_issue", args)).rejects.toThrow(
      "(no github_search_issues tool configured)",
    );
    expect(fake.reads).toStrictEqual([]);
  });

  it("replaying a checkpointed write stage looks at the provider even when no intent was recorded", async () => {
    const args = { repo: "o/r", title: "T" };
    const key = keyOf("github_create_issue", args);
    const hit = { number: 5, body: `x ${markerToken(key)}` };
    const found = fakeProvider("github", { github_create_issue: {} }, { github_search_issues: { items: [hit] } });
    const { j } = pendingJournal({ checkpointed: true });
    expect(await call(j, found, "github_create_issue", args)).toStrictEqual({ number: 5 });
    expect(found.writes).toStrictEqual([]);
    // Not pending, so an unknown outcome is not an error: the write goes ahead.
    const unknown = fakeProvider("github", { github_create_issue: {} }, { github_search_issues: {} });
    await call(pendingJournal({ checkpointed: true }).j, unknown, "github_create_issue", args);
    expect(unknown.writes).toHaveLength(1);
  });

  it("a different iteration is not the checkpointed one", async () => {
    const args = { repo: "o/r", title: "T" };
    const fake = fakeProvider("github", { github_create_issue: {} }, { github_search_issues: { items: [] } });
    await call(pendingJournal({ checkpointed: true }).j, fake, "github_create_issue", args, 1);
    expect(fake.reads).toStrictEqual([]);
  });
});

describe("journal: second-pass edges", () => {
  it("a record whose version is a string is damage, not a newer format", () => {
    const file = journalFile(line(1, "run:start", {}, { v: "2" }) + "\n");
    const r = readJournal(file);
    expect(r.records).toHaveLength(0);
    expect(r.truncatedBytes).toBeGreaterThan(0);
  });

  it("a journal that never began writes nothing on end", () => {
    const j = RunJournal.create({ runId: RUN, cwd: tmp() });
    j.end("success");
    expect(existsSync(j.file)).toBe(false);
  });

  it("a process we may not signal still counts as alive", () => {
    // pid 1 exists on every host; a non-root user gets EPERM from kill(1, 0).
    const cwd = tmp();
    mkdirSync(journalDir(cwd, RUN), { recursive: true });
    writeFileSync(join(journalDir(cwd, RUN), "journal.lock"), "1");
    expect(() => resumeFrom([matchingStart()], {}, cwd)).toThrow(JournalLockedError);
  });

  it("passes non-object arguments through untouched (no marker can be added)", async () => {
    const fake = fakeProvider("github", { github_create_issue: {} });
    const { j } = pendingJournal();
    await call(j, fake, "github_create_issue", "raw" as never);
    await call(j, fake, "github_create_issue", null as never);
    expect(fake.writes.map((w) => w.args)).toStrictEqual(["raw", null]);
  });

  it("looks a pending write up with the search tool by name, not the first read tool", async () => {
    const args = { repo: "o/r", title: "T" };
    const key = keyOf("github_create_issue", args);
    const hit = { number: 5, body: `x ${markerToken(key)}` };
    const fake = fakeProvider(
      "github",
      { github_create_issue: {} },
      { github_get_issue: { items: [] }, github_search_issues: { items: [hit] } },
    );
    await call(pendingJournal({ pending: [key] }).j, fake, "github_create_issue", args);
    expect(fake.writes).toStrictEqual([]);
    expect(fake.reads.map((r) => r.tool)).toStrictEqual(["github_search_issues"]);
  });

  it("keeps ids up to three levels deep in a receipt, and nothing deeper", async () => {
    const fake = fakeProvider("github", {
      github_create_issue: { id: 1, x: { b: { c: { id: 5 } } }, y: { b: { c: { d: { id: 6 } } } } },
    });
    const { j } = pendingJournal();
    await call(j, fake, "github_create_issue", { repo: "o/r", title: "T" });
    const applied = rawRecords(j.file).find((r) => r.type === "output:applied")!;
    expect(applied.output).toStrictEqual({ id: 1, x: { b: { c: { id: 5 } } } });
  });
});
