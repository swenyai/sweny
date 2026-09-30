import { describe, it, expect, vi } from "vitest";
import { execute } from "../executor.js";
import { evaluateAll } from "../eval/index.js";
import { createSkillMap } from "../skills/index.js";
import { MockHarness, MockClaude } from "../testing.js";
import { claudeCompat } from "./compat.js";
import { buildRunRecord } from "../cli/run-history.js";
import type { Claude, Evaluator, NodeResult, Workflow } from "../types.js";

const wf: Workflow = {
  id: "seam",
  name: "Seam",
  description: "t",
  entry: "a",
  nodes: {
    a: { name: "A", instruction: "Do A", skills: [] },
    b: { name: "B", instruction: "Do B", skills: [] },
  },
  edges: [{ from: "a", to: "b" }],
} as Workflow;

const responses = { a: { data: { x: 1 } }, b: { data: { y: 2 } } };

describe("execute() seam (#330)", () => {
  it("runs over options.harness and tags every node result", async () => {
    const harness = new MockHarness({ responses, workflow: wf });
    const { results } = await execute(wf, {}, { skills: createSkillMap([]), harness, config: {} });
    expect([...results.keys()]).toEqual(["a", "b"]);
    for (const r of results.values()) {
      expect(r.harness).toEqual({ id: "mock", version: "mock" });
      expect(r.degraded).toEqual([]);
    }
    expect(results.get("a")!.data).toMatchObject({ x: 1 });
  });

  it("still runs over the deprecated options.claude", async () => {
    const claude = new MockClaude({ responses, workflow: wf });
    const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {} });
    expect([...results.keys()]).toEqual(["a", "b"]);
  });

  it("accepts a legacy Claude object wrapped by claudeCompat() as options.harness", async () => {
    const legacy: Claude = {
      run: vi.fn(async (): Promise<NodeResult> => ({ status: "success", data: {}, toolCalls: [] })),
      evaluate: async () => null,
      ask: async () => "",
    };
    const { results } = await execute(
      wf,
      {},
      { skills: createSkillMap([]), harness: claudeCompat(legacy), config: {} },
    );
    expect([...results.keys()]).toEqual(["a", "b"]);
    expect(legacy.run).toHaveBeenCalledTimes(2);
  });

  it("a harness that scripts its own evaluate keeps it (routing through options.harness)", async () => {
    const branching: Workflow = {
      ...wf,
      nodes: { ...wf.nodes, c: { name: "C", instruction: "Do C", skills: [] } },
      edges: [
        { from: "a", to: "b", when: "go b" },
        { from: "a", to: "c", when: "go c" },
      ],
    } as Workflow;
    const harness = new MockHarness({
      responses: { a: { data: {} }, c: { data: {} } },
      routes: { a: "c" },
      workflow: branching,
    });
    const { results } = await execute(branching, {}, { skills: createSkillMap([]), harness, config: {} });
    expect([...results.keys()]).toEqual(["a", "c"]);
  });

  it("rejects when neither harness nor claude is given", async () => {
    await expect(execute(wf, {}, { skills: createSkillMap([]), config: {} })).rejects.toThrow(/needs options\.harness/);
  });
});

describe("judge default model comes from the harness (#330)", () => {
  const judge: Evaluator = { name: "j", kind: "judge", rubric: "ok?", pass_when: "yes" };
  const result: NodeResult = { status: "success", data: {}, toolCalls: [] };

  function claudeWith(defaultJudgeModel?: string) {
    const ask = vi.fn(async () => "VERDICT: yes\nREASONING: fine");
    const claude: Claude = {
      defaultJudgeModel,
      run: async () => result,
      evaluate: async () => null,
      ask,
    };
    return { claude, ask };
  }

  it("uses the harness default when nothing else names a model", async () => {
    const { claude, ask } = claudeWith("harness-judge");
    await evaluateAll([judge], result, { claude });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ model: "harness-judge" }));
  });

  it("an evaluator model still wins", async () => {
    const { claude, ask } = claudeWith("harness-judge");
    await evaluateAll([{ ...judge, model: "explicit" }], result, { claude });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ model: "explicit" }));
  });

  it("falls back to claude-haiku-4-5 for a harness that declares none", async () => {
    const { claude, ask } = claudeWith(undefined);
    await evaluateAll([judge], result, { claude });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-4-5" }));
  });
});

describe("run history records the harness (#330)", () => {
  const record = (results: Map<string, NodeResult>) =>
    buildRunRecord({
      runId: "20260930-101500-abc123",
      workflow: wf,
      startedAtMs: Date.UTC(2026, 8, 30, 10, 15),
      durationMs: 10,
      results,
    } as Parameters<typeof buildRunRecord>[0]);

  it("adds harness {id, version} when a result carries it", () => {
    const r = record(
      new Map<string, NodeResult>([
        [
          "a",
          {
            status: "success",
            data: {},
            toolCalls: [],
            harness: { id: "claude-code", version: "0.3.220" },
            degraded: [],
          },
        ],
      ]),
    );
    expect(r.harness).toEqual({ id: "claude-code", version: "0.3.220" });
  });

  it("omits the key when no result carries a harness", () => {
    const r = record(new Map<string, NodeResult>([["a", { status: "success", data: {}, toolCalls: [] }]]));
    expect("harness" in r).toBe(false);
  });
});
