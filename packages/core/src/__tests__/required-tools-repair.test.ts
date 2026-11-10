/**
 * Required-tool repair: one turn naming the tools a node's `function` evals
 * require when the agent finished without calling them.
 *
 * Dogfood run 42890245104 (core 0.1.206, with #593's alwaysLoad): the
 * pr-risk-review scope node had its github tools on the list and still
 * answered on turn 1, `all_tools_called: missing successful calls to
 * [github_list_pr_files], called: [StructuredOutput]`. The same version passed
 * in run 42890468912. The model is nondeterministic; the node must not be.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse } from "yaml";
import type { Claude, ExecutionEvent, Workflow } from "../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const SCOPE_DATA = {
  pr_number: 590,
  title: "feat: dogfood",
  files_changed: 1,
  additions: 10,
  deletions: 2,
  size: "xs",
  tests_touched: false,
  source_touched: true,
  risky_areas: [],
};

/**
 * Claude Code that answers at once through StructuredOutput, and calls a tool
 * only when the prompt says its previous attempt skipped it.
 */
function lazyClaudeCode({ prompt, options }: { prompt: string; options: any }) {
  return (async function* () {
    const server = options.mcpServers?.["sweny-core"];
    const tools: Array<{ name: string; handler: (args: any) => Promise<any> }> = server?.instance?.tools ?? [];
    if (prompt.includes("finished without calling them")) {
      let n = 0;
      for (const t of tools) {
        if (!prompt.includes(`- ${t.name}`)) continue;
        const id = `u${n++}`;
        const args = { repo: "swenyai/sweny", number: 590 };
        yield {
          type: "assistant",
          message: {
            id: `m${id}`,
            content: [{ type: "tool_use", id, name: `mcp__sweny-core__${t.name}`, input: args }],
          },
        };
        const res = await t.handler(args);
        yield {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: id, content: res.content, is_error: !!res.isError }],
          },
        };
      }
    }
    yield {
      type: "assistant",
      message: { id: "mout", content: [{ type: "tool_use", id: "out", name: "StructuredOutput", input: SCOPE_DATA }] },
    };
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "out", content: "ok" }] } };
    yield { type: "result", subtype: "success", result: JSON.stringify(SCOPE_DATA), structured_output: SCOPE_DATA };
  })();
}

describe("pr-risk-review scope node on Claude Code: an agent that skips its required tool gets one repair", () => {
  beforeEach(() => {
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(lazyClaudeCode),
      createSdkMcpServer: (o: any) => ({ type: "sdk", name: o.name, instance: o }),
      tool: (name: string, description: string, inputSchema: unknown, handler: (args: any) => Promise<any>) => ({
        name,
        description,
        inputSchema,
        handler,
      }),
    }));
    vi.stubEnv("SWENY_SANDBOX", "off");
    vi.stubEnv("SWENY_TOOL_BRIDGE", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = String(url).includes("/pulls/590/files")
          ? [{ filename: "src/a.ts", status: "modified", additions: 10, deletions: 2, changes: 12 }]
          : { number: 590, title: "feat: dogfood", body: "" };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function runScope(events: ExecutionEvent[] = []) {
    const { PACK_TEMPLATES } = await import("../cli/packs.js");
    const { parseWorkflow } = await import("../schema.js");
    const { ClaudeCodeHarness } = await import("../harness/claude-code.js");
    const { execute } = await import("../executor.js");
    const { createSkillMap, github } = await import("../skills/index.js");
    const pack = parseWorkflow(parse(PACK_TEMPLATES.find((t) => t.id === "pr-risk-review")!.yaml)) as Workflow;
    const workflow: Workflow = { ...pack, entry: "scope", nodes: { scope: pack.nodes.scope }, edges: [] };
    const harness = new ClaudeCodeHarness({ logger: silent });
    return execute(
      workflow,
      { repo: "swenyai/sweny", pr_number: 590 },
      {
        skills: createSkillMap([github]),
        harness,
        config: { GITHUB_TOKEN: "t" },
        logger: silent,
        observer: (e) => void events.push(e),
      },
    );
  }

  it("passes after one repair turn that names github_list_pr_files", async () => {
    const sdk: any = await import("@anthropic-ai/claude-agent-sdk");
    const events: ExecutionEvent[] = [];
    const { results } = await runScope(events);
    const scope = results.get("scope")!;

    expect(sdk.query).toHaveBeenCalledTimes(2);
    expect(sdk.query.mock.calls[0][0].prompt).not.toContain("finished without calling them");
    expect(sdk.query.mock.calls[1][0].prompt).toContain("- github_list_pr_files");
    expect(scope.status).toBe("success");
    expect((scope.evals ?? []).filter((e) => !e.pass)).toEqual([]);
    expect(scope.toolCalls.find((c) => c.tool === "github_list_pr_files")?.status).toBe("success");
    expect(events).toContainEqual({
      type: "node:warning",
      node: "scope",
      reason: "required tools not called; one repair attempt",
      fields: ["github_list_pr_files"],
    });
  });

  it("each attempt gets the read-only built-ins and no tool search", async () => {
    const sdk: any = await import("@anthropic-ai/claude-agent-sdk");
    await runScope();
    for (const [{ options }] of sdk.query.mock.calls) {
      expect(options.tools).toEqual(["Read", "Grep", "Glob"]);
      expect(options.env.ENABLE_TOOL_SEARCH).toBe("false");
    }
  });
});

// ─── Harness-neutral: the executor's repair rule ─────────────────────

describe("required-tool repair in the executor (any harness)", () => {
  const node = (over: Record<string, unknown> = {}) => ({
    name: "N",
    instruction: "Look it up with lookup.",
    skills: [],
    eval: [{ name: "looked", kind: "function" as const, rule: { all_tools_called: ["lookup"] } }],
    ...over,
  });
  const wf = (over: Record<string, unknown> = {}): Workflow => ({
    id: "wf",
    name: "wf",
    description: "",
    entry: "n",
    nodes: { n: node(over) },
    edges: [],
  });
  const called = (tool: string, status: "success" | "error" = "success") => ({
    tool,
    input: {},
    output: {},
    status,
  });

  /** An agent that calls `lookup` only once told it skipped it (or never, when `stubborn`). */
  function agent(opts: { stubborn?: boolean; firstCalls?: any[]; data?: Record<string, unknown> } = {}) {
    const instructions: string[] = [];
    const claude: Claude = {
      async run(o) {
        instructions.push(o.instruction);
        const told = o.instruction.includes("finished without calling them");
        const first = instructions.length === 1 ? (opts.firstCalls ?? []) : [];
        const toolCalls = told && !opts.stubborn ? [called("lookup")] : first;
        return { status: "success", data: opts.data ?? {}, toolCalls };
      },
      async evaluate(o) {
        return o.choices[0]!.id;
      },
      async ask() {
        return "";
      },
    };
    return { claude, instructions };
  }

  async function run(workflow: Workflow, claude: Claude) {
    const { execute } = await import("../executor.js");
    const { createSkillMap } = await import("../skills/index.js");
    return execute(workflow, {}, { skills: createSkillMap([]), claude, logger: silent });
  }

  it("repairs once and passes when the agent then calls the tool", async () => {
    const { claude, instructions } = agent();
    const { results } = await run(wf(), claude);
    expect(instructions).toHaveLength(2);
    expect(instructions[1]).toContain("- lookup");
    expect(instructions[1]).toContain("Look it up with lookup.");
    expect(results.get("n")!.status).toBe("success");
  });

  it("repairs only once: a stubborn agent fails with the eval error after two calls", async () => {
    const { claude, instructions } = agent({ stubborn: true });
    const { results } = await run(wf(), claude);
    expect(instructions).toHaveLength(2);
    expect(results.get("n")!.status).toBe("failed");
    expect(String(results.get("n")!.data.error)).toMatch(/all_tools_called.*\[lookup\]/s);
  });

  it("the repair comes before the eval retry and does not use it up", async () => {
    const { claude, instructions } = agent({ stubborn: true });
    await run(wf({ retry: { max: 1 } }), claude);
    // initial + the one required-tool repair + 1 retry
    expect(instructions).toHaveLength(3);
    expect(instructions[2]).toMatch(/Previous attempt failed evaluation/);
  });

  it("no repair when a forbidden tool was called", async () => {
    const { claude, instructions } = agent({ firstCalls: [called("delete_all")] });
    const workflow = wf({
      eval: [
        { name: "looked", kind: "function", rule: { all_tools_called: ["lookup"] } },
        { name: "safe", kind: "function", rule: { no_tool_called: ["delete_all"] } },
      ],
    });
    const { results } = await run(workflow, claude);
    expect(instructions).toHaveLength(1);
    expect(results.get("n")!.status).toBe("failed");
  });

  it("no repair when the required tool was called and failed (the retry path's job)", async () => {
    const { claude, instructions } = agent({ firstCalls: [called("lookup", "error")] });
    const { results } = await run(wf(), claude);
    expect(instructions).toHaveLength(1);
    expect(results.get("n")!.status).toBe("failed");
  });

  it("no repair when another evaluator failed too", async () => {
    const { claude, instructions } = agent();
    const workflow = wf({
      eval: [
        { name: "looked", kind: "function", rule: { all_tools_called: ["lookup"] } },
        { name: "shape", kind: "value", rule: { output_required: ["answer"] } },
      ],
    });
    await run(workflow, claude);
    expect(instructions).toHaveLength(1);
  });

  it("no repair when the node passes", async () => {
    const { claude, instructions } = agent({ firstCalls: [called("lookup")] });
    const { results } = await run(wf(), claude);
    expect(instructions).toHaveLength(1);
    expect(results.get("n")!.status).toBe("success");
  });
});

describe("uncalledRequiredTools", () => {
  const failure = (name: string) => ({ name, kind: "function" as const, pass: false });

  it("names every uncalled all_tools_called tool and an any_tool_called set", async () => {
    const { uncalledRequiredTools } = await import("../executor.js");
    const evals = [
      { name: "all", kind: "function" as const, rule: { all_tools_called: ["a", "b", "c"] } },
      { name: "any", kind: "function" as const, rule: { any_tool_called: ["x", "y"] } },
      { name: "one", kind: "function" as const, rule: { any_tool_called: ["z"] } },
    ];
    const calls = [{ tool: "b", input: {}, output: {}, status: "success" as const }];
    expect(uncalledRequiredTools(evals, [failure("all"), failure("any"), failure("one")], calls)).toEqual([
      "a",
      "c",
      "one of x, y",
      "z",
    ]);
  });

  it("a tool called through an alias counts as called", async () => {
    const { uncalledRequiredTools } = await import("../executor.js");
    const evals = [{ name: "all", kind: "function" as const, rule: { all_tools_called: ["add_comment", "other"] } }];
    const calls = [{ tool: "save_comment", input: {}, output: {}, status: "success" as const }];
    const aliases = new Map([["add_comment", new Set(["add_comment", "save_comment"])]]);
    expect(uncalledRequiredTools(evals, [failure("all")], calls, aliases)).toEqual(["other"]);
  });

  it("is empty when a missing tool was withheld from the node (dry or staged run)", async () => {
    const { uncalledRequiredTools } = await import("../executor.js");
    const all = [{ name: "all", kind: "function" as const, rule: { all_tools_called: ["create_issue"] } }];
    expect(uncalledRequiredTools(all, [failure("all")], [], undefined, ["create_issue"])).toEqual([]);
    const any = [
      { name: "any", kind: "function" as const, rule: { any_tool_called: ["create_issue", "add_comment"] } },
    ];
    expect(uncalledRequiredTools(any, [failure("any")], [], undefined, ["create_issue", "add_comment"])).toEqual([]);
    expect(uncalledRequiredTools(any, [failure("any")], [], undefined, ["create_issue"])).toEqual([
      "one of create_issue, add_comment",
    ]);
  });

  it("is empty for a judge or value failure, or a failure with no matching evaluator", async () => {
    const { uncalledRequiredTools } = await import("../executor.js");
    const evals = [{ name: "all", kind: "function" as const, rule: { all_tools_called: ["a"] } }];
    expect(uncalledRequiredTools(evals, [{ name: "all", kind: "judge", pass: false }], [])).toEqual([]);
    expect(uncalledRequiredTools(evals, [{ name: "output_required", kind: "value", pass: false }], [])).toEqual([]);
    expect(uncalledRequiredTools(evals, [failure("missing")], [])).toEqual([]);
    expect(uncalledRequiredTools(undefined, [failure("all")], [])).toEqual([]);
  });

  it("the repair instruction lists the tools, then the step", async () => {
    const { requiredToolsRepairInstruction } = await import("../executor.js");
    expect(requiredToolsRepairInstruction(["a", "one of x, y"], "Do it.")).toBe(
      "This step requires these tools, and your previous attempt finished without calling them:\n- a\n- one of x, y\n\n" +
        "Do the step again: call each listed tool, use what it returns, then return the complete output.\n\n---\n\nDo it.",
    );
  });
});
