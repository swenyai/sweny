import { describe, expect, it } from "vitest";
import { formatAge, formatRunDiff, formatRunsTable, pickRunsForDiff } from "./runs.js";
import type { RunRecord } from "./run-history.js";

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
    // chalk may be disabled in non-TTY test env; if enabled it must wrap the status only
    if (/\x1b\[/.test(out)) expect(out).toMatch(/\x1b\[\d+m.*success/);
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
    expect(pickRunsForDiff([], [])).toEqual({ error: "No runs recorded yet." });
  });
});
