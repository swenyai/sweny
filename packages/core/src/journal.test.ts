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
import { createHash, createHmac } from "node:crypto";
import {
  JOURNAL_FILE,
  JOURNAL_SCHEMA_VERSION,
  JournalLockedError,
  JournalVersionError,
  REDACTED,
  RunJournal,
  buildResumePlan,
  workflowHashOf,
  collectSecretValues,
  journalDir,
  listJournalRuns,
  loadRunKey,
  pruneJournals,
  readJournal,
  redact,
  runKeyFile,
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
  it("are versioned, sequenced, authenticated with a key outside the workspace, one per line", () => {
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "w.yml" });
    begin(j);
    j.nodeStart("a", 1);
    j.nodeEnd("a", 1, ok({ x: 1 }), createWriteStageState());
    j.route("a", "b");
    j.end("crashed");

    const text = readFileSync(join(journalDir(cwd, RUN_ID), JOURNAL_FILE), "utf-8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["run:start", "node:start", "node:end", "route", "run:end"]);
    const key = loadRunKey(runKeyFile(cwd, RUN_ID));
    expect(runKeyFile(cwd, RUN_ID).startsWith(cwd)).toBe(false);
    lines.forEach((l, i) => {
      expect(l.v).toBe(JOURNAL_SCHEMA_VERSION);
      expect(l.seq).toBe(i + 1);
      const { h, ...body } = l;
      expect(h).toBe(createHmac("sha256", key).update(JSON.stringify(body)).digest("hex"));
    });
    expect(lines[0]).toMatchObject({
      run_id: RUN_ID,
      workflow_id: "w",
      workflow_file: "w.yml",
      workflow_hash: workflowHashOf(wf),
    });
    // The run dir keeps itself out of git.
    expect(readFileSync(join(journalDir(cwd, RUN_ID), ".gitignore"), "utf-8")).toBe("*\n");
    // The lock is released at the end.
    expect(existsSync(join(journalDir(cwd, RUN_ID), "journal.lock"))).toBe(false);
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
    expect(() => readJournal(join(dir, JOURNAL_FILE), { repair: true })).toThrow(/predates authenticated records/);
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
  it("keeps the newest journals and never the one being written", () => {
    const cwd = tmp();
    const ids = ["20260101-000000-000001", "20260102-000000-000002", "20260103-000000-000003"];
    for (const id of ids) {
      mkdirSync(journalDir(cwd, id), { recursive: true });
      writeFileSync(join(journalDir(cwd, id), JOURNAL_FILE), "");
    }
    expect(pruneJournals(cwd, 2, ids[0])).toBe(1);
    expect(listJournalRuns(cwd)).toEqual([ids[0], ids[2]]);
  });

  it("refuses a resume while another live process holds the journal", () => {
    const cwd = tmp();
    const j = RunJournal.create({ runId: RUN_ID, cwd });
    begin(j);
    j.end("crashed");
    writeFileSync(join(journalDir(cwd, RUN_ID), "journal.lock"), String(process.ppid));
    const read = readJournal(join(journalDir(cwd, RUN_ID), JOURNAL_FILE));
    expect(() => RunJournal.openForResume({ runId: RUN_ID, cwd, read, plan: buildResumePlan(read.records) })).toThrow(
      JournalLockedError,
    );
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
