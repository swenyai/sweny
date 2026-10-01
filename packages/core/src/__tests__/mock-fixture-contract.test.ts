import { describe, expect, it, vi } from "vitest";
import { execute } from "../executor.js";
import { MockHarness, MockClaude } from "../testing.js";
import type { Tool, Workflow } from "../types.js";

const workflow = (): Workflow => ({
  id: "fixture-contract",
  name: "Fixture contract",
  description: "",
  entry: "left",
  nodes: {
    left: { name: "Left", instruction: "Inspect the repository", skills: [] },
    right: { name: "Right", instruction: "Inspect the repository", skills: [] },
  },
  edges: [{ from: "left", to: "right" }],
});

describe("public mock fixture contract", () => {
  it("uses executor node identity when two nodes have the same instruction", async () => {
    const graph = workflow();
    const harness = new MockHarness({
      workflow: graph,
      responses: { right: { data: { owner: "right" } }, left: { data: { owner: "left" } } },
    });
    const run = await execute(graph, {}, { harness, skills: new Map(), env: {}, offline: true });
    expect(harness.executedNodes).toEqual(["left", "right"]);
    expect(run.results.get("left")?.data.owner).toBe("left");
    expect(run.results.get("right")?.data.owner).toBe("right");
  });

  it("keeps identity after rules wrap the instruction and routes skip a node", async () => {
    const graph = workflow();
    graph.rules = ["Use only the supplied evidence."];
    graph.nodes.skip = { name: "Skip", instruction: "Unused branch", skills: [] };
    graph.edges = [
      { from: "left", to: "right", when: "continue" },
      { from: "left", to: "skip", when: "skip" },
    ];
    const harness = new MockHarness({
      workflow: graph,
      routes: { left: "right" },
      responses: {
        skip: { data: { owner: "skip" } },
        right: { data: { owner: "right" } },
        left: { data: { owner: "left" } },
      },
    });
    const run = await execute(graph, {}, { harness, skills: new Map(), env: {}, offline: true });
    expect(harness.executedNodes).toEqual(["left", "right"]);
    expect(run.results.has("skip")).toBe(false);
    expect(run.results.get("right")?.data.owner).toBe("right");
  });

  it("reuses the same node fixture when evaluation retries decorate its prompt", async () => {
    const graph = workflow();
    graph.rules = ["Use evidence."];
    graph.nodes.left.eval = [{ name: "shape", kind: "value", rule: { output_required: ["done"] } }];
    graph.nodes.left.retry = { max: 1 };
    const harness = new MockHarness({
      workflow: graph,
      responses: { left: { data: {} }, right: { data: { done: true } } },
    });
    const run = await execute(graph, {}, { harness, skills: new Map(), env: {}, offline: true });
    expect(harness.executedNodes).toEqual(["left", "left"]);
    expect(run.results.get("left")?.status).toBe("failed");
    expect(run.results.has("right")).toBe(false);
  });

  it("strict missing fixtures cannot borrow a later response or be softened", async () => {
    const graph = workflow();
    graph.nodes.left.fail_soft = true;
    const options = { strict: true, workflow: graph, responses: { right: { data: { ok: true } } } };
    const harness = new MockHarness(options);
    const run = await execute(graph, {}, { harness, skills: new Map(), env: {}, offline: true });
    const result = run.results.get("left")!;
    expect(result.status).toBe("failed");
    expect(result.data).toMatchObject({ refused: true, error: expect.stringContaining("left") });
    expect(run.results.has("right")).toBe(false);
  });

  it("strict manual calls reject ambiguous instructions instead of guessing", async () => {
    const options = {
      strict: true,
      workflow: workflow(),
      responses: { left: { data: {} }, right: { data: {} } },
    };
    const result = await new MockHarness(options).run({
      instruction: "Inspect the repository",
      context: {},
      tools: [],
    });
    expect(result.status).toBe("failed");
    expect(result.data.error).toMatch(/ambiguous.*nodeId/i);
  });

  it("strict tool preflight rejects the whole fixture before calling a real handler", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const tool: Tool = { name: "write", description: "Write", input_schema: { type: "object" }, handler };
    const options = {
      strict: true,
      workflow: workflow(),
      responses: {
        left: {
          toolCalls: [
            { tool: "write", input: {} },
            { tool: "missing", input: {} },
          ],
        },
      },
    };
    const request = { nodeId: "left", instruction: "wrapped instruction", context: {}, tools: [tool] };
    const result = await new MockHarness(options).run(request);
    expect(result.status).toBe("failed");
    expect(result.data.error).toMatch(/left.*missing/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it("retains legacy sequential manual calls and the MockClaude alias", async () => {
    expect(MockClaude).toBe(MockHarness);
    const harness = new MockClaude({ responses: { first: { data: { value: 1 } } } });
    expect((await harness.run({ instruction: "unrelated", context: {}, tools: [] })).data.value).toBe(1);
    expect((await harness.run({ instruction: "unrelated", context: {}, tools: [] })).status).toBe("success");
  });

  it("strict unique manual matching still executes valid supplied handlers", async () => {
    const graph = workflow();
    graph.nodes.right.instruction = "Summarize the result";
    const handler = vi.fn(async () => ({ count: 3 }));
    const harness = new MockHarness({
      strict: true,
      workflow: graph,
      responses: { left: { toolCalls: [{ tool: "read", input: { path: "fixture" } }], data: { ok: true } } },
    });
    const result = await harness.run({
      instruction: "Inspect the repository",
      context: {},
      tools: [{ name: "read", description: "Read fixture", input_schema: { type: "object" }, handler }],
    });
    expect(result.status).toBe("success");
    expect(handler).toHaveBeenCalledOnce();
    expect(result.toolCalls).toEqual([{ tool: "read", input: { path: "fixture" }, output: { count: 3 } }]);
  });

  it("strict explicit identity does not borrow a fixture named in the instruction", async () => {
    const harness = new MockHarness({ strict: true, responses: { right: { data: { ok: true } } } });
    const result = await harness.run({ nodeId: "left", instruction: "right", context: {}, tools: [] });
    expect(result.status).toBe("failed");
    expect(result.data.error).toContain('node "left"');
    expect(harness.executedNodes).toEqual(["left"]);
  });

  it("inherited object properties are not scripted responses", async () => {
    const harness = new MockHarness({ strict: true, responses: {} });
    const result = await harness.run({ nodeId: "constructor", instruction: "Inspect", context: {}, tools: [] });
    expect(result.status).toBe("failed");
    expect(result.data.error).toContain('node "constructor"');
  });
});
