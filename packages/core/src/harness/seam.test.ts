import { describe, it, expect, vi } from "vitest";
import { execute } from "../executor.js";
import { evaluateAll } from "../eval/index.js";
import { createSkillMap } from "../skills/index.js";
import { MockHarness, MockClaude } from "../testing.js";
import { claudeCompat } from "./compat.js";
import { buildRunRecord } from "../cli/run-history.js";
import type { Claude, Evaluator, NodeResult, Workflow } from "../types.js";
import type { AgentHarness } from "./types.js";
import { CODEX_CAPABILITIES } from "./capabilities.js";

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

  it("tools.deny entries that name a tool class reach the harness as deny (#331)", async () => {
    const run = vi.fn(async (): Promise<NodeResult> => ({ status: "success", data: {}, toolCalls: [] }));
    const legacy: Claude = { run, evaluate: async () => null, ask: async () => "" };
    const denying = {
      ...wf,
      nodes: { ...wf.nodes, a: { ...wf.nodes.a, tools: { deny: ["write", "github_create_pr", "shell"] } } },
    } as Workflow;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await execute(denying, {}, { skills: createSkillMap([]), harness: claudeCompat(legacy), config: {}, logger });
    expect(run.mock.calls[0][0]).toMatchObject({ deny: ["write", "shell"] });
    expect(run.mock.calls[1][0]).not.toHaveProperty("deny");
    // Class names are not skill-tool typos; the unknown tool name still warns.
    const typos = logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("tools filter"));
    expect(typos).toEqual([expect.stringContaining("'github_create_pr'")]);
  });

  it("logs what a harness could not honor natively, once per node", async () => {
    const run = vi.fn(async (): Promise<NodeResult> => ({
      status: "success",
      data: {},
      toolCalls: [],
      harness: { id: "codex", version: "0.159.2" },
      degraded: ["max_turns: watchdog"],
    }));
    const harness: AgentHarness = {
      id: "codex",
      capabilities: CODEX_CAPABILITIES,
      preflight: async () => ({ ok: true, version: "0.159.2" }),
      run: run as unknown as AgentHarness["run"],
      complete: async () => null,
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await execute(wf, {}, { skills: createSkillMap([]), harness, config: {}, logger });
    const lines = logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("could not honor"));
    expect(lines).toEqual(["  codex could not honor natively: max_turns: watchdog", expect.any(String)]);
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

  it("records what the harness could not honor natively, deduped (#331)", () => {
    const tagged = (degraded: string[]): NodeResult => ({
      status: "success",
      data: {},
      toolCalls: [],
      harness: { id: "codex", version: "0.159.2" },
      degraded,
    });
    const r = record(
      new Map<string, NodeResult>([
        ["a", tagged(["max_turns: watchdog", "egress allowlist: none"])],
        ["b", tagged(["max_turns: watchdog"])],
      ]),
    );
    expect(r.degraded).toEqual(["max_turns: watchdog", "egress allowlist: none"]);
  });

  it("omits the key when no result carries a harness", () => {
    const r = record(new Map<string, NodeResult>([["a", { status: "success", data: {}, toolCalls: [] }]]));
    expect("harness" in r).toBe(false);
  });
});
