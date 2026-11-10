/**
 * Edge assertions found by mutation testing of journal.ts: the files that live
 * beside a run's journal in the state dir. The per-workspace secret key, the
 * workspace-containment checks, the head file and how the journal is
 * reconciled with it, run metadata and listing, legacy journals, process start
 * times and the run lock. Each is something a resume trusts, so every refusal
 * is pinned.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  JOURNAL_FILE,
  JOURNAL_SCHEMA_VERSION,
  JournalLocationError,
  JournalLockedError,
  JournalRollbackError,
  JournalWriteError,
  LEGACY_JOURNAL_DIR,
  acquireRunLock,
  assertStateOutsideWorkspace,
  findJournalRun,
  findLegacyJournal,
  journalDir,
  listJournalRuns,
  loadJournalHead,
  processStartTime,
  readJournal,
  workspaceScope,
  workspaceSecretKey,
  type JournalRecord,
} from "../../journal.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "sweny-journal-state-")));
  dirs.push(d);
  return d;
}
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { ...platform, value });
}
const savedStateDir = process.env.SWENY_STATE_DIR;
afterEach(() => {
  vi.restoreAllMocks();
  if (savedStateDir === undefined) delete process.env.SWENY_STATE_DIR;
  else process.env.SWENY_STATE_DIR = savedStateDir;
  Object.defineProperty(process, "platform", platform);
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const RUN = "20260930-120000-0a0b0c";
const KEY = Buffer.alloc(32, 7);
const hmac = (key: Buffer, s: string) => createHmac("sha256", key).update(s).digest("hex");
const errno = (code: string) => Object.assign(new Error(code), { code });

// ─── workspaceSecretKey ───────────────────────────────────────────

describe("workspaceSecretKey", () => {
  const setup = () => {
    const ws = tmp();
    const state = tmp();
    const env = { SWENY_STATE_DIR: state };
    const keyFile = (purpose = "answers") => join(state, "keys", `${workspaceScope(ws)}.${purpose}.key`);
    return { ws, state, env, keyFile };
  };

  it("creates a private 32-byte key once and reads the same key back", () => {
    const { ws, state, env, keyFile } = setup();
    const key = workspaceSecretKey(ws, "answers", env);
    expect(key).toBeInstanceOf(Buffer);
    expect(key!.length).toBe(32);
    const text = fs.readFileSync(keyFile(), "utf8");
    expect(text).toBe(key!.toString("hex") + "\n");
    expect(fs.statSync(keyFile()).mode & 0o777).toBe(0o600);
    expect(fs.statSync(join(state, "keys")).mode & 0o777).toBe(0o700);
    const again = workspaceSecretKey(ws, "answers", env);
    expect(again).toStrictEqual(key);
  });

  it("keeps one key per purpose, with unsafe characters in the purpose replaced", () => {
    const { ws, env, keyFile } = setup();
    const a = workspaceSecretKey(ws, "answers", env);
    const b = workspaceSecretKey(ws, "run/diff key", env);
    expect(fs.existsSync(keyFile("run_diff_key"))).toBe(true);
    expect(b).not.toStrictEqual(a);
    expect(workspaceSecretKey(ws, "run/diff key", env)).toStrictEqual(b);
  });

  it("is null for a state dir inside the workspace, and creates nothing there", () => {
    const { ws } = setup();
    expect(workspaceSecretKey(ws, "answers", { SWENY_STATE_DIR: join(ws, ".state", "deep") })).toBeNull();
    expect(fs.existsSync(join(ws, ".state"))).toBe(false);
    // The keys dir itself being the workspace counts as inside.
    const parent = tmp();
    const named = join(parent, "keys");
    fs.mkdirSync(named);
    expect(workspaceSecretKey(named, "answers", { SWENY_STATE_DIR: parent })).toBeNull();
    expect(fs.readdirSync(named)).toStrictEqual([]);
  });

  it("is null when a link outside the workspace leads into it, even below a dir that does not exist yet", () => {
    const { ws } = setup();
    const outside = tmp();
    fs.symlinkSync(ws, join(outside, "link"));
    expect(workspaceSecretKey(ws, "answers", { SWENY_STATE_DIR: join(outside, "link", "sub") })).toBeNull();
    expect(fs.existsSync(join(ws, "sub"))).toBe(false);
  });

  it("a sibling dir that only shares the workspace's name prefix is outside", () => {
    const parent = tmp();
    const ws = join(parent, "w");
    fs.mkdirSync(ws);
    const key = workspaceSecretKey(ws, "answers", { SWENY_STATE_DIR: join(parent, "w-state") });
    expect(key).toBeInstanceOf(Buffer);
  });

  it("is null when the keys dir is swapped for a link into the workspace while it is created", () => {
    const { ws, state, env } = setup();
    const mkdir = fs.mkdirSync.bind(fs);
    vi.spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike, o?: fs.MakeDirectoryOptions) => {
      if (String(p) === join(state, "keys")) {
        fs.symlinkSync(ws, String(p));
        return undefined;
      }
      return mkdir(p, o);
    }) as typeof fs.mkdirSync);
    expect(workspaceSecretKey(ws, "answers", env)).toBeNull();
    expect(fs.readdirSync(ws)).toStrictEqual([]);
  });

  it("refuses a key file that is not exactly 64 lowercase hex characters", () => {
    for (const bad of [
      "a".repeat(63),
      "a".repeat(65),
      "z" + "a".repeat(64),
      "A".repeat(64),
      "g".repeat(64),
      "a".repeat(32) + " " + "a".repeat(31),
    ]) {
      const { ws, env, keyFile } = setup();
      fs.mkdirSync(join(env.SWENY_STATE_DIR, "keys"), { recursive: true });
      fs.writeFileSync(keyFile(), bad, { mode: 0o600 });
      expect(workspaceSecretKey(ws, "answers", env), bad).toBeNull();
    }
  });

  it("accepts a well-formed key with surrounding whitespace", () => {
    const { ws, env, keyFile } = setup();
    fs.mkdirSync(join(env.SWENY_STATE_DIR, "keys"), { recursive: true });
    fs.writeFileSync(keyFile(), "  " + "ab".repeat(32) + "\n\n", { mode: 0o600 });
    expect(workspaceSecretKey(ws, "answers", env)).toStrictEqual(Buffer.alloc(32, 0xab));
  });

  it("refuses a key file other users can read, except on Windows", () => {
    const { ws, env, keyFile } = setup();
    fs.mkdirSync(join(env.SWENY_STATE_DIR, "keys"), { recursive: true });
    fs.writeFileSync(keyFile(), "cd".repeat(32));
    fs.chmodSync(keyFile(), 0o644);
    setPlatform(platform.value === "win32" ? "linux" : platform.value);
    expect(workspaceSecretKey(ws, "answers", env)).toBeNull();
    setPlatform("win32");
    expect(workspaceSecretKey(ws, "answers", env)).toStrictEqual(Buffer.alloc(32, 0xcd));
  });

  it("refuses a key file that is a link, and never replaces it", () => {
    const { ws, env, keyFile, state } = setup();
    fs.mkdirSync(join(state, "keys"), { recursive: true });
    const real = join(state, "real.key");
    fs.writeFileSync(real, "ef".repeat(32), { mode: 0o600 });
    fs.symlinkSync(real, keyFile());
    expect(workspaceSecretKey(ws, "answers", env)).toBeNull();
    expect(fs.readFileSync(real, "utf8")).toBe("ef".repeat(32));
  });

  it("a read error other than a missing file is null, not a new key", () => {
    const { ws, env, keyFile } = setup();
    const open = fs.openSync.bind(fs);
    vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === keyFile()) throw errno("EIO");
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    expect(workspaceSecretKey(ws, "answers", env)).toBeNull();
    vi.restoreAllMocks();
    expect(fs.existsSync(keyFile())).toBe(false);
  });

  it("when another run creates the key first, uses that run's key", () => {
    const { ws, env, keyFile } = setup();
    const open = fs.openSync.bind(fs);
    let reads = 0;
    vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: number, ...rest: unknown[]) => {
      if (String(p) === keyFile() && (flags & fs.constants.O_CREAT) !== 0) {
        fs.writeFileSync(keyFile(), "12".repeat(32) + "\n", { mode: 0o600 });
      } else if (String(p) === keyFile() && reads++ === 0) {
        throw errno("ENOENT");
      }
      return (open as (...a: unknown[]) => number)(p, flags, ...rest);
    }) as typeof fs.openSync);
    expect(workspaceSecretKey(ws, "answers", env)).toStrictEqual(Buffer.alloc(32, 0x12));
  });

  it("a write error other than an existing file is null, whatever is on disk", () => {
    const { ws, env, keyFile } = setup();
    const open = fs.openSync.bind(fs);
    vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: number, ...rest: unknown[]) => {
      if (String(p) === keyFile() && (flags & fs.constants.O_CREAT) !== 0) {
        fs.writeFileSync(keyFile(), "34".repeat(32) + "\n", { mode: 0o600 });
        throw errno("EACCES");
      }
      return (open as (...a: unknown[]) => number)(p, flags, ...rest);
    }) as typeof fs.openSync);
    expect(workspaceSecretKey(ws, "answers", env)).toBeNull();
  });

  it("is null when the state dir cannot be created", () => {
    const { ws } = setup();
    const file = join(tmp(), "a-file");
    fs.writeFileSync(file, "x");
    expect(workspaceSecretKey(ws, "answers", { SWENY_STATE_DIR: file })).toBeNull();
  });
});

describe("assertStateOutsideWorkspace", () => {
  it("allows a sibling dir that only shares the workspace's name prefix", () => {
    const parent = tmp();
    fs.mkdirSync(join(parent, "w"));
    fs.mkdirSync(join(parent, "w-state"));
    expect(() => assertStateOutsideWorkspace(join(parent, "w-state"), join(parent, "w"))).not.toThrow();
  });

  it("refuses the workspace itself and a dir inside it, with a named error", () => {
    const ws = tmp();
    fs.mkdirSync(join(ws, "s"));
    expect(() => assertStateOutsideWorkspace(ws, ws)).toThrow(JournalLocationError);
    let err: unknown;
    try {
      assertStateOutsideWorkspace(join(ws, "s"), ws);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(JournalLocationError);
    expect((err as Error).name).toBe("JournalLocationError");
    expect((err as Error).message).toBe(
      `the run journal's state dir ${join(ws, "s")} resolves inside the workspace ${ws}, where an agent can edit it. ` +
        `Set SWENY_STATE_DIR to a dir outside the workspace, or pass --no-journal (the run then cannot be resumed)`,
    );
  });
});

describe("error names", () => {
  it("each journal error names itself", () => {
    expect(new JournalRollbackError("x").name).toBe("JournalRollbackError");
    expect(new JournalWriteError("x").name).toBe("JournalWriteError");
  });
});

// ─── Head file ────────────────────────────────────────────────────

describe("loadJournalHead", () => {
  const headMac = (body: Record<string, unknown>) => hmac(KEY, `sweny-journal-head\n${JSON.stringify(body)}`);
  const writeHead = (dir: string, body: Record<string, unknown>, h = headMac(body)) =>
    fs.writeFileSync(join(dir, "head.json"), JSON.stringify({ ...body, h }) + "\n");
  const record = { v: JOURNAL_SCHEMA_VERSION, seq: 1, type: "run:start", at: "t", h: "a".repeat(64) };
  const invalid = (dir: string) => `the run journal's head file ${join(dir, "head.json")} is not valid`;

  it("reads an authenticated head at seq 0 and at a later record", () => {
    const dir = tmp();
    writeHead(dir, { v: 1, run_id: RUN, seq: 0, record: null });
    expect(loadJournalHead(dir, KEY, RUN)).toStrictEqual({ seq: 0, record: null });
    writeHead(dir, { v: 1, run_id: RUN, seq: 1, record });
    expect(loadJournalHead(dir, KEY, RUN)).toStrictEqual({ seq: 1, record });
  });

  it("a missing head file is a rollback, named as missing", () => {
    const dir = tmp();
    expect(() => loadJournalHead(dir, KEY, RUN)).toThrow(
      new JournalRollbackError(
        `cannot check the run journal's length: its head file ${join(dir, "head.json")} is missing`,
      ),
    );
  });

  it("refuses a head that is not a JSON object", () => {
    const dir = tmp();
    for (const text of ["{not json", "null", "[]", "5", '"x"']) {
      fs.writeFileSync(join(dir, "head.json"), text);
      expect(() => loadJournalHead(dir, KEY, RUN), text).toThrow(new JournalRollbackError(invalid(dir)));
    }
  });

  it("refuses a head signed with another key, or not signed", () => {
    const dir = tmp();
    const body = { v: 1, run_id: RUN, seq: 0, record: null };
    writeHead(dir, body, hmac(Buffer.alloc(32, 9), `sweny-journal-head\n${JSON.stringify(body)}`));
    expect(() => loadJournalHead(dir, KEY, RUN)).toThrow(new JournalRollbackError(invalid(dir)));
    fs.writeFileSync(join(dir, "head.json"), JSON.stringify(body));
    expect(() => loadJournalHead(dir, KEY, RUN)).toThrow(new JournalRollbackError(invalid(dir)));
    // A MAC that is not a string is refused before it is decoded.
    fs.writeFileSync(join(dir, "head.json"), JSON.stringify({ ...body, h: [headMac(body)] }));
    expect(() => loadJournalHead(dir, KEY, RUN)).toThrow(new JournalRollbackError(invalid(dir)));
  });

  it("refuses an authenticated head of another version or another run", () => {
    const dir = tmp();
    writeHead(dir, { v: 2, run_id: RUN, seq: 0, record: null });
    expect(() => loadJournalHead(dir, KEY, RUN)).toThrow(new JournalRollbackError(invalid(dir)));
    writeHead(dir, { v: 1, run_id: "20260930-120000-ffffff", seq: 0, record: null });
    expect(() => loadJournalHead(dir, KEY, RUN)).toThrow(new JournalRollbackError(invalid(dir)));
  });

  it("refuses a seq that is not a non-negative integer", () => {
    const dir = tmp();
    for (const seq of ["1", 1.5, -1, null]) {
      writeHead(dir, { v: 1, run_id: RUN, seq, record });
      expect(() => loadJournalHead(dir, KEY, RUN), String(seq)).toThrow(new JournalRollbackError(invalid(dir)));
    }
  });

  it("seq 0 must carry no record; a later seq must carry a record object", () => {
    const dir = tmp();
    for (const [seq, rec] of [
      [0, record],
      [0, {}],
      [1, null],
      [1, []],
      [1, "r"],
      [1, 7],
    ] as const) {
      writeHead(dir, { v: 1, run_id: RUN, seq, record: rec });
      expect(() => loadJournalHead(dir, KEY, RUN), JSON.stringify([seq, rec])).toThrow(
        new JournalRollbackError(invalid(dir)),
      );
    }
  });
});

// ─── Journal vs head ──────────────────────────────────────────────

describe("readJournal: reconciling with the head", () => {
  const chained = (n: number, over: (seq: number) => Record<string, unknown> = () => ({})) => {
    const out: JournalRecord[] = [];
    let prev = "";
    for (let seq = 1; seq <= n; seq++) {
      const body = { v: JOURNAL_SCHEMA_VERSION, seq, type: "note", at: "t", ...over(seq) };
      const h = hmac(KEY, `sweny-journal\n${RUN}\n${seq}\n${prev}\n${JSON.stringify(body)}`);
      prev = h;
      out.push({ ...body, h } as JournalRecord);
    }
    return out;
  };
  const fileOf = (recs: JournalRecord[]) => {
    const file = join(tmp(), JOURNAL_FILE);
    fs.writeFileSync(file, recs.map((r) => JSON.stringify(r) + "\n").join(""));
    return file;
  };
  const read = (file: string, head: { seq: number; record: JournalRecord | null }) =>
    readJournal(file, { key: KEY, runId: RUN, head });

  it("an empty journal at head 0 reads clean", () => {
    expect(read(fileOf([]), { seq: 0, record: null }).records).toStrictEqual([]);
  });

  it("restores the head's record when the journal is exactly one short", () => {
    const recs = chained(2);
    const got = read(fileOf(recs.slice(0, 1)), { seq: 2, record: recs[1] });
    expect(got.restored).toBe(true);
    expect(got.records).toStrictEqual(recs);
  });

  it("refuses a head record that does not chain onto the journal, or is of another format", () => {
    const recs = chained(2);
    const file = fileOf(recs.slice(0, 1));
    const msg = "the run journal's head holds a record that does not follow record 1";
    expect(() => read(file, { seq: 2, record: { ...recs[1], type: "edited" } })).toThrow(new JournalRollbackError(msg));
    expect(() => read(file, { seq: 2, record: { ...recs[1], v: 99 } })).toThrow(new JournalRollbackError(msg));
  });

  it("refuses a journal longer than its head", () => {
    const recs = chained(2);
    expect(() => read(fileOf(recs), { seq: 1, record: recs[0] })).toThrow(
      new JournalRollbackError(
        "the run journal has 2 records, but its head is record 1: it was not written by this run alone",
      ),
    );
  });

  it("refuses a last record that is not the one the head holds", () => {
    const recs = chained(1);
    const other = chained(1, () => ({ type: "other" }));
    const msg = "run journal record 1 is not the record the run wrote there";
    expect(() => read(fileOf(recs), { seq: 1, record: other[0] })).toThrow(new JournalRollbackError(msg));
    expect(() => read(fileOf(recs), { seq: 1, record: null })).toThrow(new JournalRollbackError(msg));
    expect(read(fileOf(recs), { seq: 1, record: recs[0] }).records).toStrictEqual(recs);
  });
});

describe("readJournal: what counts as a record", () => {
  const sign = (seq: number, prev: string, body: Record<string, unknown>) =>
    hmac(KEY, `sweny-journal\n${RUN}\n${seq}\n${prev}\n${JSON.stringify(body)}`);
  const first = { v: JOURNAL_SCHEMA_VERSION, seq: 1, type: "run:start", at: "t" };
  const firstH = sign(1, "", first);
  const file = (second: Record<string, unknown>) => {
    const f = join(tmp(), JOURNAL_FILE);
    fs.writeFileSync(f, JSON.stringify({ ...first, h: firstH }) + "\n" + JSON.stringify(second) + "\n");
    return f;
  };
  const readHand = (f: string) => readJournal(f, { key: KEY, runId: RUN, head: false });

  it("an authenticated record with a non-string type, or of an older version, is forged", () => {
    for (const body of [
      { v: JOURNAL_SCHEMA_VERSION, seq: 2, type: 5, at: "t" },
      { v: JOURNAL_SCHEMA_VERSION - 1, seq: 2, type: "note", at: "t" },
    ]) {
      const got = readHand(file({ ...body, h: sign(2, firstH, body) }));
      expect(got.records, JSON.stringify(body)).toHaveLength(1);
      expect(got.forgedAtLine).toBe(2);
    }
  });

  it("a record whose own seq disagrees with its place is forged, even when signed for its place", () => {
    const body = { v: JOURNAL_SCHEMA_VERSION, seq: 5, type: "note", at: "t" };
    const got = readHand(file({ ...body, h: sign(2, firstH, body) }));
    expect(got.forgedAtLine).toBe(2);
  });

  it("a string version is damage, not a newer format, at any line", () => {
    const body = { v: String(JOURNAL_SCHEMA_VERSION + 1), seq: 2, type: "note", at: "t" };
    const got = readHand(file({ ...body, h: sign(2, firstH, body) }));
    expect(got.forgedAtLine).toBe(2);
  });

  it("a malformed MAC is forged, not a crash", () => {
    const body = { v: JOURNAL_SCHEMA_VERSION, seq: 2, type: "note", at: "t" };
    const h = sign(2, firstH, body);
    for (const bad of ["z" + h, h + "0", h.slice(1)]) {
      expect(readHand(file({ ...body, h: bad })).forgedAtLine, bad).toBe(2);
    }
  });
});

// ─── Run metadata and listing ─────────────────────────────────────

describe("run metadata", () => {
  const metaMac = (key: Buffer, body: Record<string, unknown>) =>
    hmac(key, `sweny-journal-meta\n${JSON.stringify(body)}`);
  function seed(cwd: string, id: string, over: Record<string, unknown> = {}, h?: string): void {
    const dir = journalDir(cwd, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, "key"), KEY.toString("hex") + "\n", { mode: 0o600 });
    const body = { v: 1, run_id: id, scope: workspaceScope(cwd), created_at: "2026-01-01T00:00:00.000Z", ...over };
    fs.writeFileSync(join(dir, "meta.json"), JSON.stringify({ ...body, h: h ?? metaMac(KEY, body) }));
  }
  const A = "20260101-000000-00000a";
  const B = "20260101-000000-00000b";

  it("lists a run only when its metadata authenticates and names this run, workspace and a real time", () => {
    const cwd = tmp();
    process.env.SWENY_STATE_DIR = tmp();
    seed(cwd, A);
    seed(cwd, "20260101-000000-000001", {}, "0".repeat(64));
    seed(cwd, "20260101-000000-000002", { v: 2 });
    seed(cwd, "20260101-000000-000003", { run_id: A });
    seed(cwd, "20260101-000000-000004", { scope: "other" });
    seed(cwd, "20260101-000000-000005", { created_at: 5 });
    seed(cwd, "20260101-000000-000006", { created_at: "not a time" });
    expect(listJournalRuns(cwd)).toStrictEqual([A]);
  });

  it("orders by creation time, then by run id", () => {
    const cwd = tmp();
    process.env.SWENY_STATE_DIR = tmp();
    seed(cwd, A, { created_at: "2026-01-02T00:00:00.000Z" });
    seed(cwd, B, { created_at: "2026-01-01T00:00:00.000Z" });
    seed(cwd, "20260101-000000-00000d", { created_at: "2026-01-03T00:00:00.000Z" });
    seed(cwd, "20260101-000000-00000c", { created_at: "2026-01-03T00:00:00.000Z" });
    expect(listJournalRuns(cwd)).toStrictEqual([B, A, "20260101-000000-00000c", "20260101-000000-00000d"]);
    expect(findJournalRun("20260101-000000-00000", cwd)).toBeUndefined();
    expect(findJournalRun(B, cwd)).toBe(B);
  });

  it("a directory that is not a run id is never listed, even with authentic metadata", () => {
    const cwd = tmp();
    process.env.SWENY_STATE_DIR = tmp();
    seed(cwd, "custom-run");
    expect(listJournalRuns(cwd)).toStrictEqual([]);
  });
});

describe("findLegacyJournal", () => {
  const legacy = (cwd: string, name: string, withFile = true) => {
    const d = join(cwd, LEGACY_JOURNAL_DIR, name);
    fs.mkdirSync(d, { recursive: true });
    if (withFile) fs.writeFileSync(join(d, JOURNAL_FILE), "{}\n");
  };
  const A = "20260101-000000-aaaaaa";

  it("finds a legacy journal by exact id or unique prefix", () => {
    const cwd = tmp();
    legacy(cwd, A);
    legacy(cwd, "20260202-000000-bbbbbb");
    const at = join(cwd, LEGACY_JOURNAL_DIR, A, JOURNAL_FILE);
    expect(findLegacyJournal(A, cwd)).toBe(at);
    expect(findLegacyJournal("20260101", cwd)).toBe(at);
    expect(findLegacyJournal("2026", cwd)).toBeUndefined();
    expect(findLegacyJournal("2027", cwd)).toBeUndefined();
  });

  it("ignores dirs that are not run ids or hold no journal", () => {
    const cwd = tmp();
    legacy(cwd, A);
    legacy(cwd, A + "x");
    legacy(cwd, "x" + A);
    legacy(cwd, "20260101-000000-aaaaab", false);
    expect(findLegacyJournal(A, cwd)).toBe(join(cwd, LEGACY_JOURNAL_DIR, A, JOURNAL_FILE));
    expect(findLegacyJournal("x" + A, cwd)).toBeUndefined();
    expect(findLegacyJournal("20260101-000000-aaaaab", cwd)).toBeUndefined();
    expect(findLegacyJournal(A, tmp())).toBeUndefined();
  });
});

// ─── Process start time ───────────────────────────────────────────

describe("processStartTime", () => {
  const procStat = (rest: string) => `4242 (we ) ird) S ${rest}`;
  const fields = (start: string) => Array.from({ length: 18 }, (_, i) => String(i + 1)).join(" ") + ` ${start} 0 0 0`;
  function fakeProc(stat: string | Error, procStatText: string): void {
    setPlatform("linux");
    const real = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, o?: unknown) => {
      if (p === "/proc/4242/stat") {
        if (stat instanceof Error) throw stat;
        return stat;
      }
      if (p === "/proc/stat") return procStatText;
      return (real as (...a: unknown[]) => unknown)(p, o);
    }) as typeof fs.readFileSync);
  }

  it("is boot time plus the start ticks (100 per second), after the last ')' of the command name", () => {
    fakeProc(procStat(fields("12345")), "cpu 1 2 3\nbtime 1700000000\nprocesses 5\n");
    expect(processStartTime(4242)).toBe(1700000000 * 1000 + 12345 * 10);
  });

  it("reads btime only from its own whole line", () => {
    fakeProc(procStat(fields("7")), "notbtime 999\nbtime 17x\nbtime 1700000000\n");
    expect(processStartTime(4242)).toBe(1700000000 * 1000 + 70);
  });

  it("is undefined when the start ticks or the boot time is not a number", () => {
    fakeProc(procStat(fields("x")), "btime 1700000000\n");
    expect(processStartTime(4242)).toBeUndefined();
    vi.restoreAllMocks();
    fakeProc(procStat(fields("12")), "cpu 1\n");
    expect(processStartTime(4242)).toBeUndefined();
  });

  it("is undefined when /proc cannot be read", () => {
    fakeProc(errno("ENOENT"), "btime 1\n");
    expect(processStartTime(4242)).toBeUndefined();
  });

  it("is undefined off Linux", () => {
    setPlatform("darwin");
    expect(processStartTime(process.pid)).toBeUndefined();
  });

  it.runIf(platform.value === "linux")("on Linux, this process's start time matches its uptime", () => {
    const started = processStartTime(process.pid);
    expect(started).toBeTypeOf("number");
    expect(Math.abs(started! - (Date.now() - process.uptime() * 1000))).toBeLessThan(20_000);
  });
});

// ─── Run lock ─────────────────────────────────────────────────────

describe("acquireRunLock", () => {
  const lockFile = (dir: string) => join(dir, "lock");
  const lockText = (dir: string) => fs.readFileSync(lockFile(dir), "utf8");
  const selfStarted = () => {
    const dir = tmp();
    const lock = acquireRunLock(dir);
    const started = JSON.parse(lockText(dir)).started as number;
    lock.release();
    return started;
  };

  it("takes over a lock naming a pid that cannot be a live holder", () => {
    for (const pid of [0, -1, 1.5]) {
      const dir = tmp();
      fs.writeFileSync(lockFile(dir), JSON.stringify({ pid, started: 1, nonce: "n" }));
      const lock = acquireRunLock(dir);
      expect(JSON.parse(lockText(dir)).pid, String(pid)).toBe(process.pid);
      lock.release();
    }
  });

  it("this process's own lock is live only within 5s of its start time", () => {
    const started = selfStarted();
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.pid, started: started + 5000, nonce: "n" }));
    expect(() => acquireRunLock(dir)).toThrow(JournalLockedError);
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.pid, started: started + 5001, nonce: "n" }));
    const lock = acquireRunLock(dir);
    expect(JSON.parse(lockText(dir)).started).toBe(started);
    lock.release();
  });

  it.runIf(platform.value === "linux")("another live process holds the lock only within 5s of its start time", () => {
    const started = processStartTime(process.ppid)!;
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.ppid, started: started - 5000, nonce: "n" }));
    expect(() => acquireRunLock(dir)).toThrow(new JournalLockedError(process.ppid));
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.ppid, started: started - 5001, nonce: "n" }));
    acquireRunLock(dir).release();
  });

  it("without a start time to compare, a live pid holds the lock", () => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.ppid, started: 1, nonce: "n" }));
    setPlatform("darwin");
    expect(() => acquireRunLock(dir)).toThrow(new JournalLockedError(process.ppid));
  });

  it("release removes only this lock, never one that replaced it", () => {
    const dir = tmp();
    const lock = acquireRunLock(dir);
    expect(lock.file).toBe(lockFile(dir));
    fs.writeFileSync(lockFile(dir), "someone else");
    lock.release();
    expect(lockText(dir)).toBe("someone else");
    const dir2 = tmp();
    acquireRunLock(dir2).release();
    expect(fs.existsSync(lockFile(dir2))).toBe(false);
  });

  it("an error other than an existing lock is thrown as is", () => {
    const missing = join(tmp(), "no", "such", "dir");
    let err: unknown;
    try {
      acquireRunLock(missing);
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeInstanceOf(JournalLockedError);
    expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
  });

  it("gives up after four takeover attempts, naming the last holder seen", () => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 999999991, started: 1, nonce: "0" }));
    let calls = 0;
    const hooks = {
      afterStaleRead() {
        calls++;
        if (calls > 6) throw new Error("looped past the attempt limit");
        // Another process replaces the stale lock before this one can take it over.
        fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 999999990 + calls, started: 1, nonce: String(calls) }));
      },
    };
    let err: unknown;
    try {
      acquireRunLock(dir, hooks);
    } catch (e) {
      err = e;
    }
    expect(calls).toBe(4);
    expect(err).toBeInstanceOf(JournalLockedError);
    expect((err as JournalLockedError).pid).toBe(999999993);
  });

  it("a takeover lock left by a process that died mid-takeover is cleared once older than 10s", () => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 999999991, started: 1, nonce: "n" }));
    fs.writeFileSync(lockFile(dir) + ".takeover", "x");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFile(dir) + ".takeover", old, old);
    const lock = acquireRunLock(dir);
    expect(JSON.parse(lockText(dir)).pid).toBe(process.pid);
    expect(fs.existsSync(lockFile(dir) + ".takeover")).toBe(false);
    lock.release();
  });

  it("a fresh takeover lock means another process is taking over: this one gives up", () => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 999999991, started: 1, nonce: "n" }));
    fs.writeFileSync(lockFile(dir) + ".takeover", "x");
    expect(() => acquireRunLock(dir)).toThrow(new JournalLockedError(999999991));
    expect(fs.existsSync(lockFile(dir) + ".takeover")).toBe(true);
  });
});
