/**
 * #540 hardening of `sweny runs diff` against agent-writable history. Every spec seeds files on disk
 * (`.sweny/runs/`) and reads them back through the real readers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeResult, Workflow } from "../types.js";
import {
  RUN_ANSWERS_SCHEMA_VERSION,
  readRunAnswers,
  recordRunAnswers,
  writeRunAnswers,
  type RunAnswers,
} from "./run-answers.js";
import { RUN_HISTORY_DIR, listRuns, writeRunRecord, type RunRecord } from "./run-history.js";
import { runRunsDiff } from "./runs.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-540-"));
  dirs.push(d);
  return d;
}
let stateDir = "";
beforeEach(() => {
  // The workspace key for redacted names lives in the state dir: keep tests out of the real one.
  stateDir = tmp();
  vi.stubEnv("SWENY_STATE_DIR", stateDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const A = "20261106-100000-aaaaaa";
const B = "20261106-110000-bbbbbb";
const C = "20261106-120000-cccccc";

function rec(runId: string, startedAt: string): RunRecord {
  return {
    schema_version: 1,
    run_id: runId,
    workflow_id: "triage",
    workflow_hash: "0".repeat(64),
    started_at: startedAt,
    duration_ms: 1000,
    status: "success",
    nodes: [],
    routes: [],
    totals: { nodes_total: 0, nodes_ok: 0, nodes_skipped: 0, tool_calls: 0, tokens: null, cost_usd: null },
  };
}
const ans = (runId: string, nodes: RunAnswers["nodes"]): RunAnswers => ({
  schema_version: RUN_ANSWERS_SCHEMA_VERSION,
  run_id: runId,
  workflow_id: "triage",
  nodes,
});
const ok = (data: Record<string, unknown>): NodeResult => ({ status: "success", data, toolCalls: [] });

function wf(output: unknown): Workflow {
  return {
    id: "triage",
    name: "Triage",
    description: "",
    entry: "n",
    nodes: { n: { name: "N", instruction: "x", skills: [], output } },
    edges: [],
  } as unknown as Workflow;
}

function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      cwd,
      env: {},
      stdout: { isTTY: false, write: (s: string) => (out.push(s), true) },
      stderr: { isTTY: false, write: (s: string) => (err.push(s), true) },
    },
  };
}

// ── 1. Answer keys are untrusted terminal text ──────────────────

describe("answer keys never reach the terminal as control sequences", () => {
  const OSC52 = "\x1b]52;c;ZXZpbC1jbGlwYm9hcmQ=\x07";
  const CSI = "\x1b[2J";
  const NODE = `node${OSC52}`;
  const FIELD = `field${OSC52}${CSI}`;
  const NESTED = `nested${OSC52}`;
  const ONLY_A = `gone${OSC52}`;

  function seed(): string {
    const cwd = tmp();
    writeRunRecord(rec(A, "2026-11-06T10:00:00.000Z"), cwd);
    writeRunRecord(rec(B, "2026-11-06T11:00:00.000Z"), cwd);
    writeRunAnswers(
      ans(A, {
        [NODE]: { [FIELD]: "1", items: [{ title: "T", [NESTED]: "old" }], list: [{ id: "x" }] },
        [ONLY_A]: { z: 1 },
      }),
      cwd,
    );
    writeRunAnswers(
      ans(B, {
        [NODE]: { [FIELD]: "2", items: [{ title: "T", [NESTED]: "new" }], list: [{ id: "x" }, { id: "y" }] },
      }),
      cwd,
    );
    return cwd;
  }

  it("runRunsDiff with color off prints no ESC and no BEL", () => {
    const t = io(seed());
    expect(runRunsDiff([], {}, t.io)).toBe(0);
    const out = t.out.join("");
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("\x07");
    expect(out).not.toContain("52;c;");
    expect(out).toContain("field"); // the sanitized key is still shown
    expect(out).toMatch(/nested\s+old/); // nested field name, sanitized
    expect(out).toContain("gone"); // not_compared node, sanitized
  });

  it("with color on, only the palette's SGR codes remain", () => {
    const t = io(seed());
    t.io.stdout.isTTY = true;
    runRunsDiff([], {}, t.io);
    const out = t.out.join("").replace(/\x1b\[[0-9;]*m/g, "");
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("\x07");
  });
});

// ── 2. Only values whose shape matches the declared schema ──────

describe("undeclared scalars are not kept", () => {
  it("findings: ['prose'] does not survive when only findings[].title is declared (read back from disk)", () => {
    const cwd = tmp();
    writeRunRecord(rec(A, "2026-11-06T10:00:00.000Z"), cwd);
    const workflow = wf({
      type: "object",
      properties: {
        findings: { type: "array", items: { type: "object", properties: { title: { type: "string" } } } },
        count: { type: "number" },
        label: { type: "string", enum: ["a", "b"] },
      },
    });
    const results = new Map([
      ["n", ok({ findings: ["SECRET prose", 42, { title: "kept" }], count: "ten", label: "c" })],
    ]);
    recordRunAnswers({ runId: A, workflow, results }, cwd);
    const read = readRunAnswers(A, cwd);
    expect(read?.nodes.n).toEqual({ findings: [{ title: "kept" }] });
    expect(fs.readFileSync(path.join(cwd, RUN_HISTORY_DIR, A, "answers.json"), "utf8")).not.toContain("prose");
  });

  it("a type mismatch drops the field: object where a string is declared, string where an array is", () => {
    const cwd = tmp();
    const workflow = wf({
      type: "object",
      properties: { s: { type: "string" }, list: { type: "array", items: { type: "string" } }, n: { type: "integer" } },
    });
    const results = new Map([["n", ok({ s: { nested: 1 }, list: "not a list", n: 1.5 })]]);
    recordRunAnswers({ runId: A, workflow, results }, cwd);
    expect(readRunAnswers(A, cwd)?.nodes).toEqual({}); // every declared field had the wrong shape
  });

  it("summary is stored only when the schema leaves room for it", () => {
    const cwd = tmp();
    const closed = wf({ type: "object", additionalProperties: false });
    recordRunAnswers({ runId: A, workflow: closed, results: new Map([["n", ok({ summary: "prose" })]]) }, cwd);
    expect(readRunAnswers(A, cwd)?.nodes ?? {}).toEqual({});
    const open = wf(undefined);
    recordRunAnswers({ runId: B, workflow: open, results: new Map([["n", ok({ summary: "kept" })]]) }, cwd);
    expect(readRunAnswers(B, cwd)?.nodes).toEqual({ n: { summary: "kept" } });
  });
});

// ── 3. Redacted keys cannot collide ─────────────────────────────

describe("redacted keys are injective and stable", () => {
  const K1 = "zq-one-9f3a8b7c";
  const K2 = "zq-two-9f3a8b7c";
  const LIT = "[redacted]#2";
  const props = { [K1]: { type: "string" }, [K2]: { type: "string" }, [LIT]: { type: "string" } };
  const workflow = wf({ type: "object", properties: props });
  const secrets = [K1, K2];

  it("two secret keys and a literal '[redacted]#2' keep three distinct entries and their values", () => {
    const cwd = tmp();
    recordRunAnswers(
      { runId: A, workflow, results: new Map([["n", ok({ [K1]: "v1", [K2]: "v2", [LIT]: "v3" })]]), secrets },
      cwd,
    );
    const fields = readRunAnswers(A, cwd)!.nodes.n;
    expect(Object.keys(fields)).toHaveLength(3);
    expect(Object.values(fields).sort()).toEqual(["v1", "v2", "v3"]);
    expect(JSON.stringify(fields)).not.toContain("zq-");
  });

  it("the same key keeps the same name whichever other keys are present, so a diff sees the change", () => {
    const cwd = tmp();
    const full = (id: string, v2: string) =>
      recordRunAnswers(
        { runId: id, workflow, results: new Map([["n", ok({ [K1]: "v1", [K2]: v2, [LIT]: "v3" })]]), secrets },
        cwd,
      );
    full(A, "old");
    full(B, "new");
    const a = readRunAnswers(A, cwd)!.nodes.n;
    const b = readRunAnswers(B, cwd)!.nodes.n;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    const only = (id: string) =>
      recordRunAnswers({ runId: id, workflow, results: new Map([["n", ok({ [K2]: "x" })]]), secrets }, cwd);
    only(C);
    const c = readRunAnswers(C, cwd)!.nodes.n;
    const nameOfK2 = Object.keys(a).find((k) => a[k] === "old")!;
    expect(Object.keys(c)).toEqual([nameOfK2]);
    writeRunRecord(rec(A, "2026-11-06T10:00:00.000Z"), cwd);
    writeRunRecord(rec(B, "2026-11-06T11:00:00.000Z"), cwd);
    const t = io(cwd);
    expect(runRunsDiff([], {}, t.io)).toBe(0);
    expect(t.out.join("")).toContain("answers: 0 added, 0 resolved, 1 changed, 2 unchanged");
  });
});

describe("redacted key names are keyed, not a plain hash of the secret", () => {
  const K = "zq-one-9f3a8b7c";
  const workflow = wf({ type: "object", properties: { [K]: { type: "string" } } });
  const build = (cwd: string, id: string) =>
    recordRunAnswers({ runId: id, workflow, results: new Map([["n", ok({ [K]: "v" })]]), secrets: [K] }, cwd);
  const keyFiles = () =>
    fs.existsSync(path.join(stateDir, "keys")) ? fs.readdirSync(path.join(stateDir, "keys")) : [];

  it("no plain sha256 of the secret appears; the name is an HMAC under a 0600 key in the state dir", () => {
    const cwd = tmp();
    build(cwd, A);
    const raw = fs.readFileSync(path.join(cwd, RUN_HISTORY_DIR, A, "answers.json"), "utf8");
    const plain = crypto.createHash("sha256").update(K).digest("hex");
    expect(raw).not.toContain(plain.slice(0, 16));
    expect(raw).not.toContain(K);
    const [file] = keyFiles();
    expect(file).toBeDefined();
    const keyPath = path.join(stateDir, "keys", file);
    expect(fs.statSync(keyPath).mode & 0o077).toBe(0);
    const keyHex = fs.readFileSync(keyPath, "utf8").trim();
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(raw).not.toContain(keyHex);
    const name = Object.keys(readRunAnswers(A, cwd)!.nodes.n)[0];
    const mac = crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(K).digest("hex").slice(0, 16);
    expect(name).toBe(`[redacted-${mac}]`);
  });

  it("the same key gives the same name across runs; another workspace or state dir gives another name", () => {
    const cwd = tmp();
    build(cwd, A);
    build(cwd, B);
    const nameA = Object.keys(readRunAnswers(A, cwd)!.nodes.n)[0];
    expect(Object.keys(readRunAnswers(B, cwd)!.nodes.n)[0]).toBe(nameA);
    const other = tmp();
    build(other, A);
    expect(Object.keys(readRunAnswers(A, other)!.nodes.n)[0]).not.toBe(nameA);
  });

  it("a state dir inside the workspace is not trusted: no key is written there, names stay distinct and secret-free", () => {
    const cwd = tmp();
    vi.stubEnv("SWENY_STATE_DIR", path.join(cwd, ".state"));
    const two = wf({ type: "object", properties: { [K]: { type: "string" }, other: { type: "string" } } });
    recordRunAnswers(
      { runId: A, workflow: two, results: new Map([["n", ok({ [K]: "v", other: "w" })]]), secrets: [K] },
      cwd,
    );
    expect(fs.existsSync(path.join(cwd, ".state", "keys"))).toBe(false);
    const fields = readRunAnswers(A, cwd)!.nodes.n;
    expect(Object.keys(fields)).toHaveLength(2);
    expect(JSON.stringify(fields)).not.toContain("zq-");
  });
});

// ── 4. Symlinked run records are not history ────────────────────

describe("listRuns ignores linked records", () => {
  it("a record file that is a symlink is skipped, even when its target is a valid record", () => {
    const cwd = tmp();
    writeRunRecord(rec(A, "2026-11-06T10:00:00.000Z"), cwd);
    writeRunRecord(rec(B, "2026-11-06T11:00:00.000Z"), cwd);
    const elsewhere = tmp();
    fs.writeFileSync(path.join(elsewhere, "real.json"), JSON.stringify(rec(C, "2026-11-06T12:00:00.000Z")));
    fs.symlinkSync(path.join(elsewhere, "real.json"), path.join(cwd, RUN_HISTORY_DIR, `${C}.json`));
    expect(listRuns(cwd).map((r) => r.run_id)).toEqual([B, A]);
  });

  it("a dangling or looping link does not throw", () => {
    const cwd = tmp();
    writeRunRecord(rec(A, "2026-11-06T10:00:00.000Z"), cwd);
    fs.symlinkSync(path.join(cwd, "nope"), path.join(cwd, RUN_HISTORY_DIR, `${B}.json`));
    expect(listRuns(cwd).map((r) => r.run_id)).toEqual([A]);
  });
});
