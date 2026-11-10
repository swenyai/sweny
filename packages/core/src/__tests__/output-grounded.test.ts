// ─── output_grounded through the executor (#580) ────────────────────
//
// The evaluator's evidence is the node's own tool outputs plus the context its
// prompt was given (workflow input and prior nodes). These tests lock the
// executor wiring: a prior node's output grounds a later node's citation, an
// invented id fails the node, and the parser accepts and rejects the rule.

import { describe, expect, it } from "vitest";
import { execute } from "../executor.js";
import { evaluateAll } from "../eval/index.js";
import { evaluatorRuleZ, evaluatorZ, parseWorkflow } from "../schema.js";
import { createSkillMap } from "../skills/index.js";
import type { Claude, Logger, NodeResult, Workflow } from "../types.js";

const silent: Logger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

function scripted(results: Record<string, NodeResult>): Claude {
  return {
    async run(opts) {
      const id = Object.keys(results).find((k) => opts.instruction.includes(`[${k}]`));
      return id ? structuredClone(results[id]!) : { status: "success", data: {}, toolCalls: [] };
    },
    async evaluate(o) {
      return o.choices[0]!.id;
    },
    async ask() {
      return "";
    },
  };
}

function twoNodes(): Workflow {
  return {
    id: "grounded",
    name: "grounded",
    description: "",
    entry: "gather",
    nodes: {
      gather: { name: "gather", instruction: "[gather] list open tickets", skills: [] },
      write: {
        name: "write",
        instruction: "[write] write the todo for each ticket",
        skills: [],
        eval: [{ name: "cites_only_seen", kind: "function", rule: { output_grounded: {} } }],
      },
    },
    edges: [{ from: "gather", to: "write" }],
  };
}

describe("output_grounded in the executor", () => {
  it("passes when the cited ids came from a prior node and this node's tools", async () => {
    const claude = scripted({
      gather: { status: "success", data: { tickets: ["OPS-1"] }, toolCalls: [] },
      write: {
        status: "success",
        data: { todo: "OPS-1, see https://app.example.com/t/2" },
        toolCalls: [
          { tool: "get_ticket", input: { id: 2 }, output: { url: "https://app.example.com/t/2" }, status: "success" },
        ],
      },
    });
    const { results } = await execute(twoNodes(), {}, { skills: createSkillMap([]), claude, logger: silent });
    const write = results.get("write")!;
    expect(write.status).toBe("success");
    expect(write.evals?.[0]).toMatchObject({ name: "cites_only_seen", kind: "function", pass: true });
  });

  it("fails the node on an id it never saw, naming value and path", async () => {
    const claude = scripted({
      gather: { status: "success", data: { tickets: ["OPS-1"] }, toolCalls: [] },
      write: { status: "success", data: { todo: "OPS-1 and OPS-404" }, toolCalls: [] },
    });
    const { results } = await execute(twoNodes(), {}, { skills: createSkillMap([]), claude, logger: silent });
    const write = results.get("write")!;
    expect(write.status).toBe("failed");
    expect(write.evals?.[0]?.pass).toBe(false);
    expect(write.evals?.[0]?.reasoning).toContain('todo "OPS-404"');
    expect(write.evals?.[0]?.reasoning).not.toContain('"OPS-1"');
  });

  it("grounds an id in the workflow input by default", async () => {
    const claude = scripted({
      gather: { status: "success", data: {}, toolCalls: [] },
      write: { status: "success", data: { todo: "OPS-77" }, toolCalls: [] },
    });
    const { results } = await execute(
      twoNodes(),
      { ticket: "OPS-77" },
      { skills: createSkillMap([]), claude, logger: silent },
    );
    expect(results.get("write")!.status).toBe("success");
  });
});

describe("output_grounded in evaluateAll", () => {
  it("joins a tool-rule failure and a grounding failure on one function evaluator", async () => {
    const [r] = await evaluateAll(
      [{ name: "g", kind: "function", rule: { any_tool_called: ["fetch"], output_grounded: {} } }],
      { status: "success", data: { s: "ENG-1" }, toolCalls: [] },
      { context: { input: {} }, nodeId: "n" },
    );
    expect(r).toEqual({
      name: "g",
      kind: "function",
      pass: false,
      reasoning:
        "any_tool_called: required one of [fetch] to succeed, called: [none]; " +
        'output_grounded: 1 value(s) not grounded (evidence: tool outputs, inputs, prior context): s "ENG-1"',
    });
  });

  it("passes context and node id through as evidence", async () => {
    const rule = { output_grounded: {} };
    const result: NodeResult = { status: "success", data: { s: "ENG-1" }, toolCalls: [] };
    const seen = await evaluateAll([{ name: "g", kind: "function", rule }], result, {
      context: { input: {}, prior: { s: "ENG-1" } },
    });
    expect(seen[0]!.pass).toBe(true);
    const self = await evaluateAll([{ name: "g", kind: "function", rule }], result, {
      context: { input: {}, me: { s: "ENG-1" } },
      nodeId: "me",
    });
    expect(self[0]!.pass).toBe(false);
  });
});

describe("output_grounded in the schema", () => {
  it("accepts an empty rule (all defaults)", () => {
    expect(evaluatorRuleZ.parse({ output_grounded: {} })).toEqual({ output_grounded: {} });
  });

  it("accepts the full config", () => {
    const rule = {
      output_grounded: {
        paths: ["items[*].body"],
        ids: ["items[*].ticket_id"],
        patterns: ["url", "issue_key", "github_ref", "ticket (\\d+)"],
        allow: ["https://docs.sweny.ai"],
        tools: ["linear_get_issue"],
        inputs: false,
        context: true,
        stale: true,
        quotes: [
          { path: "notes[*].quote", tools: ["github_get_pr_patches"], whitespace: "exact" },
          { path: "notes[*].hunk" },
        ],
      },
    };
    expect(evaluatorRuleZ.parse(rule)).toEqual(rule);
  });

  it("accepts patterns: [] (scan off), for a quotes-only rule", () => {
    const rule = { output_grounded: { patterns: [], quotes: [{ path: "q", whitespace: "collapse" }] } };
    expect(evaluatorRuleZ.parse(rule)).toEqual(rule);
  });

  it("rejects a bad quotes entry", () => {
    expect(() => evaluatorRuleZ.parse({ output_grounded: { quotes: [] } })).toThrow();
    expect(() => evaluatorRuleZ.parse({ output_grounded: { quotes: [{ tools: ["t"] }] } })).toThrow();
    expect(() => evaluatorRuleZ.parse({ output_grounded: { quotes: [{ path: "q", whitespace: "loose" }] } })).toThrow();
    expect(() => evaluatorRuleZ.parse({ output_grounded: { quotes: [{ path: "q", tools: [] }] } })).toThrow();
    expect(() => evaluatorRuleZ.parse({ output_grounded: { quotes: [{ path: "q", extra: 1 }] } })).toThrow();
  });

  it("rejects unknown keys and empty lists", () => {
    expect(() => evaluatorRuleZ.parse({ output_grounded: { nope: true } })).toThrow();
    expect(() => evaluatorRuleZ.parse({ output_grounded: { paths: [] } })).toThrow();
    expect(() => evaluatorRuleZ.parse({ output_grounded: { allow: [""] } })).toThrow();
  });

  it("rejects output_grounded on a value evaluator (it reads the tool trace)", () => {
    const r = evaluatorZ.safeParse({ name: "g", kind: "value", rule: { output_grounded: {} } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/output_grounded.*function/);
  });

  it("parses a workflow that uses it", () => {
    const wf = parseWorkflow(twoNodes());
    expect(wf.nodes.write!.eval![0]!.rule!.output_grounded).toEqual({});
  });
});
