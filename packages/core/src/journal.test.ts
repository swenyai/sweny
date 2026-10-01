import { describe, it, expect, afterEach } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  JOURNAL_FILE,
  JOURNAL_SCHEMA_VERSION,
  JournalLockedError,
  JournalRollbackError,
  JournalVersionError,
  LEGACY_JOURNAL_DIR,
  REDACTED,
  RunJournal,
  acquireRunLock,
  buildResumePlan,
  workflowHashOf,
  collectSecretValues,
  journalDir,
  listJournalRuns,
  loadJournalHead,
  loadRunKey,
  processStartTime,
  pruneJournals,
  readJournal,
  redact,
  runKeyFile,
  runStateRoot,
} from "./journal.js";
import { createWriteStageState } from "./safe-outputs.js";
import type { JournalRecord } from "./journal.js";
import { toolsHash } from "./journal.js";
import type { NodeResult, Skill, Tool, Workflow } from "./types.js";

// Run keys go to a scratch state dir, never the real ~/.local/state.
process.env.SWENY_STATE_DIR = mkdtempSync(join(tmpdir(), "sweny-state-"));

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sweny-journal-unit-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const RUN_ID = "20260930-120000-0a0b0c";
const wf: Workflow = {
  id: "w",
  name: "W",
  description: "",
  entry: "a",
  nodes: { a: { name: "A", instruction: "do a", skills: [] }, b: { name: "B", instruction: "do b", skills: [] } },
  edges: [{ from: "a", to: "b" }],
};
const ok = (data: Record<string, unknown>): NodeResult => ({ status: "success", data, toolCalls: [] });

function begin(j: RunJournal, input: unknown = {}, config: Record<string, string> = {}) {
  j.begin({
    workflow: wf,
    input,
    sources: { "nodes.a.instruction": { content: "do a" } },
    skills: new Map(),
    config,
    writeState: createWriteStageState(),
  });
}

describe("journal records", () => {
  it("live in the state dir (never the workspace), private, versioned, sequenced, MAC-chained, one per line", () => {
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "w.yml" });
    begin(j);
    j.nodeStart("a", 1);
    j.nodeEnd("a", 1, ok({ x: 1 }), createWriteStageState());
    j.route("a", "b");
    j.end("crashed");

    const dir = journalDir(cwd, RUN_ID);
    expect(dir.startsWith(runStateRoot())).toBe(true);
    expect(dir.startsWith(cwd)).toBe(false);
    // Nothing journal-related in the workspace.
    expect(existsSync(join(cwd, LEGACY_JOURNAL_DIR))).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      for (const f of [JOURNAL_FILE, "key", "head.json", "meta.json"]) {
        expect(statSync(join(dir, f)).mode & 0o777, f).toBe(0o600);
      }
    }

    const text = readFileSync(join(dir, JOURNAL_FILE), "utf-8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["run:start", "node:start", "node:end", "route", "run:end"]);
    const key = loadRunKey(runKeyFile(cwd, RUN_ID));
    let prev = "";
    lines.forEach((l, i) => {
      expect(l.v).toBe(JOURNAL_SCHEMA_VERSION);
      expect(l.seq).toBe(i + 1);
      const { h, ...body } = l;
      const input = `sweny-journal\n${RUN_ID}\n${i + 1}\n${prev}\n${JSON.stringify(body)}`;
      expect(h).toBe(createHmac("sha256", key).update(input).digest("hex"));
      prev = h;
    });
    expect(lines[0]).toMatchObject({
      run_id: RUN_ID,
      workflow_id: "w",
      workflow_file: "w.yml",
      workflow_hash: workflowHashOf(wf),
    });
    // The head holds the last record; the lock is released at the end.
    expect(loadJournalHead(dir, key, RUN_ID)).toEqual({ seq: 5, record: lines[4] });
    expect(existsSync(join(dir, "lock"))).toBe(false);
  });

  it("an edited record fails its checksum; with records after it, the damage is reported as mid-file", () => {
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd });
    begin(j);
    j.nodeStart("a", 1);
    j.end("crashed");
    const file = join(journalDir(cwd, RUN_ID), JOURNAL_FILE);
    const original = readFileSync(file, "utf-8");
    writeFileSync(file, original.replace('"node":"a"', '"node":"z"'));
    const read = readJournal(file, { repair: true });
    expect(read.records.map((r) => r.type)).toEqual(["run:start"]);
    expect(read.corruptAtLine).toBe(2);
    // Mid-file damage is never "repaired" by cutting valid records.
    expect(readFileSync(file, "utf-8")).toBe(original.replace('"node":"a"', '"node":"z"'));
  });

  it("a newer format version is refused with an upgrade hint", () => {
    const cwd = tmp();
    const dir = journalDir(cwd, RUN_ID);
    mkdirSync(dir, { recursive: true });
    const v = JOURNAL_SCHEMA_VERSION + 1;
    writeFileSync(join(dir, JOURNAL_FILE), JSON.stringify({ v, seq: 1, type: "run:start", h: "x" }) + "\n");
    expect(() => readJournal(join(dir, JOURNAL_FILE))).toThrow(JournalVersionError);
  });

  it("a v1 journal (public checksums) is refused, never repaired away", () => {
    const cwd = tmp();
    const dir = journalDir(cwd, RUN_ID);
    mkdirSync(dir, { recursive: true });
    const text = JSON.stringify({ v: 1, seq: 1, type: "run:start", h: "x" }) + "\n";
    writeFileSync(join(dir, JOURNAL_FILE), text);
    expect(() => readJournal(join(dir, JOURNAL_FILE), { repair: true })).toThrow(/predates chained records/);
    expect(readFileSync(join(dir, JOURNAL_FILE), "utf-8")).toBe(text);
  });
});

describe("workflow hash", () => {
  it("binds the effective spec_version (#469)", () => {
    expect(workflowHashOf({ ...wf, spec_version: "1" })).toBe(workflowHashOf(wf));
    expect(workflowHashOf({ ...wf, spec_version: "2" })).not.toBe(workflowHashOf(wf));
  });
});

describe("redaction", () => {
  it("never writes secret env values, credential config, token shapes or secret-named keys", () => {
    const cwd = tmp();
    const env = { GITHUB_TOKEN: "ghs_supersecretvalue123456", HOME: "/home/someone-long-path" };
    const j = RunJournal.create({ runId: RUN_ID, cwd, env });
    begin(j, { repo: "acme/api", api_key: "k-123456789" }, { LINEAR_API_KEY: "lin-config-secret-999" });
    j.nodeEnd(
      "a",
      1,
      ok({
        note: "used ghs_supersecretvalue123456 and lin-config-secret-999",
        leaked: "sk-abcdefghijklmnopqrstuvwxyz",
        authorization: "Bearer abc",
        inputTokens: 1200,
      }),
      createWriteStageState(),
    );
    j.end("crashed");
    const text = readFileSync(join(journalDir(cwd, RUN_ID), JOURNAL_FILE), "utf-8");
    for (const secret of [
      "ghs_supersecretvalue123456",
      "lin-config-secret-999",
      "k-123456789",
      "sk-abcdefghij",
      "Bearer abc",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("/home/someone-long-path");
    const start = JSON.parse(text.split("\n")[0]);
    expect(start.input).toEqual({ repo: "acme/api", api_key: REDACTED });
    expect(start.input_redacted).toBe(true);
    const end = JSON.parse(text.split("\n")[1]);
    expect(end.result.data.inputTokens).toBe(1200);
  });

  it("leaves ordinary values alone", () => {
    expect(redact({ author: "nate", tokens: 5, title: "Fix token refresh" }, [])).toEqual({
      value: { author: "nate", tokens: 5, title: "Fix token refresh" },
      redacted: false,
    });
    expect(collectSecretValues({ GITHUB_TOKEN: "short", PATH: "/usr/bin:/bin:/usr/local/bin" })).toEqual([]);
  });
});

describe("resume plan", () => {
  it("replays finished visits, re-runs the last failed one, and continues where a route pointed", () => {
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd });
    begin(j);
    j.nodeStart("a", 1);
    j.nodeEnd("a", 1, ok({}), createWriteStageState());
    j.route("a", "b");
    j.nodeStart("b", 1);
    j.nodeEnd("b", 1, { status: "failed", data: { error: "x" }, toolCalls: [] }, createWriteStageState());
    j.end("failed");
    const plan = buildResumePlan(readJournal(join(journalDir(cwd, RUN_ID), JOURNAL_FILE)).records);
    expect(plan.visits.map((v) => [v.node, v.action])).toEqual([
      ["a", "replay"],
      ["b", "rerun"],
    ]);
    expect(plan.visits[0].next).toBe("b");
    expect(plan.lastStatus).toBe("failed");
    expect(plan.freshNode).toBeUndefined();
  });

  it("a run killed before its first node starts resumes at the entry", () => {
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd });
    begin(j);
    j.end("crashed");
    const plan = buildResumePlan(readJournal(join(journalDir(cwd, RUN_ID), JOURNAL_FILE)).records);
    expect(plan.visits).toEqual([]);
    expect(plan.freshNode).toBe("a");
    expect(plan.finished).toBe(false);
  });
});

describe("retention and locking", () => {
  const runs = (cwd: string, ids: string[]) => {
    for (const id of ids) {
      const j = RunJournal.create({ runId: id, cwd });
      begin(j);
      j.end("crashed");
    }
  };

  it("keeps the newest journals (by authenticated creation time) and never the one being written", () => {
    const cwd = tmp();
    const ids = ["20260101-000000-000001", "20260102-000000-000002", "20260103-000000-000003"];
    runs(cwd, ids);
    expect(listJournalRuns(cwd)).toEqual(ids);
    expect(pruneJournals(cwd, 2, ids[0])).toBe(1);
    expect(listJournalRuns(cwd)).toEqual([ids[0], ids[2]]);
    expect(existsSync(journalDir(cwd, ids[1]))).toBe(false);
  });

  it("fake run dirs in the workspace never list, resume or prune anything", () => {
    const cwd = tmp();
    const ids = ["20260101-000000-000001", "20260102-000000-000002"];
    runs(cwd, ids);
    // What an agent can write: future-dated "runs" in the workspace, with journals and keys.
    for (const fake of ["29991231-235959-ffffff", "29991231-235959-fffffe", "29991231-235959-fffffd"]) {
      const d = join(cwd, LEGACY_JOURNAL_DIR, fake);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, JOURNAL_FILE), '{"v":3}\n');
      writeFileSync(join(d, "meta.json"), JSON.stringify({ created_at: "2999-12-31T23:59:59.000Z" }));
    }
    expect(listJournalRuns(cwd)).toEqual(ids);
    expect(pruneJournals(cwd, 2)).toBe(0);
    for (const id of ids) expect(existsSync(journalDir(cwd, id)), id).toBe(true);
  });

  it("a state dir entry whose metadata does not authenticate is neither listed nor pruned", () => {
    const cwd = tmp();
    runs(cwd, ["20260101-000000-000001"]);
    const junk = journalDir(cwd, "20200101-000000-000000");
    mkdirSync(junk, { recursive: true });
    writeFileSync(join(junk, "meta.json"), JSON.stringify({ created_at: "2000-01-01T00:00:00.000Z" }));
    expect(listJournalRuns(cwd)).toEqual(["20260101-000000-000001"]);
    expect(pruneJournals(cwd, 0)).toBe(1);
    expect(existsSync(junk)).toBe(true);
  });
});

describe("run lock", () => {
  const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;
  const lockDir = () => {
    const d = journalDir(tmp(), RUN_ID);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const holder = (pid: number, started: number) => JSON.stringify({ pid, started, nonce: "n" });

  it("is exclusive, even within one process", () => {
    const dir = lockDir();
    const lock = acquireRunLock(dir);
    expect(() => acquireRunLock(dir)).toThrow(JournalLockedError);
    lock.release();
    acquireRunLock(dir).release();
    expect(existsSync(join(dir, "lock"))).toBe(false);
  });

  it("refuses while another live process holds it, and takes it over once that process is gone", async () => {
    const dir = lockDir();
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 200));
      const started = processStartTime(child.pid!) ?? Date.now();
      writeFileSync(join(dir, "lock"), holder(child.pid!, started));
      expect(() => acquireRunLock(dir)).toThrow(new RegExp(`in use by process ${child.pid}`));
    } finally {
      child.kill("SIGKILL");
      await new Promise((r) => child.once("exit", r));
    }
    const lock = acquireRunLock(dir);
    expect(JSON.parse(readFileSync(join(dir, "lock"), "utf-8")).pid).toBe(process.pid);
    lock.release();
  });

  it("two processes racing for one stale lock: exactly one wins", () => {
    const dir = lockDir();
    writeFileSync(join(dir, "lock"), holder(deadPid(), 0));
    let second: ReturnType<typeof acquireRunLock> | undefined;
    // A reads the stale lock; before it takes over, B does the whole takeover and wins.
    expect(() =>
      acquireRunLock(dir, {
        afterStaleRead() {
          second ??= acquireRunLock(dir);
        },
      }),
    ).toThrow(JournalLockedError);
    expect(second).toBeDefined();
    // The lock on disk is still B's: releasing it removes it.
    second!.release();
    expect(existsSync(join(dir, "lock"))).toBe(false);
  });

  it("an empty or garbled lock (a process that died while taking it) is stale", () => {
    const dir = lockDir();
    writeFileSync(join(dir, "lock"), "");
    acquireRunLock(dir).release();
    writeFileSync(join(dir, "lock"), "{not json");
    acquireRunLock(dir).release();
  });
});

describe("record integrity", () => {
  const AT = "2026-09-30T00:00:00.000Z";
  const failed: NodeResult = { status: "failed", data: { error: "x" }, toolCalls: [] };
  const ws = { counts: [], total: 0, seen: [] };

  it("a record forged with the public sha256 checksum is refused, not replayed", () => {
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd });
    begin(j);
    j.nodeStart("a", 1);
    j.nodeEnd("a", 1, failed, createWriteStageState());
    j.end("failed");
    const file = join(journalDir(cwd, RUN_ID), JOURNAL_FILE);
    const n = readFileSync(file, "utf-8").trim().split("\n").length;
    const forge = (body: Record<string, unknown>) =>
      JSON.stringify({ ...body, h: createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16) }) +
      "\n";
    const v = JOURNAL_SCHEMA_VERSION;
    appendFileSync(
      file,
      forge({ v, seq: n + 1, type: "node:end", at: AT, node: "a", iteration: 1, result: ok({}), write_state: ws }),
    );
    appendFileSync(file, forge({ v, seq: n + 2, type: "route", at: AT, from: "a", to: "b" }));

    const read = readJournal(file, { repair: true });
    expect(read.records).toHaveLength(n);
    expect(read.corruptAtLine).toBe(n + 1);
  });

  it("control flow the executor never writes is refused", () => {
    let seq = 0;
    const rec = (type: string, f: Record<string, unknown> = {}) =>
      ({ v: JOURNAL_SCHEMA_VERSION, seq: ++seq, type, at: AT, ...f }) as JournalRecord;
    const start = () => {
      seq = 0;
      return rec("run:start", {
        run_id: RUN_ID,
        workflow_id: "w",
        workflow_entry: "a",
        workflow_hash: "x",
        instruction_hash: "x",
        input_hash: "x",
        tools_hash: "x",
        input: {},
        input_redacted: false,
      });
    };
    const startA = () => rec("node:start", { node: "a", iteration: 1 });
    const endA = (r: NodeResult = ok({})) => rec("node:end", { node: "a", iteration: 1, result: r, write_state: ws });
    const cases: Array<[string, () => JournalRecord[]]> = [
      [
        "records after run:end",
        () => [
          start(),
          startA(),
          endA(failed),
          rec("run:end", { status: "failed" }),
          endA(),
          rec("route", { from: "a", to: "b" }),
        ],
      ],
      ["node:end for a visit that never started", () => [start(), endA()]],
      ["a node no route pointed to", () => [start(), rec("node:start", { node: "b", iteration: 1 })]],
      [
        "a route from a node that did not just end",
        () => [start(), startA(), endA(), rec("route", { from: "b", to: "a" })],
      ],
      [
        "two routes for one visit",
        () => [start(), startA(), endA(), rec("route", { from: "a", to: "b" }), rec("route", { from: "a", to: "c" })],
      ],
      ["a second run:start", () => [start(), rec("run:start", { run_id: RUN_ID, workflow_entry: "a" })]],
      ["an unknown record type", () => [start(), rec("node:teleport", { node: "b" })]],
    ];
    for (const [what, records] of cases) {
      expect(() => buildResumePlan(records()), what).toThrow(/run journal record \d+/);
    }
  });

  it("journal files are private to the user (0600)", () => {
    if (process.platform === "win32") return;
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd });
    begin(j);
    j.end("crashed");
    expect(statSync(join(journalDir(cwd, RUN_ID), JOURNAL_FILE)).mode & 0o777).toBe(0o600);
  });
});

describe("state-file tampering", () => {
  function crashed(cwd: string): string {
    const j = RunJournal.create({ runId: RUN_ID, cwd });
    begin(j);
    j.nodeStart("a", 1);
    j.nodeEnd("a", 1, ok({}), createWriteStageState());
    j.route("a", "b");
    j.end("crashed");
    return join(journalDir(cwd, RUN_ID), JOURNAL_FILE);
  }

  it("a deleted last line is restored from the head, never lost", () => {
    const cwd = tmp();
    const file = crashed(cwd);
    const text = readFileSync(file, "utf-8");
    const lines = text.split("\n").filter(Boolean);
    writeFileSync(file, lines.slice(0, -1).join("\n") + "\n");
    const read = readJournal(file, { repair: true });
    expect(read.restored).toBe(true);
    expect(read.records.map((r) => r.type).at(-1)).toBe("run:end");
    expect(readFileSync(file, "utf-8")).toBe(text);
  });

  it("a journal cut back further than the head allows is refused as rolled back, and left as found", () => {
    const cwd = tmp();
    const file = crashed(cwd);
    const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const cut = lines.slice(0, 3).join("\n") + "\n";
    writeFileSync(file, cut);
    expect(() => readJournal(file, { repair: true })).toThrow(JournalRollbackError);
    expect(() => readJournal(file)).toThrow(/rolled back/);
    expect(readFileSync(file, "utf-8")).toBe(cut);
  });

  it("an edited or missing head is refused", () => {
    const cwd = tmp();
    const file = crashed(cwd);
    const headFile = join(journalDir(cwd, RUN_ID), "head.json");
    const original = readFileSync(headFile, "utf-8");
    writeFileSync(headFile, original.replace(/"seq":\d+/, '"seq":3'));
    expect(() => readJournal(file)).toThrow(/head file .* is not valid/);
    rmSync(headFile);
    expect(() => readJournal(file)).toThrow(/head file .* is missing/);
  });

  it("records are chained to their run: the same bytes read as another run fail authentication", () => {
    const cwd = tmp();
    const file = crashed(cwd);
    const key = loadRunKey(runKeyFile(cwd, RUN_ID));
    const read = readJournal(file, { key, runId: "20260930-120000-ffffff", head: false });
    expect(read.records).toEqual([]);
    expect(read.forgedAtLine).toBe(1);
  });

  it("two records swapped are refused", () => {
    const cwd = tmp();
    const file = crashed(cwd);
    const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    [lines[1], lines[2]] = [lines[2], lines[1]];
    writeFileSync(file, lines.join("\n") + "\n");
    const read = readJournal(file);
    expect(read.forgedAtLine).toBe(2);
    expect(read.records).toHaveLength(1);
  });

  it("a whole, authenticated last record that lost its line end is kept, and repair restores the line end", () => {
    const cwd = tmp();
    const file = crashed(cwd);
    const text = readFileSync(file, "utf-8");
    writeFileSync(file, text.slice(0, -1));
    const read = readJournal(file, { repair: true });
    expect(read.missingNewline).toBe(true);
    expect(read.truncatedBytes).toBe(0);
    expect(read.records.at(-1)).toMatchObject({ type: "run:end" });
    expect(readFileSync(file, "utf-8")).toBe(text);
  });
});

describe("tools fingerprint", () => {
  const tool = (over: Partial<Tool> = {}): Tool => ({
    name: "tenant_read",
    description: "",
    input_schema: { type: "object" },
    access: "read",
    handler: async () => null,
    ...over,
  });
  const skills = (over: Partial<Skill> = {}, mcp: Record<string, unknown> = {}) =>
    new Map<string, Skill>([
      [
        "tenant",
        {
          id: "tenant",
          name: "Tenant",
          description: "",
          category: "general",
          config: {},
          tools: [tool()],
          mcp: { command: "server", args: ["--tenant", "prod"], ...mcp },
          ...over,
        },
      ],
    ]);

  it("changes when MCP args, instructions, tool schemas or env var names change", () => {
    const base = toolsHash(skills());
    expect(toolsHash(skills({}, { args: ["--tenant", "staging"] }))).not.toBe(base);
    expect(toolsHash(skills({ instruction: "only touch staging" }))).not.toBe(base);
    expect(
      toolsHash(
        skills({ tools: [tool({ input_schema: { type: "object", properties: { id: { type: "string" } } } })] }),
      ),
    ).not.toBe(base);
    expect(toolsHash(skills({}, { env: { TENANT_TOKEN: "x" } }))).not.toBe(
      toolsHash(skills({}, { env: { OTHER_TOKEN: "x" } })),
    );
  });

  it("never depends on secret values", () => {
    expect(toolsHash(skills({}, { env: { TENANT_TOKEN: "value-one-123456" } }))).toBe(
      toolsHash(skills({}, { env: { TENANT_TOKEN: "value-two-654321" } })),
    );
    expect(toolsHash(skills({}, { headers: { Authorization: "Bearer one" } }))).toBe(
      toolsHash(skills({}, { headers: { Authorization: "Bearer two" } })),
    );
    const gh = (t: string) => ["--token", `ghp_${t.repeat(36)}`];
    expect(toolsHash(skills({}, { args: gh("a") }))).toBe(toolsHash(skills({}, { args: gh("b") })));
  });
});
