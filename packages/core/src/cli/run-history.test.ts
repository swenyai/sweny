import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExecutionTrace, NodeResult, Workflow } from "../types.js";
import {
  buildRunRecord,
  countTools,
  createNodeTimer,
  findRun,
  hashWorkflow,
  historyDisabled,
  listRuns,
  newRunId,
  pruneRuns,
  recordRun,
  writeRunRecord,
  RUN_HISTORY_DIR,
  TOOL_COUNTS_MAX,
  TOOL_NAME_MAX,
  type RunRecord,
} from "./run-history.js";
import { ensureGitignoreRuns } from "./new.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-history-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const workflow = {
  id: "demo",
  name: "Demo",
  description: "SECRET-DESCRIPTION",
  entry: "a",
  nodes: {
    a: { name: "A", instruction: "SECRET-PROMPT do the thing", skills: [] },
    b: { name: "B", instruction: "x", skills: [] },
  },
  edges: [{ from: "a", to: "b" }],
} as unknown as Workflow;

const results = new Map<string, NodeResult>([
  [
    "a",
    {
      status: "success",
      data: { secret: "SECRET-OUTPUT" },
      toolCalls: [{ tool: "github_get", input: { token: "SECRET-INPUT" }, output: "SECRET-TOOL-OUT" }],
      usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.05 },
    },
  ],
  ["b", { status: "failed", data: { error: "SECRET-ERROR-TEXT" }, toolCalls: [] }],
]);
const trace: ExecutionTrace = {
  steps: [
    { node: "a", status: "success", iteration: 1 },
    { node: "b", status: "failed", iteration: 1, retryAttempt: 0 },
    { node: "b", status: "failed", iteration: 1, retryAttempt: 2 },
  ],
  edges: [{ from: "a", to: "b", reason: "SECRET-REASON condition text" }],
  sources: {},
};

function record(over: Partial<Parameters<typeof buildRunRecord>[0]> = {}): RunRecord {
  return buildRunRecord({
    runId: "20260930-101500-abc123",
    workflow,
    startedAtMs: Date.parse("2026-09-30T10:15:00Z"),
    durationMs: 4200,
    results,
    trace,
    nodeDurations: new Map([
      ["a", 1500],
      ["b", 2500],
    ]),
    ...over,
  });
}

describe("record contents", () => {
  it("has the versioned shape with node and route detail", () => {
    const r = record();
    expect(r.schema_version).toBe(1);
    expect(r.run_id).toBe("20260930-101500-abc123");
    expect(r.workflow_id).toBe("demo");
    expect(r.workflow_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.started_at).toBe("2026-09-30T10:15:00.000Z");
    expect(r.duration_ms).toBe(4200);
    expect(r.status).toBe("failed");
    expect(r.nodes).toEqual([
      {
        id: "a",
        status: "success",
        duration_ms: 1500,
        tool_calls: 1,
        tokens: 150,
        cost_usd: 0.05,
        retries: 0,
        tool_counts: { github_get: 1 },
        tokens_in: 100,
        tokens_out: 50,
      },
      { id: "b", status: "failed", duration_ms: 2500, tool_calls: 0, tokens: null, cost_usd: null, retries: 2 },
    ]);
    expect(r.routes).toEqual([{ from: "a", to: "b" }]);
    expect(r.totals).toEqual({
      nodes_total: 2,
      nodes_ok: 1,
      nodes_skipped: 0,
      tool_calls: 1,
      tokens: 150,
      cost_usd: 0.05,
    });
  });

  it("PRIVACY: exact key set at every level, no content anywhere in the serialized record", () => {
    const r = record();
    expect(Object.keys(r).sort()).toEqual(
      [
        "detail_version",
        "duration_ms",
        "nodes",
        "routes",
        "run_id",
        "schema_version",
        "started_at",
        "status",
        "totals",
        "workflow_hash",
        "workflow_id",
      ].sort(),
    );
    for (const n of r.nodes) {
      const base = ["cost_usd", "duration_ms", "id", "retries", "status", "tokens", "tool_calls"];
      const detail = ["tool_counts", "tokens_in", "tokens_out", "num_turns"];
      const keys = Object.keys(n);
      expect(base.every((k) => keys.includes(k))).toBe(true);
      expect(keys.filter((k) => !base.includes(k)).every((k) => detail.includes(k))).toBe(true);
    }
    for (const e of r.routes) expect(Object.keys(e).sort()).toEqual(["from", "to"]);
    expect(Object.keys(r.totals).sort()).toEqual(
      ["cost_usd", "nodes_ok", "nodes_skipped", "nodes_total", "tokens", "tool_calls"].sort(),
    );
    const json = JSON.stringify(r);
    for (const leak of ["SECRET", "instruction", "description", "reason", "error", "output", "input", "env"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("records a crash with the nodes that finished", () => {
    const r = record({ crashed: true, results: new Map([["a", results.get("a")!]]), trace: undefined });
    expect(r.status).toBe("crashed");
    expect(r.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(r.routes).toEqual([]);
  });

  it("status is success when every node succeeded or skipped", () => {
    const ok = new Map<string, NodeResult>([
      ["a", { status: "success", data: {}, toolCalls: [] }],
      ["b", { status: "skipped", data: {}, toolCalls: [] }],
    ]);
    expect(record({ results: ok }).status).toBe("success");
  });
});

describe("detail fields (#537): optional, versioned, old records still read", () => {
  const rich = new Map<string, NodeResult>([
    [
      "a",
      {
        status: "success",
        data: { secret: "SECRET-OUTPUT" },
        toolCalls: [
          { tool: "Read", input: { path: "SECRET-INPUT" } },
          { tool: "Grep", input: {} },
          { tool: "Read", input: {} },
          { tool: "Evil\nname", input: {} },
        ],
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.05, numTurns: 3 },
        policy: { envScope: true, sandbox: "strict", sandboxStarted: true },
      },
    ],
  ]);

  it("stamps detail_version and records per-tool counts, token split, turns and the policy floor", () => {
    const r = record({ results: rich, trace: undefined, nodeDurations: new Map([["a", 10]]) });
    expect(r.detail_version).toBe(1);
    expect(r.schema_version).toBe(1);
    expect(r.nodes[0].tool_counts).toEqual({ Read: 2, Grep: 1, Evilname: 1 });
    expect(Object.keys(r.nodes[0].tool_counts!)).toEqual(["Read", "Grep", "Evilname"]);
    expect(r.nodes[0]).toMatchObject({ tokens_in: 100, tokens_out: 50, num_turns: 3 });
    expect(r.policy).toEqual({ scoped: true, sandbox: "strict", sandboxed: true });
  });

  it("keeps only names and counts: no tool input, no output text", () => {
    const json = JSON.stringify(record({ results: rich, trace: undefined }));
    expect(json).not.toContain("SECRET");
  });

  it("caps distinct names and name length", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ tool: `t${i}`, input: {} }));
    const counts = countTools(many)!;
    expect(Object.keys(counts)).toHaveLength(TOOL_COUNTS_MAX);
    expect(Object.keys(countTools([{ tool: "x".repeat(500) }])!)[0]).toHaveLength(TOOL_NAME_MAX);
    expect(countTools([])).toBeUndefined();
  });

  it("omits the optional fields when a node reported none", () => {
    const r = record({ results: new Map([["b", results.get("b")!]]), trace: undefined });
    expect(r.nodes[0]).not.toHaveProperty("tool_counts");
    expect(r.nodes[0]).not.toHaveProperty("tokens_in");
    expect(r).not.toHaveProperty("policy");
  });

  it("round-trips through listRuns: the detail fields survive the allow-list read", () => {
    const d = tmp();
    const written = record({ results: rich, trace: undefined, nodeDurations: new Map([["a", 10]]) });
    writeRunRecord(written, d);
    const [r] = listRuns(d);
    expect(r.detail_version).toBe(1);
    expect(r.policy).toEqual({ scoped: true, sandbox: "strict", sandboxed: true });
    expect(r.nodes[0]).toEqual(written.nodes[0]);
    expect(Object.keys(r.nodes[0].tool_counts!)).toEqual(["Read", "Grep", "Evilname"]);
  });

  it("forged detail values are dropped on read, the rest of the record kept", () => {
    const d = tmp();
    const written = record({ results: rich, trace: undefined, nodeDurations: new Map([["a", 10]]) });
    const forged = JSON.parse(JSON.stringify(written));
    forged.detail_version = "1";
    forged.policy = { scoped: "yes", sandbox: "chroot", sandboxed: true };
    forged.nodes[0].tool_counts = {
      Read: -1,
      Grep: 1.5,
      [`Bad\u001b[2Jname`]: 3,
      ["x".repeat(500)]: 1,
      Good: 2,
      Str: "9",
    };
    forged.nodes[0].tokens_in = "100";
    forged.nodes[0].tokens_out = -5;
    forged.nodes[0].num_turns = null;
    fs.mkdirSync(path.join(d, RUN_HISTORY_DIR), { recursive: true });
    fs.writeFileSync(path.join(d, RUN_HISTORY_DIR, `${written.run_id}.json`), JSON.stringify(forged));
    const [r] = listRuns(d);
    expect(r.run_id).toBe(written.run_id);
    expect(r.detail_version).toBeUndefined();
    expect(r.policy).toBeUndefined();
    expect(r.nodes[0].tool_counts).toEqual({ Good: 2 });
    expect(r.nodes[0]).not.toHaveProperty("tokens_in");
    expect(r.nodes[0]).not.toHaveProperty("tokens_out");
    expect(r.nodes[0]).not.toHaveProperty("num_turns");
    expect(r.nodes[0].tokens).toBe(150);
  });

  it("a non-object tool_counts, and a forged field on the record, are dropped", () => {
    const d = tmp();
    const written = record({ results: rich, trace: undefined });
    const forged = JSON.parse(JSON.stringify(written));
    forged.nodes[0].tool_counts = ["Read"];
    forged.surprise = "x";
    fs.mkdirSync(path.join(d, RUN_HISTORY_DIR), { recursive: true });
    fs.writeFileSync(path.join(d, RUN_HISTORY_DIR, `${written.run_id}.json`), JSON.stringify(forged));
    const [r] = listRuns(d);
    expect(r.nodes[0]).not.toHaveProperty("tool_counts");
    expect(r).not.toHaveProperty("surprise");
  });

  it("a record written before detail_version reads back unchanged, with the fields undefined", () => {
    const d = tmp();
    const legacy = {
      schema_version: 1,
      run_id: "20260101-000000-aaaaaa",
      workflow_id: "demo",
      workflow_hash: "0".repeat(64),
      started_at: "2026-01-01T00:00:00.000Z",
      duration_ms: 10,
      status: "success",
      nodes: [{ id: "a", status: "success", duration_ms: 5, tool_calls: 2, tokens: 10, cost_usd: 0.01, retries: 0 }],
      routes: [],
      totals: { nodes_total: 1, nodes_ok: 1, nodes_skipped: 0, tool_calls: 2, tokens: 10, cost_usd: 0.01 },
    };
    fs.mkdirSync(path.join(d, RUN_HISTORY_DIR), { recursive: true });
    fs.writeFileSync(path.join(d, RUN_HISTORY_DIR, "20260101-000000-aaaaaa.json"), JSON.stringify(legacy));
    const [r] = listRuns(d);
    expect(r.run_id).toBe("20260101-000000-aaaaaa");
    expect(r.detail_version).toBeUndefined();
    expect(r.policy).toBeUndefined();
    expect(r.nodes[0].tool_counts).toBeUndefined();
    expect(r.nodes[0].tool_calls).toBe(2);
  });
});

describe("hash and ids", () => {
  it("workflow hash ignores key order and changes with content", () => {
    const reordered = {
      edges: workflow.edges,
      nodes: workflow.nodes,
      entry: "a",
      description: "SECRET-DESCRIPTION",
      name: "Demo",
      id: "demo",
    } as unknown as Workflow;
    expect(hashWorkflow(reordered)).toBe(hashWorkflow(workflow));
    expect(hashWorkflow({ ...workflow, name: "Other" } as Workflow)).not.toBe(hashWorkflow(workflow));
  });

  it("run ids are UTC, sortable, and unique per call", () => {
    const id = newRunId(Date.parse("2026-09-30T10:15:00Z"), () => "a1b2c3");
    expect(id).toBe("20260930-101500-a1b2c3");
    expect(newRunId(Date.now())).toMatch(/^\d{8}-\d{6}-[0-9a-f]{6}$/);
  });
});

describe("node timer", () => {
  it("sums durations across repeated executions", () => {
    let t = 0;
    const timer = createNodeTimer(() => t);
    const res = results.get("a")!;
    timer.observer({ type: "node:enter", node: "a", instruction: "i" });
    t = 100;
    timer.observer({ type: "node:exit", node: "a", result: res });
    t = 200;
    timer.observer({ type: "node:enter", node: "a", instruction: "i" });
    t = 450;
    timer.observer({ type: "node:exit", node: "a", result: res });
    expect(timer.durations.get("a")).toBe(350);
    expect(timer.lastResults.get("a")).toBe(res);
  });
});

describe("atomic write", () => {
  it("writes <run-id>.json in .sweny/runs and leaves no temp file", () => {
    const d = tmp();
    const file = writeRunRecord(record(), d);
    expect(file).toBe(path.join(d, RUN_HISTORY_DIR, "20260930-101500-abc123.json"));
    expect(JSON.parse(fs.readFileSync(file!, "utf-8")).run_id).toBe("20260930-101500-abc123");
    expect(fs.readdirSync(path.join(d, RUN_HISTORY_DIR))).toEqual(["20260930-101500-abc123.json"]);
  });

  it("goes through a temp file then rename", () => {
    const d = tmp();
    const rename = vi.spyOn(fs, "renameSync");
    writeRunRecord(record(), d);
    const [from, to] = rename.mock.calls[0] as [string, string];
    expect(path.dirname(from)).toBe(path.dirname(to));
    expect(from).not.toBe(to);
    expect(from).toMatch(/\.tmp$/);
  });

  it("a failed rename leaves no partial record and no temp file, and does not throw", () => {
    const d = tmp();
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("EXDEV");
    });
    expect(writeRunRecord(record(), d)).toBeNull();
    expect(fs.readdirSync(path.join(d, RUN_HISTORY_DIR))).toEqual([]);
  });

  it("recordRun warns on stderr and returns false when the write fails", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, ".sweny"), "a file, not a dir");
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(recordRun(record(), d)).toBe(false);
    expect(String(err.mock.calls[0][0])).toContain("could not write run history");
  });
});

describe("prune", () => {
  it("keeps the newest N and removes the oldest", () => {
    const d = tmp();
    for (let i = 0; i < 7; i++) {
      const id = newRunId(Date.parse("2026-09-30T10:00:00Z") + i * 1000, () => "000000");
      writeRunRecord(record({ runId: id, startedAtMs: Date.parse("2026-09-30T10:00:00Z") + i * 1000 }), d);
    }
    expect(pruneRuns(d, 3)).toBe(4);
    const left = fs.readdirSync(path.join(d, RUN_HISTORY_DIR)).sort();
    expect(left).toEqual(["20260930-100004-000000.json", "20260930-100005-000000.json", "20260930-100006-000000.json"]);
  });

  it("removes a pruned run's output.md folder with it", () => {
    const d = tmp();
    const old = newRunId(Date.parse("2026-09-30T10:00:00Z"), () => "000000");
    const kept = newRunId(Date.parse("2026-09-30T10:00:01Z"), () => "000000");
    for (const id of [old, kept]) {
      writeRunRecord(record({ runId: id }), d);
      fs.mkdirSync(path.join(d, RUN_HISTORY_DIR, id), { recursive: true });
      fs.writeFileSync(path.join(d, RUN_HISTORY_DIR, id, "output.md"), "x");
    }
    expect(pruneRuns(d, 1)).toBe(1);
    expect(fs.existsSync(path.join(d, RUN_HISTORY_DIR, old))).toBe(false);
    expect(fs.existsSync(path.join(d, RUN_HISTORY_DIR, kept, "output.md"))).toBe(true);
  });

  it("recordRun prunes to 200 by default", () => {
    const d = tmp();
    const dir = path.join(d, RUN_HISTORY_DIR);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 205; i++) {
      fs.writeFileSync(path.join(dir, `20260101-${String(i).padStart(6, "0")}-aaaaaa.json`), "{}");
    }
    fs.writeFileSync(path.join(dir, "notes.json"), "{}");
    recordRun(record(), d);
    const files = fs.readdirSync(dir).filter((f) => f !== "notes.json");
    expect(files.length).toBe(200);
    expect(files).toContain("20260930-101500-abc123.json");
    expect(files).not.toContain("20260101-000000-aaaaaa.json");
    expect(fs.existsSync(path.join(dir, "notes.json"))).toBe(true);
  });
});

describe("read", () => {
  it("lists newest first and skips corrupt files and unknown schema versions", () => {
    const d = tmp();
    writeRunRecord(record({ runId: "20260930-101500-aaaaaa", startedAtMs: Date.parse("2026-09-30T10:15:00Z") }), d);
    writeRunRecord(record({ runId: "20260930-111500-bbbbbb", startedAtMs: Date.parse("2026-09-30T11:15:00Z") }), d);
    const dir = path.join(d, RUN_HISTORY_DIR);
    fs.writeFileSync(path.join(dir, "corrupt.json"), "{nope");
    fs.writeFileSync(path.join(dir, "future.json"), JSON.stringify({ ...record(), schema_version: 2 }));
    expect(listRuns(d).map((r) => r.run_id)).toEqual(["20260930-111500-bbbbbb", "20260930-101500-aaaaaa"]);
  });

  it("returns [] with no history dir", () => {
    expect(listRuns(tmp())).toEqual([]);
  });

  it("findRun matches exact ids and unique prefixes only", () => {
    const a = record({ runId: "20260930-101500-aaaaaa" });
    const b = record({ runId: "20260930-111500-bbbbbb" });
    expect(findRun([a, b], "20260930-111500-bbbbbb")).toBe(b);
    expect(findRun([a, b], "20260930-11")).toBe(b);
    expect(findRun([a, b], "20260930")).toBeUndefined();
  });
});

describe("opt-out", () => {
  it("--no-history or history: off disables", () => {
    expect(historyDisabled(true, undefined)).toBe(false);
    expect(historyDisabled(undefined, undefined)).toBe(false);
    expect(historyDisabled(false, undefined)).toBe(true);
    expect(historyDisabled(true, "off")).toBe(true);
    expect(historyDisabled(true, "OFF")).toBe(true);
    expect(historyDisabled(true, "false")).toBe(true);
    expect(historyDisabled(true, "on")).toBe(false);
  });
});

describe("gitignore", () => {
  it("adds .sweny/runs/ once", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, ".gitignore"), "node_modules");
    expect(ensureGitignoreRuns(d)).toBe("appended");
    expect(ensureGitignoreRuns(d)).toBe("present");
    expect(fs.readFileSync(path.join(d, ".gitignore"), "utf-8")).toBe("node_modules\n.sweny/runs/\n");
  });
});

describe("spend split on the record", () => {
  it("is recorded when the executor's own calls reported usage, and totals are its sum", () => {
    const r = record({
      trace: {
        ...trace,
        spend: {
          node: { tokens: 400, costUsd: 0.1, calls: 3 },
          judge: { tokens: 50, costUsd: 0.02, calls: 1 },
        },
      },
    });
    expect(r.spend).toEqual({
      node: { tokens: 400, cost_usd: 0.1, calls: 3 },
      judge: { tokens: 50, cost_usd: 0.02, calls: 1 },
    });
    expect(r.totals.tokens).toBe(450);
    expect(r.totals.cost_usd).toBe(0.12);
  });

  it("is absent without a split", () => {
    expect(record().spend).toBeUndefined();
  });
});

describe("node timer and amended results", () => {
  it("a repeated exit never counts a visit twice; an amendment only replaces the last result", () => {
    let t = 0;
    const timer = createNodeTimer(() => t);
    timer.observer({ type: "node:enter", node: "a", instruction: "" });
    t = 1500;
    timer.observer({ type: "node:exit", node: "a", result: { status: "success", data: {}, toolCalls: [] } });
    t = 2500;
    timer.observer({ type: "node:exit", node: "a", result: { status: "success", data: {}, toolCalls: [] } });
    timer.observer({ type: "node:amended", node: "a", result: { status: "failed", data: {}, toolCalls: [] } });
    expect(timer.durations.get("a")).toBe(1500);
    expect(timer.lastResults.get("a")!.status).toBe("failed");
  });
});
