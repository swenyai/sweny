// #337: token cost. Bounded node context, concurrent judges, and a results
// map that holds one entry per node however long a loop runs.

import { describe, it, expect } from "vitest";
import { execute } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import type { Workflow, Node, NodeResult } from "../types.js";

const SUMMARY = "S".repeat(2000);
const NOTES = "N".repeat(500);
const SCHEMA = {
  type: "object",
  properties: { status: { type: "string" }, count: { type: "number" } },
};

/** A chain n1 -> n2 -> ... -> nN where every node declares SCHEMA. */
function chain(n: number, extra: Partial<Workflow> = {}): Workflow {
  const nodes: Record<string, Node> = {};
  for (let i = 1; i <= n; i++) {
    nodes[`n${i}`] = { name: `N${i}`, instruction: `Step ${i} of the chain.`, skills: [], output: SCHEMA };
  }
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i + 1}`, to: `n${i + 2}` }));
  return { id: "chain", name: "Chain", description: "", entry: "n1", nodes, edges, ...extra };
}

/** Run a chain and return the JSON byte size of the context each node received. */
async function contextBytes(workflow: Workflow): Promise<{ sizes: number[]; last: Record<string, unknown> }> {
  const sizes: number[] = [];
  let last: Record<string, unknown> = {};
  const claude: any = {
    async run(opts: { instruction: string; context: Record<string, unknown> }): Promise<NodeResult> {
      sizes.push(JSON.stringify(opts.context).length);
      last = opts.context;
      const step = Number(/Step (\d+)/.exec(opts.instruction)?.[1]);
      // Every node returns its declared fields plus the prose a real agent adds.
      return { status: "success", data: { summary: SUMMARY, status: "ok", count: step, notes: NOTES }, toolCalls: [] };
    },
    evaluate: async () => null,
    ask: async () => "",
  };
  await execute(workflow, {}, { skills: createSkillMap([]), claude });
  return { sizes, last };
}

const deltas = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("bounded node context (#337)", () => {
  it("a 10-node chain sends schema-shaped priors, not prose: bytes per node grow by a small constant", async () => {
    const bounded = await contextBytes(chain(10));
    const full = await contextBytes(chain(10, { context_mode: "full" }));

    expect(bounded.sizes).toHaveLength(10);
    expect(full.sizes).toHaveLength(10);

    // The last node still sees every prior node, as its declared fields only.
    for (let i = 1; i <= 9; i++) {
      expect(bounded.last[`n${i}`]).toEqual({ status: "ok", count: i, evals: {} });
      expect(full.last[`n${i}`]).toMatchObject({ summary: SUMMARY, notes: NOTES, status: "ok", count: i });
    }

    // Linear with a small slope: each prior node adds the same few dozen bytes.
    const bSteps = deltas(bounded.sizes);
    expect(new Set(bSteps).size).toBe(1);
    expect(bSteps[0]).toBeLessThan(64);
    // Full mode adds every prior node's whole prose to every later prompt.
    for (const d of deltas(full.sizes)) expect(d).toBeGreaterThan(SUMMARY.length + NOTES.length);

    const ratio = sum(bounded.sizes) / sum(full.sizes);
    expect(ratio).toBeLessThan(0.03);
    // Printed so the CI log carries the measured numbers.
    console.log(
      `[#337] 10-node chain context bytes: last node bounded=${bounded.sizes[9]} full=${full.sizes[9]}; ` +
        `whole run bounded=${sum(bounded.sizes)} full=${sum(full.sizes)} (${(ratio * 100).toFixed(2)}%)`,
    );
  });

  it("a node without an output schema keeps its full data, summary included", async () => {
    const wf = chain(3);
    delete wf.nodes.n1.output;
    const { last } = await contextBytes(wf);
    expect(last.n1).toMatchObject({ summary: SUMMARY, notes: NOTES });
    expect(last.n2).toEqual({ status: "ok", count: 2, evals: {} });
  });

  it("requires still reads undeclared fields: the gate sees the full map", async () => {
    const wf = chain(2);
    wf.nodes.n2.requires = { output_required: ["n1.notes"], output_matches: [{ path: "n1.summary", matches: "^S+$" }] };
    const { sizes, last } = await contextBytes(wf);
    expect(sizes).toHaveLength(2);
    expect(last.n1).toEqual({ status: "ok", count: 1, evals: {} });
  });

  it("a fail_soft node keeps its error and fail_soft markers next to the declared fields", async () => {
    const wf = chain(2);
    wf.nodes.n1.fail_soft = true;
    let seen: Record<string, unknown> = {};
    const claude: any = {
      async run(opts: { instruction: string; context: Record<string, unknown> }): Promise<NodeResult> {
        if (opts.instruction.includes("Step 1")) {
          return { status: "failed", data: { summary: SUMMARY, status: "partial", error: "max turns" }, toolCalls: [] };
        }
        seen = opts.context;
        return { status: "success", data: { status: "ok", count: 2 }, toolCalls: [] };
      },
      evaluate: async () => null,
      ask: async () => "",
    };
    await execute(wf, {}, { skills: createSkillMap([]), claude });
    expect(seen.n1).toEqual({ status: "partial", error: "max turns", fail_soft: true, evals: {} });
  });

  it("context_mode: full is accepted by the schema and restores the old map", async () => {
    const { workflowZ } = await import("../schema.js");
    expect(workflowZ.parse({ ...chain(2), context_mode: "full" }).context_mode).toBe("full");
    expect(() => workflowZ.parse({ ...chain(2), context_mode: "everything" })).toThrow();
  });
});

describe("concurrent judges (#337)", () => {
  it("a node's judges are all in flight at once, results keep declaration order, a no still fails the node", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const claude: any = {
      run: async () => ({ status: "success", data: { ok: true }, toolCalls: [] }),
      evaluate: async () => null,
      async ask(opts: { instruction: string }) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield several macrotasks; a serial loop would never overlap calls.
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        inFlight--;
        const verdict = opts.instruction.includes("RUBRIC-B") ? "no" : "yes";
        return `VERDICT: ${verdict}\nREASONING: checked`;
      },
    };
    const wf: Workflow = {
      id: "judges",
      name: "Judges",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          eval: [
            { name: "j1", kind: "judge", rubric: "RUBRIC-A" },
            { name: "j2", kind: "judge", rubric: "RUBRIC-B" },
            { name: "shape", kind: "value", rule: { output_required: ["ok"] } },
            { name: "j3", kind: "judge", rubric: "RUBRIC-C" },
          ],
        },
      },
      edges: [],
    };
    const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude });
    expect(maxInFlight).toBe(3);
    const a = results.get("a")!;
    expect(a.evals!.map((e) => [e.name, e.pass])).toEqual([
      ["j1", true],
      ["j2", false],
      ["shape", true],
      ["j3", true],
    ]);
    expect(a.status).toBe("failed");
  });
});

describe("loop memory (#337)", () => {
  it("a looping workflow keeps one result per node, the latest iteration's; the trace keeps the count", async () => {
    let runs = 0;
    const claude: any = {
      async run(): Promise<NodeResult> {
        runs++;
        const payload = "P".repeat(10_000);
        return {
          status: "success",
          data: { run: runs, payload },
          toolCalls: [{ tool: "fetch", input: { run: runs }, output: payload }],
        };
      },
      evaluate: async () => null,
      ask: async () => "",
    };
    const wf: Workflow = {
      id: "loop",
      name: "Loop",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: { name: "B", instruction: "Do B", skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", max_iterations: 4 },
      ],
    };
    const { results, trace } = await execute(wf, {}, { skills: createSkillMap([]), claude });
    expect(runs).toBe(10);
    expect(results.size).toBe(2);
    expect(results.get("a")!.data.run).toBe(9);
    expect(results.get("a")!.toolCalls).toHaveLength(1);
    expect(results.get("b")!.data.run).toBe(10);
    expect(trace.steps.filter((s) => s.node === "a").map((s) => s.iteration)).toEqual([1, 2, 3, 4, 5]);
  });
});
