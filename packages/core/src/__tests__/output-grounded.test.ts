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
import type { Claude, Logger, NodeResult, OutputGroundedRule, ToolCall, Workflow } from "../types.js";

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

// ─── Review of #588: every false pass and false fail, through execute() ──

/** One node `n` with one output_grounded evaluator; returns its result. */
async function groundedRun(
  rule: OutputGroundedRule,
  data: Record<string, unknown>,
  toolCalls: ToolCall[],
  opts: { instruction?: string; input?: Record<string, unknown> } = {},
): Promise<NodeResult> {
  const workflow: Workflow = {
    id: "g",
    name: "g",
    description: "",
    entry: "n",
    nodes: {
      n: {
        name: "n",
        instruction: `[n] ${opts.instruction ?? "write the note"}`,
        skills: [],
        eval: [{ name: "grounded", kind: "function", rule: { output_grounded: rule } }],
      },
    },
    edges: [],
  };
  const claude = scripted({ n: { status: "success", data, toolCalls } });
  const { results } = await execute(workflow, opts.input ?? {}, { skills: createSkillMap([]), claude, logger: silent });
  return results.get("n")!;
}

const call = (tool: string, output: unknown, extra: Partial<ToolCall> = {}): ToolCall => ({
  tool,
  input: {},
  output,
  status: "success",
  ...extra,
});

describe("output_grounded review: false passes fail", () => {
  it("a URL fragment the tool never returned", async () => {
    const r = await groundedRun({}, { link: "https://github.com/acme/api/issues/12#issuecomment-99999" }, [
      call("get_issue", { html_url: "https://github.com/acme/api/issues/12" }),
    ]);
    expect(r.evals?.[0]?.pass).toBe(false);
    expect(r.evals?.[0]?.reasoning).toContain('link "https://github.com/acme/api/issues/12#issuecomment-99999"');
  });

  it("ids hidden in a URL's fragment", async () => {
    const r = await groundedRun(
      { patterns: ["url", "github_ref", "issue_key"] },
      { s: "https://seen.example/x#,ENG-999,acme/api#5" },
      [call("fetch", "https://seen.example/x")],
    );
    expect(r.evals?.[0]?.pass).toBe(false);
    expect(r.evals?.[0]?.reasoning).toContain('s "ENG-999"');
    expect(r.evals?.[0]?.reasoning).toContain('s "acme/api#5"');
  });

  it("an upper-case scheme", async () => {
    const r = await groundedRun({}, { s: "See HTTPS://invented.example/a" }, []);
    expect(r.evals?.[0]?.pass).toBe(false);
    expect(r.evals?.[0]?.reasoning).toContain('s "HTTPS://invented.example/a"');
  });

  it("a scheme-less GitHub or Jira link", async () => {
    const r = await groundedRun({}, { s: "github.com/acme/api/pull/999 and acme.atlassian.net/browse/OPS-1" }, []);
    expect(r.evals?.[0]?.pass).toBe(false);
    expect(r.evals?.[0]?.reasoning).toContain('s "github.com/acme/api/pull/999"');
    expect(r.evals?.[0]?.reasoning).toContain('s "acme.atlassian.net/browse/OPS-1"');
  });

  it("a number at an ids path that is only part of an evidence value", async () => {
    const r = await groundedRun({ ids: ["ticket"] }, { ticket: 48 }, [call("get", { note: "PR 48 merged" })]);
    expect(r.evals?.[0]?.pass).toBe(false);
    expect(r.evals?.[0]?.reasoning).toContain('ticket "48"');
  });

  it("an ids value that is only an object key in the evidence", async () => {
    const r = await groundedRun({ ids: ["ticket"] }, { ticket: "4821" }, [call("get", { "4821": { ok: true } })]);
    expect(r.evals?.[0]?.pass).toBe(false);
  });

  it("a value a shell echoed", async () => {
    const r = await groundedRun({}, { u: "https://invented.example/x" }, [
      call("Bash", "https://invented.example/x", { input: { command: "echo https://invented.example/x" } }),
    ]);
    expect(r.evals?.[0]?.pass).toBe(false);
  });

  it("a value a write tool echoed", async () => {
    const r = await groundedRun({}, { u: "https://invented.example/y" }, [
      call("save_issue", { url: "https://invented.example/y" }, { server: "linear" }),
    ]);
    expect(r.evals?.[0]?.pass).toBe(false);
  });

  it("a same-named tool on another MCP server", async () => {
    const out = { url: "https://tickets.example/1" };
    const evil = await groundedRun({ tools: ["get_issue"] }, { u: out.url }, [
      call("get_issue", out, { server: "evil" }),
    ]);
    expect(evil.evals?.[0]?.pass).toBe(false);
    const named = await groundedRun({ tools: ["linear/get_issue"] }, { u: out.url }, [
      call("get_issue", out, { server: "linear" }),
    ]);
    expect(named.evals?.[0]).toMatchObject({ pass: true });
  });

  it("a quote too short to mean anything", async () => {
    const r = await groundedRun({ patterns: [], quotes: [{ path: "q", tools: ["get_patch"] }] }, { q: "a" }, [
      call("get_patch", "+ a line of code"),
    ]);
    expect(r.evals?.[0]?.pass).toBe(false);
    expect(r.evals?.[0]?.reasoning).toContain("shorter than 8");
  });
});

describe("output_grounded review: false fails pass", () => {
  it("a link the node's own instruction gave it", async () => {
    const r = await groundedRun({}, { s: "Follow https://docs.example.com/runbook" }, [], {
      instruction: "Link the runbook https://docs.example.com/runbook in the note.",
    });
    expect(r.evals?.[0]).toMatchObject({ pass: true });
  });

  it("UTF-8, SHA-256 and ISO-8601 in prose under the default rule", async () => {
    const r = await groundedRun({}, { s: "Encode as UTF-8, hash with SHA-256, dates in ISO-8601." }, []);
    expect(r.evals?.[0]).toMatchObject({ pass: true });
  });

  it("a configured path that matched nothing passes with a warning", async () => {
    const r = await groundedRun({ ids: ["tickets[*].id"] }, { other: 1 }, []);
    expect(r.evals?.[0]?.pass).toBe(true);
    expect(r.evals?.[0]?.reasoning).toContain("tickets[*].id");
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
