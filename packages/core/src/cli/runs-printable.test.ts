/**
 * #592: `sweny runs` and `sweny runs diff` print and export only validated record fields. Every spec
 * seeds forged files in `.sweny/runs/` and reads them back through the real readers.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUN_HISTORY_DIR } from "./run-history.js";
import { formatRunDiff, formatRunsJson, formatRunsTable, printableRun, runRunsDiff } from "./runs.js";
import { listRuns } from "./run-history.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const A = "20261106-100000-aaaaaa";
const B = "20261106-110000-bbbbbb";
const OSC = "\x1b]52;c;ZXZpbA==\x07";
const CSI = "\x1b[2J";

function forged(runId: string, startedAt: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    run_id: runId,
    workflow_id: "triage",
    workflow_hash: "0".repeat(64),
    started_at: startedAt,
    duration_ms: 1000,
    status: "success",
    nodes: [{ id: "n", status: "success", duration_ms: 1, tool_calls: 1, tokens: 1, cost_usd: 0, retries: 0 }],
    routes: [{ from: "a", to: "b", rung: "expr" }],
    totals: { nodes_total: 1, nodes_ok: 1, nodes_skipped: 0, tool_calls: 1, tokens: 1, cost_usd: 0 },
    ...over,
  };
}

function seed(a: Record<string, unknown>, b: Record<string, unknown>): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-592-"));
  dirs.push(cwd);
  const dir = path.join(cwd, RUN_HISTORY_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${A}.json`), JSON.stringify(a));
  fs.writeFileSync(path.join(dir, `${B}.json`), JSON.stringify(b));
  return cwd;
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

const allKeys = (v: unknown, acc: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, acc));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      acc.add(k);
      allKeys(x, acc);
    }
  }
  return acc;
};

describe("unknown keys never pass through", () => {
  const extra = { evil_key: `x${OSC}`, nested: { deep: 1 } };
  const rec = forged(A, "2026-11-06T10:00:00.000Z", {
    ...extra,
    nodes: [
      { id: "n", status: "success", duration_ms: 1, tool_calls: 1, tokens: 1, cost_usd: 0, retries: 0, ...extra },
    ],
    routes: [{ from: "a", to: "b", ...extra }],
    totals: { nodes_total: 1, nodes_ok: 1, nodes_skipped: 0, tool_calls: 1, tokens: 1, cost_usd: 0, ...extra },
    harness: { id: "h", version: "1", ...extra },
  });

  it("printableRun drops unknown keys at every level", () => {
    const keys = allKeys(printableRun(rec as never));
    expect(keys.has("evil_key")).toBe(false);
    expect(keys.has("nested")).toBe(false);
    expect(keys.has("deep")).toBe(false);
  });

  it("runs diff --json (from disk) has no unknown keys and no control characters", () => {
    const cwd = seed(rec, forged(B, "2026-11-06T11:00:00.000Z", extra));
    const t = io(cwd);
    expect(runRunsDiff([], { json: true }, t.io)).toBe(0);
    const j = JSON.parse(t.out.join(""));
    expect(Object.keys(j)).toEqual(["schema_version", "a", "b", "answers"]);
    expect(allKeys(j.a).has("evil_key")).toBe(false);
    expect(allKeys(j.b).has("evil_key")).toBe(false);
    expect(Object.keys(j.a)).toEqual([
      "schema_version",
      "run_id",
      "workflow_id",
      "workflow_hash",
      "started_at",
      "duration_ms",
      "status",
      "nodes",
      "routes",
      "totals",
      "harness",
    ]);
    expect(t.out.join("")).not.toMatch(/\\u001b|\\u0007|\x1b|\x07/);
  });

  it("runs --json (list) is validated the same way", () => {
    const cwd = seed(rec, forged(B, "2026-11-06T11:00:00.000Z", extra));
    const json = formatRunsJson(listRuns(cwd));
    expect(json).not.toContain("evil_key");
    expect(JSON.parse(json)).toHaveLength(2);
  });
});

describe("escape sequences in harness and degraded fields", () => {
  const rec = forged(A, "2026-11-06T10:00:00.000Z", {
    harness: { id: `claude${OSC}`, version: `1${CSI}` },
    degraded: [`skills${OSC}`, 42, null, `mcp${CSI}`],
  });

  it("are stripped in the printable record, the diff text and the JSON", () => {
    const p = printableRun(rec as never);
    expect(p.harness).toEqual({ id: "claude", version: "1" });
    expect(p.degraded).toEqual(["skills", "mcp"]);
    const cwd = seed(rec, forged(B, "2026-11-06T11:00:00.000Z"));
    const t = io(cwd);
    runRunsDiff([], {}, t.io);
    expect(t.out.join("")).not.toMatch(/[\x1b\x07]/);
    const j = io(cwd);
    runRunsDiff([], { json: true }, j.io);
    expect(JSON.parse(j.out.join("")).a.harness).toEqual({ id: "claude", version: "1" });
  });

  it("a non-object harness and non-array degraded are omitted", () => {
    const p = printableRun(forged(A, "x", { harness: "str", degraded: "str" }) as never);
    expect("harness" in p).toBe(false);
    expect("degraded" in p).toBe(false);
  });
});

describe("malformed entries are skipped, never thrown on", () => {
  const bad = forged(A, "2026-11-06T10:00:00.000Z", {
    routes: [
      null,
      7,
      "x",
      [],
      { from: "a" },
      { to: "b" },
      { from: "ok", to: "fine", rung: `agent${OSC}` },
      { from: "c", to: "d", rung: "decider" },
    ],
    nodes: [null, "n", { id: "good", status: "success" }],
    totals: null,
  });

  it("printableRun keeps only well-formed routes and nodes", () => {
    const p = printableRun(bad as never);
    expect(p.routes).toEqual([
      { from: "ok", to: "fine" },
      { from: "c", to: "d", rung: "decider" },
    ]);
    expect(p.nodes.map((n) => n.id)).toEqual(["good"]);
    expect(p.totals.nodes_total).toBe(0);
  });

  it("`routes: [null]` does not crash the table or the diff (from disk)", () => {
    const cwd = seed(forged(A, "2026-11-06T10:00:00.000Z", { routes: [null] }), forged(B, "2026-11-06T11:00:00.000Z"));
    const runs = listRuns(cwd);
    expect(() => formatRunsTable(runs, false)).not.toThrow();
    const t = io(cwd);
    expect(runRunsDiff([], {}, t.io)).toBe(0);
    expect(() => formatRunDiff(runs[1], runs[0], false)).not.toThrow();
    const j = io(cwd);
    expect(runRunsDiff([], { json: true }, j.io)).toBe(0);
    expect(JSON.parse(j.out.join("")).a.routes).toEqual([]);
  });
});

describe("the documented --json shape is stable for a clean record", () => {
  it("a valid record round-trips unchanged", () => {
    const clean = forged(A, "2026-11-06T10:00:00.000Z", {
      harness: { id: "claude-code", version: "2.0" },
      degraded: ["skills"],
      spend: { node: { tokens: 1, cost_usd: 0.5, calls: 2 } },
    });
    expect(printableRun(clean as never)).toEqual(clean);
  });
});

describe("listRuns exposes allow-listed, typed records to every caller", () => {
  it("a forged record read from disk carries no unknown keys and only valid sub-entries", () => {
    const extra = { evil_key: "x", nested: { deep: 1 } };
    const cwd = seed(
      forged(A, "2026-11-06T10:00:00.000Z", {
        ...extra,
        nodes: [null, { id: 5, status: "success" }, { id: "n", status: "success", duration_ms: "x", ...extra }],
        routes: [null, { from: "a" }, { from: "a", to: "b", rung: "bogus", ...extra }],
        totals: { nodes_total: "9", ...extra },
        harness: { id: "h", version: 1 },
        degraded: ["ok", 3, null],
        spend: { node: { tokens: 1, cost_usd: 2, calls: 3, ...extra }, bogus: { tokens: 1 }, judge: "no" },
      }),
      forged(B, "2026-11-06T11:00:00.000Z", { status: { x: 1 } }),
    );
    const runs = listRuns(cwd);
    expect(runs.map((r) => r.run_id)).toEqual([A]); // B has a non-string status: skipped
    const keys = allKeys(runs);
    for (const k of ["evil_key", "nested", "deep", "bogus"]) expect(keys.has(k)).toBe(false);
    expect(runs[0].nodes).toEqual([
      { id: "n", status: "success", duration_ms: 0, tool_calls: 0, tokens: null, cost_usd: null, retries: 0 },
    ]);
    expect(runs[0].routes).toEqual([{ from: "a", to: "b" }]);
    expect(runs[0].totals.nodes_total).toBe(0);
    expect(runs[0].harness).toBeUndefined();
    expect(runs[0].degraded).toEqual(["ok"]);
    expect(runs[0].spend).toEqual({ node: { tokens: 1, cost_usd: 2, calls: 3 } });
  });
});
