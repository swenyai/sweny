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

/** Tools an external skill server would list, by server name. */
const EXTERNAL_TOOLS: Record<string, Array<{ name: string; handler: (args: any) => Promise<any> }>> = {
  tickets: [{ name: "lookup_ticket", handler: async () => ({ content: [{ type: "text", text: '{"id":"T-1"}' }] }) }],
};

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
      // An in-process server lists its own tools; an external (stdio/http) one is
      // a fixture here: nothing is spawned or fetched.
      for (const t of cfg.instance?.tools ?? EXTERNAL_TOOLS[server] ?? []) loaded.set(`mcp__${server}__${t.name}`, t);
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

  it("warns when the sweny-core tool server did not connect, and logs the tool list", async () => {
    const sdk: any = await import("@anthropic-ai/claude-agent-sdk");
    sdk.query.mockImplementationOnce(() =>
      (async function* () {
        yield {
          type: "system",
          subtype: "init",
          tools: ["Read", "StructuredOutput"],
          mcp_servers: [{ name: "sweny-core", status: "failed" }],
        };
        yield { type: "result", subtype: "success", result: "done" };
      })(),
    );
    const { ClaudeCodeHarness } = await import("./claude-code.js");
    const { github } = await import("../skills/index.js");
    const logs = { warn: [] as string[], debug: [] as string[] };
    const logger = {
      ...silent,
      warn: (m: string) => void logs.warn.push(m),
      debug: (m: string) => void logs.debug.push(m),
    };
    await new ClaudeCodeHarness({ logger }).run({ instruction: "x", context: {}, tools: github.tools.slice(0, 1) });
    expect(logs.debug).toContain("  agent tools: Read, StructuredOutput");
    expect(logs.warn.some((m) => m.includes("sweny-core tool server is failed"))).toBe(true);
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

describe("skill-declared MCP servers on Claude Code: their tools are on the turn-1 tool list", () => {
  beforeEach(() => {
    turnOneTools = [];
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(fakeClaudeCode),
      createSdkMcpServer: (o: any) => ({ type: "sdk", name: o.name, instance: o }),
      tool: vi.fn(),
    }));
    vi.stubEnv("SWENY_SANDBOX", "off");
    vi.stubEnv("SWENY_TOOL_BRIDGE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const servers = {
    stdio: { command: process.execPath, args: ["tickets-server.js"] },
    http: { type: "http", url: "https://tickets.invalid/mcp" },
  };

  it.each(Object.keys(servers))(
    "a %s skill server's tool is loaded up front and the node's check passes",
    async (kind) => {
      const { parseWorkflow } = await import("../schema.js");
      const { ClaudeCodeHarness } = await import("./claude-code.js");
      const { execute } = await import("../executor.js");
      const mcp = servers[kind as keyof typeof servers];
      const workflow = parseWorkflow(
        parse(`
id: tickets
name: Tickets
description: one node that must call its skill server's tool
entry: look
skills:
  tickets:
    instruction: Look tickets up with the tickets server.
    mcp: ${JSON.stringify(mcp)}
nodes:
  look:
    name: Look up
    instruction: Call lookup_ticket for ticket T-1.
    skills: [tickets]
    eval:
      - name: looked_it_up
        kind: function
        rule:
          all_tools_called: [lookup_ticket]
edges: []
`),
      ) as Workflow;
      const { results } = await execute(
        workflow,
        {},
        {
          skills: new Map(),
          harness: new ClaudeCodeHarness({ logger: silent, envScope: false }),
          config: {},
          logger: silent,
        },
      );
      expect(turnOneTools[0]).toContain("mcp__tickets__lookup_ticket");
      const look = results.get("look")!;
      expect((look.evals ?? []).filter((e) => !e.pass)).toEqual([]);
      expect(look.status).toBe("success");
    },
  );

  it("an explicit alwaysLoad: false on the server config wins", async () => {
    const { ClaudeCodeHarness } = await import("./claude-code.js");
    const sdk: any = await import("@anthropic-ai/claude-agent-sdk");
    await new ClaudeCodeHarness({ logger: silent, envScope: false }).run({
      instruction: "Call lookup_ticket",
      context: {},
      tools: [],
      mcpServers: { tickets: { ...servers.http, alwaysLoad: false } as any },
    });
    expect(sdk.query.mock.calls[0][0].options.mcpServers.tickets.alwaysLoad).toBe(false);
    expect(turnOneTools[0]).not.toContain("mcp__tickets__lookup_ticket");
  });

  it("a read-only node still gets no skill server", async () => {
    const { ClaudeCodeHarness } = await import("./claude-code.js");
    const sdk: any = await import("@anthropic-ai/claude-agent-sdk");
    await new ClaudeCodeHarness({ logger: silent, envScope: false }).run({
      instruction: "x",
      context: {},
      tools: [],
      readOnly: true,
      mcpServers: { tickets: servers.http as any },
    });
    expect(sdk.query.mock.calls[0][0].options.mcpServers?.tickets).toBeUndefined();
  });
});
