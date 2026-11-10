/**
 * Least-privilege built-ins and deterministic tool loading on Claude Code.
 *
 * Dogfood runs 42890245104 (failed) and 42890468912 (passed, `verbose: true`),
 * same core 0.1.206: the pr-risk-review scope node's agent was given 23 tools,
 * among them CronCreate, PushNotification, RemoteTrigger, SendMessage,
 * EnterWorktree, DesignSync, Workflow and ToolSearch, next to the two skill
 * tools it had to call. Bundled CLI 0.3.319, init message per flag, no model call:
 *
 *   --tools Read,Grep,Glob                  -> Glob, Grep, Read, StructuredOutput, mcp__probe__list_files
 *   (no --tools), ENABLE_TOOL_SEARCH unset  -> ...23 built-ins..., ToolSearch, mcp__probe__list_files
 *   (no --tools), ENABLE_TOOL_SEARCH=false  -> the same without ToolSearch
 *
 * So a node gets an explicit built-in allow-list (SDK `tools`; sdk.d.ts:
 * "Specify the base set of available built-in tools", while `allowedTools` only
 * auto-approves: "To restrict which tools are available, use the `tools` option
 * instead"), and tool search is off whenever every MCP server loads up front.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodePolicy } from "./types.js";

/** Tools a sweny node must never be handed unless it opts in (none can today). */
const NEVER = [
  "SendMessage",
  "ListAgents",
  "RemoteTrigger",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "PushNotification",
  "EnterWorktree",
  "ExitWorktree",
  "DesignSync",
  "Workflow",
  "Skill",
  "ReportFindings",
  "TaskStop",
  "Monitor",
  "ToolSearch",
];

function done() {
  return (async function* () {
    yield { type: "result", subtype: "success", result: "done" };
  })();
}

describe("Claude Code built-in tool allow-list", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let mod: typeof import("./claude-code.js");
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  const policy = (over: Partial<NodePolicy> = {}): NodePolicy => ({
    readOnly: false,
    deny: [],
    egress: [],
    strict: false,
    ...over,
  });

  beforeEach(async () => {
    mockQuery = vi.fn().mockImplementation(done);
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
    vi.stubEnv("SWENY_SANDBOX", "off");
    vi.stubEnv("SWENY_TOOL_BRIDGE", "");
    mod = await import("./claude-code.js");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const optionsFor = async (req: Record<string, unknown>) => {
    await new mod.ClaudeCodeHarness({ logger: logger(), envScope: false }).run({
      instruction: "x",
      context: {},
      tools: [],
      ...req,
    });
    return mockQuery.mock.calls.at(-1)![0].options;
  };

  it("a read-only node gets exactly Read, Grep, Glob and WebSearch", async () => {
    const opts = await optionsFor({ policy: policy({ readOnly: true }) });
    expect(opts.tools).toEqual(["Read", "Grep", "Glob", "WebSearch"]);
  });

  it("the legacy readOnly flag gets the same read-only list", async () => {
    const opts = await optionsFor({ readOnly: true });
    expect(opts.tools).toEqual(["Read", "Grep", "Glob", "WebSearch"]);
  });

  it("a write node gets the file, shell, net and subagent built-ins, nothing else", async () => {
    const opts = await optionsFor({ policy: policy() });
    expect(opts.tools).toEqual([
      "Read",
      "Grep",
      "Glob",
      "Bash",
      "Write",
      "NotebookEdit",
      "Edit",
      "MultiEdit",
      "WebFetch",
      "WebSearch",
      "Task",
      "Agent",
    ]);
  });

  it("a request with no policy at all gets the write list, never the full preset", async () => {
    const opts = await optionsFor({});
    expect(opts.tools).toEqual(mod.claudeCodeBuiltinTools({ readOnly: false }));
    expect(opts.tools).not.toContain("SendMessage");
  });

  it.each([
    ["read-only", { readOnly: true }],
    ["write", {}],
    ["strict write", { strict: true }],
  ])(
    "a %s node never gets agent-to-agent, scheduling, remote, notification, worktree or design tools",
    async (_n, over) => {
      const opts = await optionsFor({ policy: policy(over) });
      for (const t of NEVER) expect(opts.tools).not.toContain(t);
    },
  );

  it("tools.deny classes and legacy disallowed names leave the allow-list too", async () => {
    const opts = await optionsFor({ policy: policy({ deny: ["shell", "net"], nativeDeny: ["Task"] }) });
    expect(opts.tools).toEqual(["Read", "Grep", "Glob", "Write", "NotebookEdit", "Edit", "MultiEdit", "Agent"]);
    // The deny list still goes to the SDK as before: belt and braces.
    expect(opts.disallowedTools).toEqual(expect.arrayContaining(["Bash", "WebFetch", "WebSearch", "Task"]));
  });

  it("a read-only node with net denied keeps only Read, Grep and Glob", async () => {
    const opts = await optionsFor({ policy: policy({ readOnly: true, deny: ["net"] }) });
    expect(opts.tools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("permissions.native: none still removes every built-in", async () => {
    const opts = await optionsFor({ policy: policy({ nativeNone: true }) });
    expect(opts.tools).toEqual([]);
  });

  it("claudeCodeBuiltinTools: path-scoped deny rules do not remove a tool", () => {
    expect(mod.claudeCodeBuiltinTools({ readOnly: true }, ["Read(//tmp/state/**)"])).toContain("Read");
  });

  describe("tool search", () => {
    it("is off when the node has no MCP server at all", async () => {
      const opts = await optionsFor({ policy: policy() });
      expect(opts.env.ENABLE_TOOL_SEARCH).toBe("false");
      expect(opts.tools).not.toContain("ToolSearch");
    });

    it("is off when every server loads up front (sweny-core and the node's skill servers)", async () => {
      const opts = await optionsFor({
        policy: policy(),
        tools: [{ name: "lookup", description: "d", input_schema: { type: "object" }, handler: async () => ({}) }],
        mcpServers: { tickets: { type: "http", url: "https://tickets.invalid/mcp" } },
      });
      expect(opts.mcpServers.tickets.alwaysLoad).toBe(true);
      expect(opts.mcpServers["sweny-core"]).toBeDefined();
      expect(opts.env.ENABLE_TOOL_SEARCH).toBe("false");
      expect(opts.tools).not.toContain("ToolSearch");
    });

    it("overrides an ENABLE_TOOL_SEARCH the parent env carries", async () => {
      vi.stubEnv("ENABLE_TOOL_SEARCH", "true");
      const opts = await optionsFor({ policy: policy() });
      expect(opts.env.ENABLE_TOOL_SEARCH).toBe("false");
    });

    it("stays available when a server defers its tools (explicit alwaysLoad: false)", async () => {
      const opts = await optionsFor({
        policy: policy(),
        mcpServers: { tickets: { type: "http", url: "https://tickets.invalid/mcp", alwaysLoad: false } },
      });
      expect(opts.env.ENABLE_TOOL_SEARCH).not.toBe("false");
      expect(opts.tools).toContain("ToolSearch");
    });

    it("stays available when a client-level server is not marked alwaysLoad", async () => {
      await new mod.ClaudeCodeHarness({
        logger: logger(),
        envScope: false,
        mcpServers: { catalog: { type: "http", url: "https://catalog.invalid/mcp" } as any },
      }).run({ instruction: "x", context: {}, tools: [], policy: policy() });
      const opts = mockQuery.mock.calls.at(-1)![0].options;
      expect(opts.tools).toContain("ToolSearch");
      expect(opts.env.ENABLE_TOOL_SEARCH).not.toBe("false");
    });
  });

  describe("tool list logging", () => {
    function initThenDone(tools: string[]) {
      return (async function* () {
        yield { type: "system", subtype: "init", tools, mcp_servers: [{ name: "sweny-core", status: "connected" }] };
        yield { type: "result", subtype: "success", result: "done" };
      })();
    }

    it("logs the agent's tool names at info, never their inputs", async () => {
      mockQuery.mockImplementationOnce(() => initThenDone(["Read", "StructuredOutput"]));
      const log = logger();
      await new mod.ClaudeCodeHarness({ logger: log, envScope: false }).run({
        instruction: "x",
        context: {},
        tools: [],
      });
      expect(log.info).toHaveBeenCalledWith("  agent tools: Read, StructuredOutput");
    });

    it("warns, naming them, when a node tool is missing from the agent's tool list", async () => {
      mockQuery.mockImplementationOnce(() => initThenDone(["Read", "StructuredOutput", "mcp__sweny-core__get_issue"]));
      const log = logger();
      const t = (name: string) => ({
        name,
        description: "d",
        input_schema: { type: "object" },
        handler: async () => ({}),
      });
      await new mod.ClaudeCodeHarness({ logger: log, envScope: false }).run({
        instruction: "x",
        context: {},
        tools: [t("get_issue"), t("list_pr_files")],
      });
      const warned = log.warn.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(warned).toContain("  node tools missing from the agent's tool list: list_pr_files");
    });
  });
});
