/**
 * #414: ClaudeCodeHarness with `toolBridge: true`, driven by the real executor.
 *
 * The SDK `query` is mocked; inside it the test plays the harness side of the
 * bridge (connects to the socket named in the `sweny-core` MCP config with the
 * token from its env), so no LLM and no child process is involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { ExecutionEvent, Skill, Tool, Workflow } from "../../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function skills(calls: string[]): Skill[] {
  const tool = (name: string, access?: "read" | "write"): Tool => ({
    name,
    description: name,
    input_schema: { type: "object", properties: { q: { type: "string" } } },
    ...(access ? { access } : {}),
    handler: async (input: any) => {
      calls.push(name);
      return { tool: name, q: input.q ?? null };
    },
  });
  return [
    {
      id: "poster",
      name: "Poster",
      description: "reads and posts",
      category: "general",
      config: {},
      tools: [tool("get_thread", "read"), tool("post_comment", "write"), tool("mystery_tool")],
    },
  ];
}

const workflow: Workflow = {
  id: "bridge",
  name: "bridge",
  description: "one node",
  entry: "post",
  nodes: { post: { name: "Post", instruction: "Post a review comment", skills: ["poster"] } },
  edges: [],
};

describe("ClaudeCodeHarness over the tool bridge", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let createSdkMcpServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuery = vi.fn();
    createSdkMcpServer = vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" });
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query: mockQuery, createSdkMcpServer, tool: vi.fn() }));
    vi.stubEnv("SWENY_SANDBOX", "off");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** A query that uses the bridge like Claude Code would, then reports the calls on the stream. */
  function bridgeDrivingQuery(plan: Array<{ name: string; args: Record<string, unknown> }>, seen: any) {
    return ({ options }: any) =>
      (async function* () {
        const { BridgeClient } = await import("./shim.js");
        const cfg = options.mcpServers["sweny-core"];
        seen.options = options;
        seen.cfg = cfg;
        const socket = cfg.args[cfg.args.indexOf("--socket") + 1];
        seen.socket = socket;
        const client = new BridgeClient(socket, cfg.env.SWENY_TOOL_BRIDGE_TOKEN);
        const list: any = await client.request("tools/list");
        seen.listed = list.result.tools.map((t: any) => t.name);
        seen.responses = [];
        for (const [i, p] of plan.entries()) {
          const res: any = await client.request("tools/call", { name: p.name, arguments: p.args });
          seen.responses.push(res);
          yield {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: `u${i}`, name: `mcp__sweny-core__${p.name}`, input: p.args }],
            },
          };
          yield {
            type: "user",
            message: {
              content: [
                res.ok
                  ? {
                      type: "tool_result",
                      tool_use_id: `u${i}`,
                      content: res.result.content,
                      is_error: !!res.result.isError,
                    }
                  : { type: "tool_result", tool_use_id: `u${i}`, content: res.error.message, is_error: true },
              ],
            },
          };
        }
        client.close();
        yield { type: "result", subtype: "success", result: "done" };
      })();
  }

  it("dry run: only read tools cross the bridge, and tool calls are observed", async () => {
    const calls: string[] = [];
    const seen: any = {};
    mockQuery.mockImplementation(
      bridgeDrivingQuery(
        [
          { name: "get_thread", args: { q: "a" } },
          { name: "post_comment", args: { q: "b" } },
        ],
        seen,
      ),
    );
    const { ClaudeCodeHarness } = await import("../claude-code.js");
    const { execute } = await import("../../executor.js");
    const { createSkillMap } = await import("../../skills/index.js");
    const events: ExecutionEvent[] = [];

    const harness = new ClaudeCodeHarness({ logger: silent, toolBridge: true });
    const { results } = await execute(
      workflow,
      { dryRun: true },
      { skills: createSkillMap(skills(calls)), harness, config: {}, logger: silent, observer: (e) => events.push(e) },
    );

    // The in-process server was not built; the bridge's stdio shim took its place.
    expect(createSdkMcpServer).not.toHaveBeenCalled();
    expect(seen.cfg.type).toBe("stdio");
    expect(seen.cfg.args).toContain("tool-bridge");
    // Read-only filtering holds through the bridge.
    expect(seen.listed).toEqual(["get_thread"]);
    expect(seen.responses[1]).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(calls).toEqual(["get_thread"]);
    // Dry run still drops every other MCP server and pins the config.
    expect(Object.keys(seen.options.mcpServers)).toEqual(["sweny-core"]);
    expect(seen.options.strictMcpConfig).toBe(true);

    // sweny observed the bridged call (tool:call / tool:result from the executor).
    const toolEvents = events.filter((e) => e.type === "tool:call" || e.type === "tool:result");
    expect(toolEvents).toEqual([
      { type: "tool:call", node: "post", tool: "get_thread", input: { q: "a" } },
      { type: "tool:result", node: "post", tool: "get_thread", output: { tool: "get_thread", q: "a" } },
    ]);

    // ToolCall records carry the same status and typed output as the in-process path.
    const post = results.get("post")!;
    expect(post.status).toBe("success");
    expect(post.toolCalls[0]).toEqual({
      tool: "get_thread",
      input: { q: "a" },
      status: "success",
      output: { tool: "get_thread", q: "a" },
    });
    expect(post.toolCalls[1]).toMatchObject({ tool: "post_comment", status: "error" });

    // The socket and its directory are gone once the node run ends.
    expect(fs.existsSync(seen.socket)).toBe(false);
  });

  it("bridge is off by default: the in-process SDK server is used", async () => {
    mockQuery.mockImplementation(() =>
      (async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      })(),
    );
    const { ClaudeCodeHarness } = await import("../claude-code.js");
    const h = new ClaudeCodeHarness({ logger: silent });
    await h.run({ instruction: "x", context: {}, tools: skills([])[0].tools });
    expect(createSdkMcpServer).toHaveBeenCalledTimes(1);
    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.mcpServers["sweny-core"]).toEqual({ type: "sdk", name: "sweny-core" });
  });

  it("SWENY_TOOL_BRIDGE=1 turns it on; the socket is removed even when the query throws", async () => {
    vi.stubEnv("SWENY_TOOL_BRIDGE", "1");
    let socket = "";
    mockQuery.mockImplementation(({ options }: any) =>
      (async function* () {
        const cfg = options.mcpServers["sweny-core"];
        socket = cfg.args[cfg.args.indexOf("--socket") + 1];
        expect(fs.existsSync(socket)).toBe(true);
        throw new Error("agent crashed");
      })(),
    );
    const { ClaudeCodeHarness } = await import("../claude-code.js");
    const h = new ClaudeCodeHarness({ logger: silent });
    const res = await h.run({ instruction: "x", context: {}, tools: skills([])[0].tools });
    expect(res.status).toBe("failed");
    expect(socket).not.toBe("");
    expect(fs.existsSync(socket)).toBe(false);
  });
});
