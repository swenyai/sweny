import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeResult } from "../types.js";
import { buildRunAnswers, writeRunAnswers, type RunAnswers } from "./run-answers.js";
import { buildRunRecord, writeRunRecord, type RunRecord } from "./run-history.js";
import { buildTryFixture, captureTryFixture, resolveCaptureRun, serializeTryFixture } from "./try-capture.js";
import { loadTryWorkflow, parseTryFixture, runTry } from "./try.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-capture-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const RUN_ID = "20261112-140000-abc123";
const workflow = loadTryWorkflow("explain-repo");
const KEY = () => Buffer.alloc(32, 7);

const answer = {
  purpose: "A workflow engine for agents.",
  how_to_run: ["npm ci", "npm run build"],
  key_files: ["packages/core/src/executor.ts: the DAG executor"],
  risks: ["none worth naming"],
};

function results(): Map<string, NodeResult> {
  return new Map<string, NodeResult>([
    [
      "survey",
      {
        status: "success",
        data: { summary: "SECRET-SURVEY-TEXT" },
        toolCalls: [
          { tool: "Glob", input: { pattern: "SECRET-INPUT" } },
          { tool: "Read", input: {} },
          { tool: "Read", input: {} },
        ],
        usage: { inputTokens: 20000, outputTokens: 1000, costUsd: 0.08, numTurns: 6 },
        harness: { id: "claude-code", version: "2.1.0" },
        policy: { envScope: true, sandbox: "strict", sandboxStarted: true },
        degraded: [],
      },
    ],
    [
      "explain",
      {
        status: "success",
        data: { ...answer },
        toolCalls: [],
        usage: { inputTokens: 6000, outputTokens: 700, costUsd: 0.04, numTurns: 1 },
        harness: { id: "claude-code", version: "2.1.0" },
        policy: { envScope: true, sandbox: "strict", sandboxStarted: true },
        degraded: [],
      },
    ],
  ]);
}

function run(): { record: RunRecord; answers: RunAnswers } {
  const r = results();
  return {
    record: buildRunRecord({
      runId: RUN_ID,
      workflow,
      startedAtMs: Date.parse("2026-11-12T14:00:00Z"),
      durationMs: 31_000,
      results: r,
      nodeDurations: new Map([
        ["survey", 19_000],
        ["explain", 12_000],
      ]),
    }),
    answers: buildRunAnswers({ runId: RUN_ID, workflow, results: r, macKey: KEY }),
  };
}

describe("buildTryFixture", () => {
  it("converts a recorded run: real, dated, with counts, usage, policy and the answer", () => {
    const { record, answers } = run();
    const f = buildTryFixture(record, answers, { sampleRepo: "swenyai/sweny" });
    expect(f.schema_version).toBe(1);
    expect(f.illustrative).toBe(false);
    expect(f.captured_at).toBe("2026-11-12T14:00:00.000Z");
    expect(f.workflow).toBe("explain-repo");
    expect(f.sample_repo).toBe("swenyai/sweny");
    expect(f.harness).toEqual({ id: "claude-code", version: "2.1.0" });
    expect(f.policy).toEqual({ envScope: true, sandbox: "strict", sandboxStarted: true });
    expect(Object.keys(f.nodes)).toEqual(["survey", "explain"]);
    expect(f.nodes.survey).toEqual({
      duration_ms: 19_000,
      tool_calls: { Glob: 1, Read: 2 },
      usage: { inputTokens: 20000, outputTokens: 1000, costUsd: 0.08, numTurns: 6 },
    });
    expect(f.nodes.explain.tool_calls).toEqual({});
    expect(f.nodes.explain.output).toEqual(answer);
    expect(f.notice).not.toMatch(/illustrative/i);
    // it round-trips through the same validator `sweny try` loads with
    expect(parseTryFixture(JSON.parse(serializeTryFixture(f)))).toEqual(f);
  });

  it("carries no prompt, tool input, or undeclared node data", () => {
    const { record, answers } = run();
    const text = serializeTryFixture(buildTryFixture(record, answers, { sampleRepo: "swenyai/sweny" }));
    expect(text).not.toContain("SECRET");
  });

  it("redacts the answer again: token shapes and the run's own secret values", () => {
    const token = "ghp_" + "a".repeat(36);
    const { record, answers } = run();
    // answers.json was already redacted when written; plant raw values to prove the second pass runs here.
    const planted: RunAnswers = {
      ...answers,
      nodes: {
        ...answers.nodes,
        explain: { ...answers.nodes.explain, purpose: `Uses ${token} and hunter2-long-secret` },
      },
    };
    const text = serializeTryFixture(
      buildTryFixture(record, planted, { sampleRepo: "swenyai/sweny", secrets: ["hunter2-long-secret"] }),
    );
    expect(text).not.toContain(token);
    expect(text).not.toContain("hunter2-long-secret");
    expect(text).toContain("[redacted]");
  });

  it("is deterministic: the same run gives the same bytes, in a fixed key order", () => {
    const a = serializeTryFixture(buildTryFixture(run().record, run().answers, { sampleRepo: "swenyai/sweny" }));
    const b = serializeTryFixture(buildTryFixture(run().record, run().answers, { sampleRepo: "swenyai/sweny" }));
    expect(a).toBe(b);
    expect(a.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(a))).toEqual([
      "schema_version",
      "illustrative",
      "captured_at",
      "notice",
      "workflow",
      "sample_repo",
      "harness",
      "policy",
      "nodes",
    ]);
  });

  it("refuses a run it cannot honestly capture, naming why", () => {
    const { record, answers } = run();
    const opts = { sampleRepo: "swenyai/sweny" };
    expect(() => buildTryFixture({ ...record, status: "failed" }, answers, opts)).toThrow(/ended failed/);
    const old = { ...record };
    delete old.detail_version;
    expect(() => buildTryFixture(old, answers, opts)).toThrow(/predates per-tool call counts/);
    expect(() => buildTryFixture({ ...record, harness: undefined }, answers, opts)).toThrow(/no harness/);
    expect(() => buildTryFixture({ ...record, policy: undefined }, answers, opts)).toThrow(/no policy/);
    expect(() => buildTryFixture(record, null, opts)).toThrow(/no answers/);
    expect(() => buildTryFixture(record, { ...answers, run_id: "20260101-000000-ffffff" }, opts)).toThrow(
      /different run/,
    );
    expect(() => buildTryFixture(record, { ...answers, nodes: {} }, opts)).toThrow(/no node recorded an answer/);
    expect(() => buildTryFixture(record, answers, { sampleRepo: "nope" })).toThrow(/owner\/name/);
    expect(() => buildTryFixture({ ...record, workflow_id: "pr-risk-review" }, answers, opts)).toThrow();
    const extra = { ...record, nodes: [...record.nodes, { ...record.nodes[0], id: "ghost" }] };
    expect(() => buildTryFixture(extra, answers, opts)).toThrow(/"ghost" is not in the explain-repo template/);
  });
});

describe("resolveCaptureRun", () => {
  function seed(): string {
    const cwd = tmp();
    const { record, answers } = run();
    writeRunRecord(record, cwd);
    writeRunAnswers(answers, cwd);
    return cwd;
  }

  it("finds the run by latest, id, prefix, run dir path and record path", () => {
    const cwd = seed();
    for (const ref of [
      "latest",
      RUN_ID,
      path.join(cwd, ".sweny", "runs", RUN_ID),
      path.join(cwd, ".sweny", "runs", `${RUN_ID}.json`),
      path.join(".sweny", "runs", RUN_ID),
    ]) {
      const got = resolveCaptureRun(ref, cwd);
      expect(got.record.run_id).toBe(RUN_ID);
      expect(got.answers?.run_id).toBe(RUN_ID);
    }
    expect(resolveCaptureRun("20261112-1400", cwd).record.run_id).toBe(RUN_ID);
  });

  it("says so when there is no such run", () => {
    expect(() => resolveCaptureRun("latest", tmp())).toThrow(/no run "latest".*no runs recorded/);
    expect(() => resolveCaptureRun("20200101-000000-aaaaaa", seed())).toThrow(/no run/);
  });
});

describe("captureTryFixture", () => {
  it("writes the fixture file, repo from --repo or GITHUB_REPOSITORY", () => {
    const cwd = tmp();
    const { record, answers } = run();
    writeRunRecord(record, cwd);
    writeRunAnswers(answers, cwd);
    const a = captureTryFixture({ ref: "latest", repo: "swenyai/sweny", out: "out/try-fixture.json", cwd, env: {} });
    expect(a.wrote).toBe(path.join(cwd, "out", "try-fixture.json"));
    expect(fs.readFileSync(a.wrote!, "utf-8")).toBe(a.text);
    const b = captureTryFixture({ ref: "latest", cwd, env: { GITHUB_REPOSITORY: "swenyai/sweny" } });
    expect(b.text).toBe(a.text);
    expect(b.wrote).toBeUndefined();
    expect(() => captureTryFixture({ ref: "latest", cwd, env: {} })).toThrow(/--repo/);
  });
});

describe("a captured run replays", () => {
  it("through sweny try: labelled a replay of a real run on its date, with the recorded receipt", async () => {
    const { record, answers } = run();
    const fixture = buildTryFixture(record, answers, { sampleRepo: "swenyai/sweny" });
    let out = "";
    const code = await runTry({ fast: true, tty: false, unicode: true, fixture, write: (s) => (out += s) });
    expect(code).toBe(0);
    expect(out).toContain("a replay of a real run on 2026-11-12");
    expect(out).toContain("explain-repo on swenyai/sweny");
    expect(out).not.toContain("illustrative");
    expect(out).toContain("A workflow engine for agents.");
    expect(out).toContain("2/2 nodes · 3 tool calls · 31s · 28k tokens · $0.12");
  });
});
