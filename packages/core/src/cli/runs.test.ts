import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatAge, formatRunDiff, formatRunsTable, pickRunsForDiff, runRunsDiff } from "./runs.js";
import { writeRunRecord, type RunRecord } from "./run-history.js";
import { RUN_ANSWERS_SCHEMA_VERSION, compareAnswers, writeRunAnswers, type RunAnswers } from "./run-answers.js";
import { colorEnabled } from "./terminal.js";

const NOW = Date.parse("2026-09-30T12:00:00Z");

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    schema_version: 1,
    run_id: "20260930-110000-aaaaaa",
    workflow_id: "triage",
    workflow_hash: "3f2a9c1" + "0".repeat(57),
    started_at: "2026-09-30T11:00:00.000Z",
    duration_ms: 130_000,
    status: "success",
    nodes: [
      { id: "gather", status: "success", duration_ms: 4100, tool_calls: 4, tokens: 3200, cost_usd: 0.04, retries: 0 },
      {
        id: "analyze",
        status: "success",
        duration_ms: 90_000,
        tool_calls: 10,
        tokens: 9000,
        cost_usd: 0.14,
        retries: 0,
      },
    ],
    routes: [{ from: "gather", to: "analyze" }],
    totals: { nodes_total: 2, nodes_ok: 2, nodes_skipped: 0, tool_calls: 14, tokens: 12_200, cost_usd: 0.18 },
    ...over,
  };
}

describe("formatAge", () => {
  it("renders compact relative ages", () => {
    expect(formatAge("2026-09-30T11:59:40Z", NOW)).toBe("just now");
    expect(formatAge("2026-09-30T11:57:00Z", NOW)).toBe("3m ago");
    expect(formatAge("2026-09-30T09:00:00Z", NOW)).toBe("3h ago");
    expect(formatAge("2026-09-26T12:00:00Z", NOW)).toBe("4d ago");
  });
});

describe("formatRunsTable", () => {
  it("prints an aligned table with no ANSI when color is off", () => {
    const out = formatRunsTable(
      [
        run(),
        run({
          run_id: "20260930-100000-bbbbbb",
          workflow_id: "implement-long-name",
          status: "crashed",
          duration_ms: 900,
          started_at: "2026-09-27T12:00:00Z",
          totals: { nodes_total: 0, nodes_ok: 0, nodes_skipped: 0, tool_calls: 0, tokens: null, cost_usd: null },
        }),
      ],
      false,
      NOW,
    );
    expect(out).not.toMatch(/\x1b\[/);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^ {2}ID +WORKFLOW +STATUS +DURATION +TOKENS +COST +AGE$/);
    expect(lines[1]).toContain("20260930-110000-aaaaaa");
    expect(lines[1]).toContain("✓ success");
    expect(lines[1]).toContain("2m10s");
    expect(lines[1]).toContain("12k");
    expect(lines[1]).toContain("$0.18");
    expect(lines[1]).toContain("1h ago");
    expect(lines[2]).toContain("✗ crashed");
    expect(lines[2]).toContain("900ms");
    expect(lines[2]).toContain("3d ago");
    // columns line up: every row's AGE column starts where the header's does
    const ageCol = lines[0].indexOf("AGE");
    expect(lines[1].indexOf("1h ago")).toBe(ageCol);
    expect(lines[2].indexOf("3d ago")).toBe(ageCol);
  });

  it("colors status only when color is on", () => {
    const out = formatRunsTable([run()], true, NOW);
    // color on means the status carries its role color (any chalk level: 16, 256 or truecolor)
    expect(out).toMatch(/\x1b\[[\d;]+m✓ success/);
    expect(formatRunsTable([run()], false, NOW)).not.toMatch(/\x1b\[/);
  });

  it("explains an empty history", () => {
    expect(formatRunsTable([], false)).toContain("No runs recorded yet");
  });
});

describe("formatRunDiff", () => {
  const a = run();
  const b = run({
    run_id: "20260930-113000-cccccc",
    workflow_hash: "9b8c7d2" + "0".repeat(57),
    status: "failed",
    duration_ms: 182_000,
    nodes: [
      { id: "gather", status: "success", duration_ms: 5000, tool_calls: 4, tokens: 3400, cost_usd: 0.05, retries: 0 },
      {
        id: "analyze",
        status: "failed",
        duration_ms: 90_000,
        tool_calls: 10,
        tokens: 9000,
        cost_usd: 0.14,
        retries: 2,
      },
      { id: "notify", status: "skipped", duration_ms: 0, tool_calls: 0, tokens: null, cost_usd: null, retries: 0 },
    ],
    routes: [{ from: "gather", to: "notify" }],
    totals: { nodes_total: 3, nodes_ok: 1, nodes_skipped: 1, tool_calls: 14, tokens: 15_000, cost_usd: 0.25 },
  });

  it("shows hash change, status arrow, signed deltas, added nodes, and route differences", () => {
    const out = formatRunDiff(a, b, false);
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).toContain("workflow   changed 3f2a9c1 → 9b8c7d2");
    expect(out).toContain("status     ✓ success → ✗ failed");
    expect(out).toContain("duration   2m10s → 3m02s (+52s)");
    expect(out).toContain("tokens     12k → 15k (+2.8k)");
    expect(out).toContain("cost       $0.18 → $0.25 (+$0.07)");
    expect(out).toMatch(
      /gather\s+✓\s+duration 4\.1s → 5s \(\+900ms\)\s+tokens 3\.2k → 3\.4k \(\+200\)\s+cost \$0\.04 → \$0\.05 \(\+\$0\.01\)/,
    );
    expect(out).toMatch(/analyze\s+✓ → ✗\s+retries 0 → 2 \(\+2\)/);
    expect(out).toMatch(/notify\s+added − skipped/);
    expect(out).toContain("- gather → analyze  (only in a)");
    expect(out).toContain("+ gather → notify  (only in b)");
  });

  it("negative deltas are signed and identical runs say so", () => {
    const faster = run({ duration_ms: 100_000, totals: { ...a.totals, cost_usd: 0.1 } });
    const out = formatRunDiff(a, faster, false);
    expect(out).toContain("(-30s)");
    expect(out).toContain("(-$0.08)");
    const same = formatRunDiff(a, run({ run_id: "20260930-120000-dddddd" }), false);
    expect(same).toContain("workflow   unchanged (3f2a9c1)");
    expect(same).toContain("status     ✓ success (same)");
    expect(same).toContain("identical");
    expect(same).toContain("no change");
  });

  it("marks removed nodes", () => {
    const out = formatRunDiff(b, a, false);
    expect(out).toMatch(/notify\s+removed \(was − skipped\)/);
  });
});

describe("pickRunsForDiff", () => {
  const newest = run({ run_id: "20260930-130000-nnnnnn", workflow_id: "triage", started_at: "2026-09-30T13:00:00Z" });
  const other = run({ run_id: "20260930-125000-oooooo", workflow_id: "implement", started_at: "2026-09-30T12:50:00Z" });
  const older = run({ run_id: "20260930-120000-pppppp", workflow_id: "triage", started_at: "2026-09-30T12:00:00Z" });
  const runs = [newest, other, older]; // newest first, as listRuns returns

  it("defaults to the newest two runs of the newest workflow that has a pair (a older, b newer)", () => {
    const p = pickRunsForDiff(runs, []);
    expect(p).toEqual({ a: older, b: newest });
  });

  it("skips a newest run whose workflow has no pair", () => {
    const lone = run({ run_id: "20260930-140000-llllll", workflow_id: "solo", started_at: "2026-09-30T14:00:00Z" });
    expect(pickRunsForDiff([lone, ...runs], [])).toEqual({ a: older, b: newest });
  });

  it("honors --workflow", () => {
    expect(pickRunsForDiff(runs, [], "implement")).toEqual({ error: expect.stringContaining("found 1") });
  });

  it("resolves explicit ids and prefixes, and errors clearly", () => {
    expect(pickRunsForDiff(runs, ["20260930-1200", "20260930-1300"])).toEqual({ a: older, b: newest });
    expect(pickRunsForDiff(runs, ["nope", "20260930-1300"])).toEqual({ error: expect.stringContaining('"nope"') });
    expect(pickRunsForDiff(runs, ["20260930-1300"])).toEqual({ error: expect.stringContaining("two run ids") });
    expect(pickRunsForDiff([], [])).toEqual({
      error: "No runs recorded yet. Run `sweny workflow run <file>` twice, then `sweny runs diff`.",
    });
  });

  it("tells a user with one run to run it again", () => {
    const one = pickRunsForDiff([newest], []);
    expect(one).toEqual({ error: expect.stringContaining("found 1. Run it again, then `sweny runs diff`.") });
  });
});

// ── Answers: what changed in the output ─────────────────────────

const ansA: RunAnswers = {
  schema_version: RUN_ANSWERS_SCHEMA_VERSION,
  run_id: "20260930-110000-aaaaaa",
  workflow_id: "triage",
  nodes: {
    investigate: {
      findings: [
        { title: "Stale cache key", severity: "low" },
        { title: "Null deref in checkout", severity: "medium" },
        { title: "Slow query", severity: "low" },
      ],
      novel_count: 2,
    },
    report: { summary: "line one\nline two\nline three" },
  },
};
const ansB: RunAnswers = {
  schema_version: RUN_ANSWERS_SCHEMA_VERSION,
  run_id: "20260930-113000-cccccc",
  workflow_id: "triage",
  nodes: {
    investigate: {
      findings: [
        { title: "Race in token refresh", severity: "high" },
        { title: "Null deref in checkout", severity: "high" },
        { title: "Slow query", severity: "low" },
      ],
      novel_count: 3,
    },
    report: { summary: "line one\nline two changed\nline three\nline four" },
  },
};
const recA = run();
const recB = run({ run_id: "20260930-113000-cccccc" });
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("formatRunDiff: answers", () => {
  const cmp = compareAnswers(ansA, ansB);

  it("shows added, resolved, changed findings and value changes, answers first", () => {
    const out = formatRunDiff(recA, recB, false, { answers: cmp });
    expect(out).not.toMatch(/\x1b\[/);
    expect(out.indexOf("  answers")).toBeGreaterThan(out.indexOf("  b  "));
    expect(out.indexOf("  answers")).toBeLessThan(out.indexOf("workflow   unchanged"));
    expect(out).toMatch(/findings\s+1 added · 1 resolved · 1 changed · 1 unchanged/);
    expect(out).toContain("+ Race in token refresh");
    expect(out).toContain("- Stale cache key");
    expect(out).toContain("~ Null deref in checkout");
    expect(out).toMatch(/severity\s+medium → high/);
    expect(out).toMatch(/novel_count\s+2 → 3/);
    expect(out).toMatch(/summary\s+\+2 -1 lines/);
  });

  it("hides unchanged items and says so for a node with nothing changed", () => {
    const same = formatRunDiff(recA, recB, false, { answers: compareAnswers(ansA, { ...ansA, run_id: recB.run_id }) });
    expect(same).not.toContain("Slow query");
    expect(same).toMatch(/investigate\s+unchanged/);
    expect(same).toMatch(/report\s+unchanged/);
  });

  it("always ends on one plain final line with the four counts", () => {
    const color = formatRunDiff(recA, recB, true, { answers: cmp });
    const lines = strip(color).trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe("  answers: 1 added, 1 resolved, 3 changed, 1 unchanged");
    // the last line carries no ANSI even when color is on
    expect(color.trimEnd().split("\n").pop()).not.toMatch(/\x1b\[/);
  });

  it("colors the markers only when color is on (NO_COLOR and non-TTY render identical plain text)", () => {
    const on = formatRunDiff(recA, recB, true, { answers: cmp });
    expect(on).toMatch(/\x1b\[/);
    const noColor = colorEnabled({ isTTY: true }, { NO_COLOR: "1" });
    const piped = colorEnabled({ isTTY: false }, {});
    expect(noColor).toBe(false);
    expect(piped).toBe(false);
    const plain = formatRunDiff(recA, recB, noColor, { answers: cmp });
    expect(plain).toBe(formatRunDiff(recA, recB, piped, { answers: cmp }));
    expect(plain).toBe(strip(on));
  });

  it("falls back to the ASCII glyph set", () => {
    const out = formatRunDiff(recA, recB, false, { answers: cmp, unicode: false });
    expect(out).toMatch(/severity\s+medium -> high/);
    expect(out).toMatch(/1 added \| 1 resolved/);
    expect(out).toMatch(/status\s+\+ success \(same\)/);
    expect(out).not.toMatch(/[→·✓✗−]/);
  });

  it("caps long lists and keeps counts honest", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Finding ${i}` }));
    const big = formatRunDiff(recA, recB, false, {
      answers: compareAnswers({ ...ansA, nodes: { n: { items: [] } } }, { ...ansB, nodes: { n: { items: many(14) } } }),
    });
    expect(big).toContain("+ Finding 9");
    expect(big).not.toContain("+ Finding 10");
    expect(big).toContain("… and 4 more added");
    expect(big.trimEnd().split("\n").pop()).toBe("  answers: 14 added, 0 resolved, 0 changed, 0 unchanged");
  });

  it("strips terminal control characters that an answer could carry", () => {
    const evil = compareAnswers(
      { ...ansA, nodes: { n: { items: [] } } },
      { ...ansB, nodes: { n: { items: [{ title: "bad\x1b[2Jtitle\x07" }] } } },
    );
    const out = formatRunDiff(recA, recB, false, { answers: evil });
    expect(out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
    expect(out).toContain("bad [2Jtitle");
  });

  it("notes nodes that could not be compared", () => {
    const c = compareAnswers(ansA, { ...ansB, nodes: { investigate: ansB.nodes.investigate } });
    const out = formatRunDiff(recA, recB, false, { answers: c });
    expect(out).toMatch(/report\s+not compared \(answer in a only\)/);
  });

  it("explains missing answers and mismatched workflows on the final line", () => {
    const missing = formatRunDiff(recA, recB, false, { answers: compareAnswers(null, ansB) });
    expect(missing.trimEnd().split("\n").pop()).toBe(
      "  answers: not recorded for 20260930-110000-aaaaaa (runs made with --no-history, or by an older sweny, have none)",
    );
    const mismatch = formatRunDiff(recA, recB, false, {
      answers: compareAnswers(ansA, { ...ansB, workflow_id: "implement" }),
    });
    expect(mismatch.trimEnd().split("\n").pop()).toBe("  answers: not compared (different workflows)");
  });
});

describe("runRunsDiff", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  function seed(): string {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-runsdiff-"));
    dirs.push(cwd);
    return cwd;
  }
  function io(cwd: string, over: { isTTY?: boolean; env?: Record<string, string | undefined> } = {}) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        cwd,
        env: over.env ?? {},
        stdout: { isTTY: over.isTTY ?? false, write: (s: string) => (out.push(s), true) },
        stderr: { isTTY: false, write: (s: string) => (err.push(s), true) },
      },
    };
  }
  function record(cwd: string, r: RunRecord, a?: RunAnswers) {
    writeRunRecord(r, cwd);
    if (a) writeRunAnswers(a, cwd);
  }

  it("empty history: exit 1 with a hint, nothing on stdout", () => {
    const cwd = seed();
    const t = io(cwd);
    expect(runRunsDiff([], {}, t.io)).toBe(1);
    expect(t.out).toEqual([]);
    expect(t.err.join("")).toContain("No runs recorded yet. Run `sweny workflow run <file>` twice");
  });

  it("single run: exit 1 and tells the user to run it again", () => {
    const cwd = seed();
    record(cwd, recA, ansA);
    const t = io(cwd);
    expect(runRunsDiff([], {}, t.io)).toBe(1);
    expect(t.err.join("")).toContain('Need two runs of "triage" to diff; found 1. Run it again');
  });

  it("two runs of one workflow: plain text diff ending on the counts line", () => {
    const cwd = seed();
    record(cwd, recA, ansA);
    record(cwd, { ...recB, started_at: "2026-09-30T11:30:00.000Z" }, ansB);
    const t = io(cwd);
    expect(runRunsDiff([], {}, t.io)).toBe(0);
    const text = t.out.join("");
    expect(text).not.toMatch(/\x1b\[/);
    expect(text).toContain("+ Race in token refresh");
    expect(text.trimEnd().split("\n").pop()).toBe("  answers: 1 added, 1 resolved, 3 changed, 1 unchanged");
  });

  it("--json has the documented stable shape", () => {
    const cwd = seed();
    record(cwd, recA, ansA);
    record(cwd, { ...recB, started_at: "2026-09-30T11:30:00.000Z" }, ansB);
    const t = io(cwd, { isTTY: true });
    expect(runRunsDiff([], { json: true }, t.io)).toBe(0);
    const j = JSON.parse(t.out.join(""));
    expect(Object.keys(j)).toEqual(["schema_version", "a", "b", "answers"]);
    expect(j.schema_version).toBe(1);
    expect(j.a.run_id).toBe(recA.run_id);
    expect(j.b.run_id).toBe(recB.run_id);
    expect(j.answers.available).toBe(true);
    expect(j.answers.counts).toEqual({ added: 1, resolved: 1, changed: 3, unchanged: 1 });
    expect(Object.keys(j.answers)).toEqual(["available", "counts", "entries", "not_compared"]);
    const findings = j.answers.entries.find((e: { field: string }) => e.field === "findings");
    expect(Object.keys(findings)).toEqual(["node", "field", "kind", "added", "resolved", "changed", "unchanged"]);
    expect(findings.added[0]).toEqual({
      id: "race in token refresh",
      label: "Race in token refresh",
      value: { title: "Race in token refresh", severity: "high" },
    });
    expect(findings.changed[0].fields).toEqual([{ field: "severity", before: "medium", after: "high" }]);
    const value = j.answers.entries.find((e: { field: string }) => e.field === "novel_count");
    expect(value).toEqual({
      node: "investigate",
      field: "novel_count",
      kind: "value",
      status: "changed",
      before: 2,
      after: 3,
    });
    // never ANSI, even on a TTY
    expect(t.out.join("")).not.toMatch(/\x1b\[/);
  });

  it("--json when answers were not recorded: available false with a reason, exit 0", () => {
    const cwd = seed();
    record(cwd, recA);
    record(cwd, { ...recB, started_at: "2026-09-30T11:30:00.000Z" }, ansB);
    const t = io(cwd);
    expect(runRunsDiff([], { json: true }, t.io)).toBe(0);
    expect(JSON.parse(t.out.join("")).answers).toEqual({ available: false, reason: "missing_answers", missing: ["a"] });
  });

  it("mismatched workflows by explicit id: metadata diff, answers not compared", () => {
    const cwd = seed();
    const other = run({
      run_id: "20260930-120000-dddddd",
      workflow_id: "implement",
      started_at: "2026-09-30T12:00:00Z",
    });
    record(cwd, recA, ansA);
    record(cwd, other, { ...ansB, run_id: other.run_id, workflow_id: "implement" });
    const t = io(cwd);
    expect(runRunsDiff([recA.run_id, other.run_id], {}, t.io)).toBe(0);
    const text = t.out.join("");
    expect(text).toContain("id         triage → implement");
    expect(text.trimEnd().split("\n").pop()).toBe("  answers: not compared (different workflows)");
    const j = io(cwd);
    runRunsDiff([recA.run_id, other.run_id], { json: true }, j.io);
    expect(JSON.parse(j.out.join("")).answers).toEqual({ available: false, reason: "different_workflows" });
  });

  it("renders in color only on a TTY without NO_COLOR", () => {
    const cwd = seed();
    record(cwd, recA, ansA);
    record(cwd, { ...recB, started_at: "2026-09-30T11:30:00.000Z" }, ansB);
    const tty = io(cwd, { isTTY: true });
    runRunsDiff([], {}, tty.io);
    expect(tty.out.join("")).toMatch(/\x1b\[/);
    const nc = io(cwd, { isTTY: true, env: { NO_COLOR: "1" } });
    runRunsDiff([], {}, nc.io);
    expect(nc.out.join("")).not.toMatch(/\x1b\[/);
  });
});
