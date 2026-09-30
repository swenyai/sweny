import { describe, it, expect } from "vitest";

import { execute } from "../executor.js";
import { parseWorkflow, validateWorkflow, workflowJsonSchema } from "../schema.js";
import type { Workflow } from "../types.js";
import { MockClaude } from "../testing.js";
import { createSkillMap } from "../skills/index.js";

function node(name = "N") {
  return { name, instruction: `Do ${name}`, skills: [] as string[] };
}

function wf(partial: Partial<Workflow> & Pick<Workflow, "entry" | "nodes" | "edges">): Workflow {
  return { id: "t", name: "T", description: "t", ...partial } as Workflow;
}

function runWith(w: Workflow, claude = new MockClaude({ responses: {} })) {
  return execute(w, {}, { skills: createSkillMap([]), claude, config: {} });
}

function chain(n: number): { nodes: Workflow["nodes"]; edges: Workflow["edges"] } {
  const nodes: Workflow["nodes"] = {};
  const edges: Workflow["edges"] = [];
  for (let i = 0; i < n; i++) {
    nodes[`n${i}`] = node(`N${i}`);
    if (i > 0) edges.push({ from: `n${i - 1}`, to: `n${i}` });
  }
  return { nodes, edges };
}

// ─── #325: edge max_iterations ceiling ──────────────────────────

describe("#325 edge max_iterations upper bound", () => {
  const base = (max: number): Workflow =>
    wf({
      entry: "a",
      nodes: { a: node("A"), b: node("B") },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", when: "again", max_iterations: max },
      ],
    });

  it("zod rejects an absurd max_iterations", () => {
    expect(() => parseWorkflow(base(100000))).toThrow(/max_iterations/);
  });

  it("zod accepts a sane max_iterations", () => {
    expect(() => parseWorkflow(base(5))).not.toThrow();
  });

  it("published JSON schema carries a maximum", () => {
    const prop = (workflowJsonSchema as any).properties.edges.items.properties.max_iterations;
    expect(prop.maximum).toBeGreaterThan(1);
    expect(prop.maximum).toBeLessThanOrEqual(1000);
  });

  it("validateWorkflow (raw, no zod: batch runner + library path) rejects it", () => {
    expect(validateWorkflow(base(100000)).map((e) => e.code)).toContain("EDGE_ITERATIONS_EXCEEDED");
  });

  it("validateWorkflow rejects an absurd retry.max on raw workflows", () => {
    const w = wf({ entry: "a", nodes: { a: { ...node("A"), retry: { max: 100000 } } }, edges: [] });
    expect(validateWorkflow(w).map((e) => e.code)).toContain("RETRY_MAX_EXCEEDED");
  });
});

// ─── #326: library execute() path validates structurally ─────────

describe("#326 execute() runs structural validation before any node", () => {
  it("rejects an unreachable node before running anything", async () => {
    const claude = new MockClaude({ responses: {} });
    const w = wf({ entry: "a", nodes: { a: node("A"), orphan: node("O") }, edges: [] });
    await expect(runWith(w, claude)).rejects.toThrow(/UNREACHABLE_NODE/);
    expect(claude.executedNodes).toHaveLength(0);
  });

  it("rejects an unbounded cycle before running anything", async () => {
    const claude = new MockClaude({ responses: {} });
    const w = wf({
      entry: "a",
      nodes: { a: node("A"), b: node("B"), c: node("C") },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c", when: "x" },
        { from: "c", to: "b", when: "y" },
      ],
    });
    await expect(runWith(w, claude)).rejects.toThrow(/UNBOUNDED_CYCLE/);
    expect(claude.executedNodes).toHaveLength(0);
  });

  it("rejects ambiguous edges", async () => {
    const w = wf({
      entry: "a",
      nodes: { a: node("A"), b: node("B"), c: node("C") },
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ],
    });
    await expect(runWith(w)).rejects.toThrow(/AMBIGUOUS_EDGES/);
  });

  it("reports every structural problem in one error", async () => {
    const w = wf({
      entry: "a",
      nodes: { a: node("A"), b: node("B"), orphan: node("O") },
      edges: [
        { from: "a", to: "a" },
        { from: "a", to: "b" },
      ],
    });
    const err = await runWith(w).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/SELF_LOOP/);
    expect(err!.message).toMatch(/AMBIGUOUS_EDGES/);
    expect(err!.message).toMatch(/UNREACHABLE_NODE/);
  });

  it("an absurd retry.max is rejected on the library path too", async () => {
    const w = wf({ entry: "a", nodes: { a: { ...node("A"), retry: { max: 100000 } } }, edges: [] });
    await expect(runWith(w)).rejects.toThrow(/RETRY_MAX_EXCEEDED/);
  });

  it("a valid workflow still runs", async () => {
    const claude = new MockClaude({ responses: { a: { data: {} } } });
    const w = wf({ entry: "a", nodes: { a: node("A") }, edges: [] });
    const { results } = await runWith(w, claude);
    expect(results.get("a")?.status).toBe("success");
  });

  it("validates once per execute call, not per step", async () => {
    const claude = new MockClaude({ responses: { a: { data: {} } } });
    const w = wf({
      entry: "a",
      nodes: { a: node("A") },
      edges: [{ from: "a", to: "a", max_iterations: 100 }],
    });
    const t0 = Date.now();
    await runWith(w, claude);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

// ─── #326: validateWorkflow accumulates + survives deep graphs ───

describe("#326 validateWorkflow", () => {
  it("reports multiple structural errors in one call (no early return)", () => {
    const w = wf({
      entry: "a",
      nodes: { a: node("A"), b: node("B"), orphan: node("O") },
      edges: [
        { from: "a", to: "a" },
        { from: "a", to: "b" },
      ],
    });
    const codes = validateWorkflow(w).map((e) => e.code);
    expect(codes).toContain("SELF_LOOP");
    expect(codes).toContain("AMBIGUOUS_EDGES");
    expect(codes).toContain("UNREACHABLE_NODE");
  });

  it("reports unsupported eval policy alongside a structural error", () => {
    const w = wf({
      entry: "a",
      nodes: { a: { ...node("A"), eval_policy: "any_pass" } as any, orphan: node("O") },
      edges: [],
    });
    const codes = validateWorkflow(w).map((e) => e.code);
    expect(codes).toContain("UNREACHABLE_NODE");
    expect(codes).toContain("UNSUPPORTED_EVAL_POLICY");
  });

  it("does not flood UNREACHABLE_NODE when the entry itself is missing", () => {
    const w = wf({ entry: "nope", nodes: { a: node("A"), b: node("B") }, edges: [] });
    expect(validateWorkflow(w).map((e) => e.code)).toEqual(["MISSING_ENTRY"]);
  });

  it("a very deep chain ending in an unbounded cycle yields a clean error, not a stack overflow", () => {
    const N = 50_000;
    const { nodes, edges } = chain(N);
    edges.push({ from: `n${N - 1}`, to: "n0" });
    let errors: ReturnType<typeof validateWorkflow> = [];
    expect(() => {
      errors = validateWorkflow(wf({ entry: "n0", nodes, edges }));
    }).not.toThrow();
    expect(errors.map((e) => e.code)).toContain("UNBOUNDED_CYCLE");
  });

  it("a very deep acyclic chain validates clean and fast", () => {
    const { nodes, edges } = chain(50_000);
    const t0 = Date.now();
    expect(validateWorkflow(wf({ entry: "n0", nodes, edges }))).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
