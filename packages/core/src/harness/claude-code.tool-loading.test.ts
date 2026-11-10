/**
 * Dogfood run 42884113267 (#537): the bundled pr-risk-review pack failed its
 * first node in 7s with `all_tools_called: missing successful calls to
 * [github_list_pr_files], called: [StructuredOutput]`.
 *
 * Claude Code defers every MCP server's tools behind ToolSearch unless the
 * server sets `alwaysLoad` (agent SDK 0.3.322 sdk.d.ts: "Default: tools are
 * deferred when tool search is enabled"; the bundled CLI enables tool search
 * by default for first-party auth), and MCP startup is non-blocking. A node's
 * skill tools therefore were not on the model's turn-1 tool list: it saw only
 * the built-ins and StructuredOutput, and answered without calling them.
 *
 * The fake Claude Code below models exactly that: a server's tools reach the
 * turn-1 list only with `alwaysLoad: true`, and the model calls only what is
 * on that list. The real executor, the real github skill and the shipped pack
 * run on top of it; only `fetch` and the SDK are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse } from "yaml";
import type { Workflow } from "../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** What the fake model saw on turn 1, per query. */
let turnOneTools: string[][] = [];

/** Built-ins plus StructuredOutput: what the model always sees with an output schema. */
const BUILTINS = ["Read", "Grep", "Glob", "WebSearch", "ToolSearch", "StructuredOutput"];

/**
 * Claude Code as the SDK documents it: an MCP server's tools are on the
 * turn-1 prompt only when the server sets `alwaysLoad`; otherwise they are
 * deferred behind ToolSearch. The "model" follows the instruction for every
 * tool it can see, then answers through StructuredOutput.
 */
function fakeClaudeCode({ prompt, options }: { prompt: string; options: any }) {
  return (async function* () {
    const loaded = new Map<string, { handler: (args: any) => Promise<any> }>();
    for (const [server, cfg] of Object.entries<any>(options.mcpServers ?? {})) {
      const alwaysLoad = cfg.type === "sdk" ? cfg.instance?.alwaysLoad === true : cfg.alwaysLoad === true;
      if (!alwaysLoad) continue;
      for (const t of cfg.instance?.tools ?? []) loaded.set(`mcp__${server}__${t.name}`, t);
    }
    turnOneTools.push([...BUILTINS, ...loaded.keys()]);

    let n = 0;
    for (const [name, t] of loaded) {
      const bare = name.split("__").slice(2).join("__");
      if (!prompt.includes(bare)) continue;
      // Both instruction tools (github_get_issue, github_list_pr_files) take repo + number.
      const args = { repo: "swenyai/sweny", number: 590 };
      const id = `u${n++}`;
      yield { type: "assistant", message: { id: `m${id}`, content: [{ type: "tool_use", id, name, input: args }] } };
      const res = await t.handler(args);
      yield {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: id, content: res.content, is_error: !!res.isError }] },
      };
    }
    const data = {
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
    yield {
      type: "assistant",
      message: { id: "mout", content: [{ type: "tool_use", id: "out", name: "StructuredOutput", input: data }] },
    };
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "out", content: "ok" }] } };
    yield { type: "result", subtype: "success", result: JSON.stringify(data), structured_output: data };
  })();
}

describe("pr-risk-review scope node on Claude Code: skill tools are on the turn-1 tool list", () => {
  beforeEach(() => {
    turnOneTools = [];
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(fakeClaudeCode),
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

  async function runScope() {
    const { PACK_TEMPLATES } = await import("../cli/packs.js");
    const { parseWorkflow } = await import("../schema.js");
    const { ClaudeCodeHarness } = await import("./claude-code.js");
    const { execute } = await import("../executor.js");
    const { createSkillMap, github } = await import("../skills/index.js");
    const pack = parseWorkflow(parse(PACK_TEMPLATES.find((t) => t.id === "pr-risk-review")!.yaml)) as Workflow;
    // The scope node as shipped (skills, tools.allow, permissions: read, evals); the
    // later nodes need a judge and a comment target, which this bug never reached.
    const workflow: Workflow = { ...pack, entry: "scope", nodes: { scope: pack.nodes.scope }, edges: [] };
    const harness = new ClaudeCodeHarness({ logger: silent });
    return execute(
      workflow,
      { repo: "swenyai/sweny", pr_number: 590 },
      { skills: createSkillMap([github]), harness, config: { GITHUB_TOKEN: "t" }, logger: silent },
    );
  }

  it("the node's allowed github tools are loaded up front, not deferred behind ToolSearch", async () => {
    await runScope();
    expect(turnOneTools).toHaveLength(1);
    expect(turnOneTools[0]).toEqual(
      expect.arrayContaining(["mcp__sweny-core__github_get_issue", "mcp__sweny-core__github_list_pr_files"]),
    );
  });

  it("the scope node calls github_list_pr_files and passes its evals", async () => {
    const { results } = await runScope();
    const scope = results.get("scope")!;
    const failed = (scope.evals ?? []).filter((e) => !e.pass);
    expect(failed).toEqual([]);
    expect(scope.status).toBe("success");
    expect(scope.toolCalls.map((c) => c.tool)).toContain("github_list_pr_files");
    expect(scope.toolCalls.find((c) => c.tool === "github_list_pr_files")?.status).toBe("success");
    expect(vi.mocked(fetch).mock.calls.map(([u]) => String(u))).toContain(
      "https://api.github.com/repos/swenyai/sweny/pulls/590/files?per_page=100",
    );
  });
});
