import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeResult, Workflow } from "../types.js";
import {
  ANSWER_STRING_MAX,
  RUN_ANSWERS_SCHEMA_VERSION,
  answersRelPath,
  buildRunAnswers,
  compareAnswers,
  formatSinceLast,
  formatSinceLastMarkdown,
  itemIdentity,
  readRunAnswers,
  recordRunAnswers,
  sinceLastRun,
  writeRunAnswers,
  type RunAnswers,
} from "./run-answers.js";
import { RUN_HISTORY_DIR, writeRunRecord, type RunRecord } from "./run-history.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-answers-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const workflow = {
  id: "triage",
  name: "Triage",
  description: "",
  entry: "investigate",
  nodes: {
    investigate: {
      name: "Investigate",
      instruction: "SECRET-PROMPT",
      skills: [],
      output: {
        type: "object",
        properties: {
          findings: { type: "array", items: { type: "object" } },
          novel_count: { type: "number" },
        },
      },
    },
    report: { name: "Report", instruction: "x", skills: [] },
    bare: { name: "Bare", instruction: "x", skills: [] },
  },
  edges: [{ from: "investigate", to: "report" }],
} as unknown as Workflow;

const ok = (data: Record<string, unknown>): NodeResult => ({ status: "success", data, toolCalls: [] });

function answers(nodes: RunAnswers["nodes"], over: Partial<RunAnswers> = {}): RunAnswers {
  return {
    schema_version: RUN_ANSWERS_SCHEMA_VERSION,
    run_id: "20261106-100000-aaaaaa",
    workflow_id: "triage",
    nodes,
    ...over,
  };
}

const idA = { run_id: "20261106-100000-aaaaaa", workflow_id: "triage" };
const idB = { run_id: "20261106-110000-bbbbbb", workflow_id: "triage" };

describe("buildRunAnswers", () => {
  it("keeps only the declared output fields, or a string summary when nothing is declared", () => {
    const results = new Map<string, NodeResult>([
      ["investigate", ok({ findings: [{ title: "x" }], novel_count: 1, scratch: "undeclared", error: "nope" })],
      ["report", ok({ summary: "All clear", other: 1 })],
      ["bare", ok({ nothing: true })],
    ]);
    const a = buildRunAnswers({ runId: "r1", workflow, results });
    expect(a.schema_version).toBe(1);
    expect(a.run_id).toBe("r1");
    expect(a.workflow_id).toBe("triage");
    expect(a.nodes).toEqual({
      investigate: { findings: [{ title: "x" }], novel_count: 1 },
      report: { summary: "All clear" },
    });
  });

  it("skips failed and skipped nodes, so a failed node is never read as 'everything resolved'", () => {
    const results = new Map<string, NodeResult>([
      ["investigate", { status: "failed", data: { findings: [] }, toolCalls: [] }],
      ["report", { status: "skipped", data: { summary: "x" }, toolCalls: [] }],
    ]);
    expect(buildRunAnswers({ runId: "r1", workflow, results }).nodes).toEqual({});
  });

  it("keeps an empty array: 'no findings' is an answer", () => {
    const results = new Map([["investigate", ok({ findings: [] })]]);
    expect(buildRunAnswers({ runId: "r1", workflow, results }).nodes).toEqual({ investigate: { findings: [] } });
  });

  it("redacts secrets before anything is stored, and truncates very long strings", () => {
    const results = new Map([
      [
        "investigate",
        ok({
          findings: [
            { title: "leak of hunter2-secret-value in logs", root_cause: "x".repeat(ANSWER_STRING_MAX + 500) },
            { title: "key", api_key: "abcdefghijkl" },
          ],
        }),
      ],
    ]);
    const a = buildRunAnswers({ runId: "r1", workflow, results, secrets: ["hunter2-secret-value"] });
    const blob = JSON.stringify(a);
    expect(blob).not.toContain("hunter2-secret-value");
    expect(blob).not.toContain("abcdefghijkl");
    expect(blob).not.toContain("SECRET-PROMPT");
    const f = (a.nodes.investigate.findings as Array<Record<string, string>>)[0];
    expect(f.root_cause.length).toBeLessThanOrEqual(ANSWER_STRING_MAX + 1);
    expect(f.root_cause.endsWith("…")).toBe(true);
  });
});

describe("write and read", () => {
  it("round-trips under .sweny/runs/<id>/answers.json with a run-dir .gitignore", () => {
    const cwd = tmp();
    const a = answers({ investigate: { findings: [{ title: "x" }] } });
    expect(writeRunAnswers(a, cwd)).toBe(answersRelPath(a.run_id));
    expect(answersRelPath(a.run_id)).toBe(`.sweny/runs/${a.run_id}/answers.json`);
    expect(fs.readFileSync(path.join(cwd, RUN_HISTORY_DIR, a.run_id, ".gitignore"), "utf8")).toBe("*\n");
    expect(readRunAnswers(a.run_id, cwd)).toEqual(a);
  });

  it("returns null for a missing, corrupt, wrong-version, or wrong-shape file", () => {
    const cwd = tmp();
    expect(readRunAnswers("20261106-100000-aaaaaa", cwd)).toBeNull();
    const dir = path.join(cwd, RUN_HISTORY_DIR, "20261106-100000-aaaaaa");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "answers.json");
    fs.writeFileSync(file, "{not json");
    expect(readRunAnswers("20261106-100000-aaaaaa", cwd)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ ...answers({}), schema_version: 99 }));
    expect(readRunAnswers("20261106-100000-aaaaaa", cwd)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ ...answers({}), nodes: [] }));
    expect(readRunAnswers("20261106-100000-aaaaaa", cwd)).toBeNull();
  });

  it("never throws when it cannot write", () => {
    const file = path.join(tmp(), "a-file");
    fs.writeFileSync(file, "x");
    expect(writeRunAnswers(answers({}), file)).toBeNull();
  });
});

describe("itemIdentity: the explicit rule for 'the same finding'", () => {
  it("uses the first of id, key, fingerprint, title, name; normalized (trim, lowercase, collapsed spaces)", () => {
    expect(itemIdentity({ title: "  Null   Deref in Checkout ", severity: "high" })).toBe("null deref in checkout");
    expect(itemIdentity({ id: "ABC-1", title: "x" })).toBe("abc-1");
    expect(itemIdentity({ key: "k", title: "x" })).toBe("k");
    expect(itemIdentity({ fingerprint: "fp1", name: "n" })).toBe("fp1");
    expect(itemIdentity({ name: "Widget" })).toBe("widget");
    expect(itemIdentity({ id: 42 })).toBe("42");
  });

  it("skips empty or non-scalar identity values", () => {
    expect(itemIdentity({ id: "  ", title: "Real" })).toBe("real");
    expect(itemIdentity({ id: { nested: 1 }, title: "Real" })).toBe("real");
  });

  it("falls back to the whole item's content when no identity field exists, and to the value for scalars", () => {
    const x = itemIdentity({ b: 2, a: 1 });
    expect(x).toBe(itemIdentity({ a: 1, b: 2 }));
    expect(x).not.toBe(itemIdentity({ a: 1, b: 3 }));
    expect(itemIdentity("  Foo  Bar ")).toBe("foo bar");
    expect(itemIdentity(7)).toBe("7");
  });
});

describe("compareAnswers", () => {
  const f = (title: string, severity = "medium", extra: Record<string, unknown> = {}) => ({
    title,
    severity,
    ...extra,
  });

  it("reports added, resolved, changed and unchanged findings", () => {
    const a = answers({
      investigate: { findings: [f("Stale cache key"), f("Null deref in checkout"), f("Slow query", "low")] },
    });
    const b = answers(
      {
        investigate: {
          findings: [f("Race in token refresh", "high"), f("null deref in CHECKOUT", "high"), f("Slow query", "low")],
        },
      },
      idB,
    );
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 1, resolved: 1, changed: 1, unchanged: 1 });
    const e = c.entries[0];
    if (e.kind !== "collection") throw new Error("expected collection");
    expect(e.node).toBe("investigate");
    expect(e.field).toBe("findings");
    expect(e.added.map((i) => i.label)).toEqual(["Race in token refresh"]);
    expect(e.resolved.map((i) => i.label)).toEqual(["Stale cache key"]);
    expect(e.changed.map((i) => i.label)).toEqual(["null deref in CHECKOUT"]);
    expect(e.changed[0].fields).toEqual([
      { field: "severity", before: "medium", after: "high" },
      { field: "title", before: "Null deref in checkout", after: "null deref in CHECKOUT" },
    ]);
    expect(e.unchanged).toBe(1);
  });

  it("marks a field that appears or disappears on a matched finding", () => {
    const a = answers({ investigate: { findings: [f("X", "low", { fix_approach: "patch" })] } });
    const b = answers({ investigate: { findings: [f("X", "low")] } }, idB);
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    const e = c.entries[0];
    if (e.kind !== "collection") throw new Error("expected collection");
    expect(e.changed[0].fields).toEqual([{ field: "fix_approach", before: "patch" }]);
  });

  it("pairs duplicate identities in order, so two same-title findings are not collapsed", () => {
    const a = answers({ investigate: { findings: [f("Dup", "low"), f("Dup", "high")] } });
    const b = answers({ investigate: { findings: [f("Dup", "low")] } }, idB);
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 0, resolved: 1, changed: 0, unchanged: 1 });
  });

  it("treats an item with no identity field as its whole content: any edit is resolved plus added", () => {
    const a = answers({ n: { rows: [{ a: 1 }, { a: 2 }] } });
    const b = answers({ n: { rows: [{ a: 1 }, { a: 3 }] } }, idB);
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 1, resolved: 1, changed: 0, unchanged: 1 });
  });

  it("diffs arrays of plain strings as sets", () => {
    const a = answers({ n: { tags: ["a", "b"] } });
    const b = answers({ n: { tags: ["b", "c"] } }, idB);
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 1, resolved: 1, changed: 0, unchanged: 1 });
  });

  it("an empty list on one side makes every item on the other added or resolved", () => {
    const a = answers({ investigate: { findings: [] } });
    const b = answers({ investigate: { findings: [f("A"), f("B")] } }, idB);
    const fwd = compareAnswers(a, b);
    const back = compareAnswers(b, a);
    if (!fwd.available || !back.available) throw new Error("expected available");
    expect(fwd.counts).toEqual({ added: 2, resolved: 0, changed: 0, unchanged: 0 });
    expect(back.counts).toEqual({ added: 0, resolved: 2, changed: 0, unchanged: 0 });
  });

  it("compares scalar and object fields as values", () => {
    const a = answers({
      investigate: { novel_count: 2, summary: "same", meta: { x: 1, y: [1] } },
      report: { done: true },
    });
    const b = answers(
      {
        investigate: { novel_count: 3, summary: "same", meta: { y: [1], x: 1 }, extra: "new" },
        report: { done: true },
      },
      idB,
    );
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    // novel_count changed, extra added, summary and meta (key order ignored) unchanged, report.done unchanged
    expect(c.counts).toEqual({ added: 1, resolved: 0, changed: 1, unchanged: 3 });
    const byKey = Object.fromEntries(c.entries.map((e) => [`${e.node}.${e.field}`, e]));
    expect(byKey["investigate.novel_count"]).toMatchObject({ kind: "value", status: "changed", before: 2, after: 3 });
    expect(byKey["investigate.extra"]).toMatchObject({ kind: "value", status: "added", after: "new" });
    expect(byKey["investigate.summary"]).toMatchObject({ kind: "value", status: "unchanged" });
  });

  it("a field removed from the newer run is resolved", () => {
    const a = answers({ n: { note: "old" } });
    const b = answers({ n: {} }, idB);
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 0, resolved: 1, changed: 0, unchanged: 0 });
  });

  it("does not compare a node that has answers in only one run (a failed node is not 'all resolved')", () => {
    const a = answers({ investigate: { findings: [f("A")] }, report: { summary: "s" } });
    const b = answers({ investigate: { findings: [f("A")] } }, idB);
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 0, resolved: 0, changed: 0, unchanged: 1 });
    expect(c.not_compared).toEqual([{ node: "report", only_in: "a" }]);
  });

  it("identical answers: zero changes", () => {
    const a = answers({ investigate: { findings: [f("A"), f("B")], novel_count: 2 } });
    const c = compareAnswers(a, answers({ investigate: { findings: [f("A"), f("B")], novel_count: 2 } }, idB));
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 0, resolved: 0, changed: 0, unchanged: 3 });
  });

  it("is unavailable when either run has no recorded answers", () => {
    const a = answers({ n: { x: 1 } });
    expect(compareAnswers(a, null)).toEqual({ available: false, reason: "missing_answers", missing: ["b"] });
    expect(compareAnswers(null, a)).toEqual({ available: false, reason: "missing_answers", missing: ["a"] });
    expect(compareAnswers(null, null)).toEqual({ available: false, reason: "missing_answers", missing: ["a", "b"] });
  });

  it("is unavailable across different workflows", () => {
    const a = answers({ n: { x: 1 } });
    const b = answers({ n: { x: 1 } }, { ...idB, workflow_id: "implement" });
    expect(compareAnswers(a, b)).toEqual({ available: false, reason: "different_workflows" });
  });
});

describe("since last run", () => {
  function rec(runId: string, workflowId: string, startedAt: string): RunRecord {
    return {
      schema_version: 1,
      run_id: runId,
      workflow_id: workflowId,
      workflow_hash: "0".repeat(64),
      started_at: startedAt,
      duration_ms: 1000,
      status: "success",
      nodes: [],
      routes: [],
      totals: { nodes_total: 0, nodes_ok: 0, nodes_skipped: 0, tool_calls: 0, tokens: null, cost_usd: null },
    };
  }
  function seed(cwd: string, runId: string, workflowId: string, startedAt: string, a?: RunAnswers): void {
    writeRunRecord(rec(runId, workflowId, startedAt), cwd);
    if (a) writeRunAnswers(a, cwd);
  }

  it("diffs the run against the previous run of the same workflow, ignoring other workflows", () => {
    const cwd = tmp();
    seed(
      cwd,
      idA.run_id,
      "triage",
      "2026-11-06T10:00:00.000Z",
      answers({ n: { items: [{ title: "A" }, { title: "B" }] } }),
    );
    seed(
      cwd,
      "20261106-103000-cccccc",
      "implement",
      "2026-11-06T10:30:00.000Z",
      answers({ n: { items: [] } }, { run_id: "20261106-103000-cccccc", workflow_id: "implement" }),
    );
    seed(
      cwd,
      idB.run_id,
      "triage",
      "2026-11-06T11:00:00.000Z",
      answers({ n: { items: [{ title: "B" }, { title: "C" }] } }, idB),
    );
    const s = sinceLastRun(idB.run_id, cwd);
    expect(s).toEqual({
      workflow_id: "triage",
      previous_run_id: idA.run_id,
      counts: { added: 1, resolved: 1, changed: 0, unchanged: 1 },
    });
  });

  it("is null for the first run, when the previous run has no answers, or when the run is unknown", () => {
    const cwd = tmp();
    seed(cwd, idA.run_id, "triage", "2026-11-06T10:00:00.000Z", answers({ n: { x: 1 } }));
    expect(sinceLastRun(idA.run_id, cwd)).toBeNull();
    seed(cwd, idB.run_id, "triage", "2026-11-06T11:00:00.000Z");
    expect(sinceLastRun(idB.run_id, cwd)).toBeNull();
    expect(sinceLastRun("20260101-000000-ffffff", cwd)).toBeNull();
  });

  it("recordRunAnswers writes the file and returns the comparison; never throws", () => {
    const cwd = tmp();
    seed(
      cwd,
      idA.run_id,
      "triage",
      "2026-11-06T10:00:00.000Z",
      answers({ investigate: { findings: [{ title: "A" }] } }),
    );
    writeRunRecord(rec(idB.run_id, "triage", "2026-11-06T11:00:00.000Z"), cwd);
    const results = new Map([["investigate", ok({ findings: [{ title: "A" }, { title: "B" }] })]]);
    const s = recordRunAnswers({ runId: idB.run_id, workflow, results }, cwd);
    expect(s?.counts).toEqual({ added: 1, resolved: 0, changed: 0, unchanged: 1 });
    expect(fs.existsSync(path.join(cwd, RUN_HISTORY_DIR, idB.run_id, "answers.json"))).toBe(true);
    expect(
      recordRunAnswers({ runId: "x", workflow, results: null as unknown as Map<string, NodeResult> }, cwd),
    ).toBeNull();
  });

  const base = { workflow_id: "triage", previous_run_id: idA.run_id };

  it("formats the line from the nonzero counts, and says so when nothing moved", () => {
    expect(formatSinceLast({ ...base, counts: { added: 2, resolved: 1, changed: 0, unchanged: 4 } })).toBe(
      "since last run: 2 added, 1 resolved (sweny runs diff --workflow triage)",
    );
    expect(formatSinceLast({ ...base, counts: { added: 0, resolved: 0, changed: 3, unchanged: 4 } })).toBe(
      "since last run: 3 changed (sweny runs diff --workflow triage)",
    );
    expect(formatSinceLast({ ...base, counts: { added: 0, resolved: 0, changed: 0, unchanged: 4 } })).toBe(
      "since last run: no changes (sweny runs diff --workflow triage)",
    );
  });

  it("markdown form wraps the command in backticks; a workflow id with a quote stays shell-safe", () => {
    const md = formatSinceLastMarkdown({ ...base, counts: { added: 2, resolved: 1, changed: 0, unchanged: 0 } });
    expect(md).toBe("Since last run: 2 added, 1 resolved. Compare: `sweny runs diff --workflow triage`");
    const odd = formatSinceLastMarkdown({
      ...base,
      workflow_id: "a b'c",
      counts: { added: 1, resolved: 0, changed: 0, unchanged: 0 },
    });
    expect(odd).toContain("--workflow 'a b'\\''c'");
  });
});
