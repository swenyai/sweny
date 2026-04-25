import { describe, expect, it } from "vitest";
import { aggregateEval, evaluateAll } from "../eval/index.js";
import type { Evaluator, NodeResult, ToolCall } from "../types.js";

const tc = (tool: string, output?: unknown): ToolCall => ({ tool, input: {}, output });

const result = (data: Record<string, unknown>, toolCalls: ToolCall[] = []): NodeResult => ({
  status: "success",
  data,
  toolCalls,
});

describe("evaluateAll", () => {
  it("returns an empty list when evaluators is undefined", async () => {
    const out = await evaluateAll(undefined, result({}));
    expect(out).toEqual([]);
  });

  it("returns an empty list when evaluators is empty", async () => {
    const out = await evaluateAll([], result({}));
    expect(out).toEqual([]);
  });

  it("runs a passing value evaluator and reports pass:true", async () => {
    const evaluators: Evaluator[] = [{ name: "shape", kind: "value", rule: { output_required: ["a"] } }];
    const out = await evaluateAll(evaluators, result({ a: 1 }));
    expect(out).toEqual([{ name: "shape", kind: "value", pass: true, reasoning: undefined }]);
  });

  it("runs a passing function evaluator and reports pass:true", async () => {
    const evaluators: Evaluator[] = [{ name: "called", kind: "function", rule: { all_tools_called: ["a"] } }];
    const out = await evaluateAll(evaluators, result({}, [tc("a", { ok: true })]));
    expect(out).toEqual([{ name: "called", kind: "function", pass: true, reasoning: undefined }]);
  });

  it("runs a failing value evaluator and reports reasoning", async () => {
    const evaluators: Evaluator[] = [{ name: "shape", kind: "value", rule: { output_required: ["missing"] } }];
    const out = await evaluateAll(evaluators, result({}));
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("shape");
    expect(out[0]!.pass).toBe(false);
    expect(out[0]!.reasoning).toMatch(/output_required.*'missing'/);
  });

  it("preserves declaration order across mixed kinds", async () => {
    const evaluators: Evaluator[] = [
      { name: "first", kind: "function", rule: { any_tool_called: ["a"] } },
      { name: "second", kind: "value", rule: { output_required: ["x"] } },
      { name: "third", kind: "function", rule: { no_tool_called: ["nope"] } },
    ];
    const out = await evaluateAll(evaluators, result({ x: 1 }, [tc("a", { ok: true })]));
    expect(out.map((r) => r.name)).toEqual(["first", "second", "third"]);
    expect(out.every((r) => r.pass)).toBe(true);
  });

  it("caps reasoning at ~500 characters with an ellipsis", async () => {
    const longTooName = "x".repeat(2000);
    const evaluators: Evaluator[] = [{ name: "long", kind: "function", rule: { any_tool_called: [longTooName] } }];
    const out = await evaluateAll(evaluators, result({}, []));
    expect(out[0]!.pass).toBe(false);
    expect(out[0]!.reasoning).toBeDefined();
    expect(out[0]!.reasoning!.length).toBeLessThanOrEqual(500);
    expect(out[0]!.reasoning!.endsWith("…")).toBe(true);
  });

  it("dispatches a judge evaluator and surfaces its verdict + reasoning", async () => {
    const evaluators: Evaluator[] = [
      { name: "judged", kind: "judge", rubric: "would this be good?", pass_when: "yes" },
    ];
    const fakeClaude = {
      run: async () => ({ status: "success" as const, data: {}, toolCalls: [] }),
      evaluate: async () => "yes",
      ask: async () => "VERDICT: yes\nREASONING: looks fine",
    };
    const out = await evaluateAll(evaluators, result({}), { claude: fakeClaude });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("judge");
    expect(out[0]!.pass).toBe(true);
    expect(out[0]!.reasoning).toBe("looks fine");
  });

  it("throws when a judge evaluator is encountered without a Claude client", async () => {
    const evaluators: Evaluator[] = [{ name: "judged", kind: "judge", rubric: "would this be good?" }];
    await expect(evaluateAll(evaluators, result({}))).rejects.toThrow(/no Claude client was provided/);
  });
});

describe("aggregateEval (policy: all_pass)", () => {
  it("returns pass:true when results is empty", () => {
    expect(aggregateEval([])).toEqual({ pass: true, failures: [] });
  });

  it("returns pass:true when every result passed", () => {
    const out = aggregateEval([
      { name: "a", kind: "value", pass: true },
      { name: "b", kind: "function", pass: true },
    ]);
    expect(out.pass).toBe(true);
    expect(out.failures).toEqual([]);
  });

  it("returns pass:false with a structured error message when any result failed", () => {
    const out = aggregateEval(
      [
        { name: "a", kind: "value", pass: false, reasoning: "missing field" },
        { name: "b", kind: "function", pass: true },
        { name: "c", kind: "function", pass: false, reasoning: "wrong tool" },
      ],
      "all_pass",
    );
    expect(out.pass).toBe(false);
    expect(out.error).toMatch(/^eval failed \(policy: all_pass\):/);
    expect(out.error).toContain("a (value): missing field");
    expect(out.error).toContain("c (function): wrong tool");
    expect(out.error).not.toContain(" b ");
    expect(out.failures.map((f) => f.name)).toEqual(["a", "c"]);
  });

  it("preserves declaration order in the failure list", () => {
    const out = aggregateEval([
      { name: "z", kind: "value", pass: false, reasoning: "x" },
      { name: "a", kind: "value", pass: false, reasoning: "y" },
    ]);
    expect(out.failures.map((f) => f.name)).toEqual(["z", "a"]);
  });

  it("renders 'no reasoning' when an evaluator produced none", () => {
    const out = aggregateEval([{ name: "n", kind: "value", pass: false }]);
    expect(out.error).toContain("n (value): no reasoning");
  });
});

describe("aggregateEval (reserved policies)", () => {
  it("throws for any_pass (reserved in v1.0)", () => {
    expect(() => aggregateEval([{ name: "a", kind: "value", pass: false }], "any_pass")).toThrow(
      /any_pass.*reserved in v1\.0/,
    );
  });

  it("throws for weighted (reserved in v1.0)", () => {
    expect(() => aggregateEval([{ name: "a", kind: "value", pass: false }], "weighted")).toThrow(
      /weighted.*reserved in v1\.0/,
    );
  });
});
