/**
 * #380: `--dry-run` must never take a write action.
 *
 * Contract under `input.dryRun === true`:
 *  - Every node receives only skill tools classified `access: "read"`.
 *    A tool with no `access` is treated as a write (fail safe).
 *  - Withheld write tools are recorded on the node result (`skippedWrites`).
 *  - The Claude client is told the node is read-only (`readOnly: true`), which
 *    drops external MCP servers and write-capable built-ins (Bash, Write, ...).
 *  - The run still stops at the first conditional edge (deterministic path).
 *
 * Non-dry-run behavior is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execute } from "../executor.js";
import { builtinSkills, createSkillMap } from "../skills/index.js";
import { createFileSkill } from "../testing.js";
import type { Claude, NodeResult, Skill, Tool, Workflow } from "../types.js";

// ─── Fixtures ────────────────────────────────────────────────────

function makeSkills(calls: string[]): Skill[] {
  const tool = (name: string, access?: "read" | "write"): Tool => ({
    name,
    description: name,
    input_schema: { type: "object" },
    ...(access ? { access } : {}),
    handler: async () => {
      calls.push(name);
      return { ok: true };
    },
  });
  return [
    {
      id: "reader",
      name: "Reader",
      description: "read-only lookups",
      category: "general",
      config: {},
      tools: [tool("read_pr", "read")],
    },
    {
      id: "poster",
      name: "Poster",
      description: "posts comments",
      category: "general",
      config: {},
      tools: [tool("get_thread", "read"), tool("post_comment", "write"), tool("mystery_tool")],
    },
  ];
}

const linearWorkflow: Workflow = {
  id: "pr-review-like",
  name: "PR review (linear)",
  description: "fetch -> review -> post; no conditional edges",
  entry: "fetch",
  nodes: {
    fetch: { name: "Fetch", instruction: "Fetch the diff", skills: ["reader"] },
    review: { name: "Review", instruction: "Review the diff", skills: ["reader"] },
    post: { name: "Post", instruction: "Post a review comment", skills: ["poster"], disallowed_tools: ["WebSearch"] },
  },
  edges: [
    { from: "fetch", to: "review" },
    { from: "review", to: "post" },
  ],
};

type RunOpts = Parameters<Claude["run"]>[0];

/**
 * A worst-case agent: at every node it invokes EVERY tool it was handed.
 * If a write tool is reachable at all under dry-run, this agent will call it.
 */
function greedyClaude() {
  const runs: RunOpts[] = [];
  const claude: Claude = {
    async run(opts) {
      runs.push(opts);
      const toolCalls = [];
      for (const t of opts.tools) {
        const output = await t.handler({}, { config: {}, logger: silent });
        toolCalls.push({ tool: t.name, input: {}, output });
      }
      return { status: "success", data: { summary: "ok" }, toolCalls } as NodeResult;
    },
    async evaluate() {
      throw new Error("route evaluation must not run in this test");
    },
    async ask() {
      return "";
    },
  };
  return { claude, runs };
}

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function runOpts(runs: RunOpts[], nodeInstruction: string): RunOpts {
  const r = runs.find((o) => o.instruction.includes(nodeInstruction));
  if (!r) throw new Error(`no run for "${nodeInstruction}"`);
  return r;
}

// ─── Executor ────────────────────────────────────────────────────

describe("dry-run never writes (#380)", () => {
  it("linear 3-node workflow: the write skill on the last node never fires", async () => {
    const calls: string[] = [];
    const { claude, runs } = greedyClaude();

    const { results } = await execute(
      linearWorkflow,
      { dryRun: true },
      { skills: createSkillMap(makeSkills(calls)), claude, config: {}, logger: silent },
    );

    // All three nodes still run (analysis is useful), in order.
    expect(runs).toHaveLength(3);
    expect([...results.keys()]).toEqual(["fetch", "review", "post"]);
    // Reads happened; no write handler was ever invoked.
    expect(calls).toContain("read_pr");
    expect(calls).toContain("get_thread");
    expect(calls).not.toContain("post_comment");
    expect(calls).not.toContain("mystery_tool");
  });

  it("a write tool is not in the tool list passed to the agent", async () => {
    const { claude, runs } = greedyClaude();
    await execute(
      linearWorkflow,
      { dryRun: true },
      { skills: createSkillMap(makeSkills([])), claude, config: {}, logger: silent },
    );

    const post = runOpts(runs, "Post a review comment");
    expect(post.tools.map((t) => t.name)).toEqual(["get_thread"]);
    for (const r of runs) {
      expect(r.tools.map((t) => t.name)).not.toContain("post_comment");
      expect(r.readOnly).toBe(true);
    }
  });

  it("an unclassified tool (no access field) is treated as write", async () => {
    const { claude, runs } = greedyClaude();
    const { results } = await execute(
      linearWorkflow,
      { dryRun: true },
      { skills: createSkillMap(makeSkills([])), claude, config: {}, logger: silent },
    );

    expect(runOpts(runs, "Post a review comment").tools.map((t) => t.name)).not.toContain("mystery_tool");
    expect(results.get("post")!.skippedWrites).toEqual(["post_comment", "mystery_tool"]);
  });

  it("records skipped write intents and tells the agent which tools were withheld", async () => {
    const { claude, runs } = greedyClaude();
    const { results } = await execute(
      linearWorkflow,
      { dryRun: true },
      { skills: createSkillMap(makeSkills([])), claude, config: {}, logger: silent },
    );

    // Read-only nodes carry no skippedWrites field.
    expect(results.get("fetch")!.skippedWrites).toBeUndefined();
    const post = runOpts(runs, "Post a review comment");
    expect(post.instruction).toContain("Dry run");
    expect(post.instruction).toContain("post_comment");
    // Node's own disallowed_tools still pass through untouched.
    expect(post.disallowedTools).toEqual(["WebSearch"]);
  });

  it("still stops at the first conditional edge (no route evaluation, deterministic path)", async () => {
    const { claude, runs } = greedyClaude();
    const wf: Workflow = {
      ...linearWorkflow,
      edges: [
        { from: "fetch", to: "review" },
        { from: "review", to: "post", when: "there are findings" },
      ],
    };
    const { results } = await execute(
      wf,
      { dryRun: true },
      { skills: createSkillMap(makeSkills([])), claude, config: {}, logger: silent },
    );
    expect(runs).toHaveLength(2);
    expect(results.has("post")).toBe(false);
  });

  it("applies after a node's tools.allow filter (allow cannot re-admit a write tool)", async () => {
    const calls: string[] = [];
    const { claude, runs } = greedyClaude();
    const wf: Workflow = {
      ...linearWorkflow,
      nodes: { ...linearWorkflow.nodes, post: { ...linearWorkflow.nodes.post, tools: { allow: ["post_comment"] } } },
    };
    await execute(
      wf,
      { dryRun: true },
      { skills: createSkillMap(makeSkills(calls)), claude, config: {}, logger: silent },
    );
    expect(runOpts(runs, "Post a review comment").tools).toEqual([]);
    expect(calls).not.toContain("post_comment");
  });

  it("non-dry-run: behavior unchanged (all tools passed, writes fire, no readOnly flag)", async () => {
    const calls: string[] = [];
    const { claude, runs } = greedyClaude();
    const { results } = await execute(
      linearWorkflow,
      {},
      { skills: createSkillMap(makeSkills(calls)), claude, config: {}, logger: silent },
    );

    const post = runOpts(runs, "Post a review comment");
    expect(post.tools.map((t) => t.name)).toEqual(["get_thread", "post_comment", "mystery_tool"]);
    expect(post.instruction).not.toContain("Dry run");
    expect(post.disallowedTools).toEqual(["WebSearch"]);
    for (const r of runs) expect(r.readOnly).toBeUndefined();
    expect(calls).toContain("post_comment");
    expect(calls).toContain("mystery_tool");
    expect(results.get("post")!.skippedWrites).toBeUndefined();
  });

  it("dryRun: false is a normal run", async () => {
    const { claude, runs } = greedyClaude();
    await execute(
      linearWorkflow,
      { dryRun: false },
      { skills: createSkillMap(makeSkills([])), claude, config: {}, logger: silent },
    );
    expect(runOpts(runs, "Post a review comment").tools.map((t) => t.name)).toContain("post_comment");
  });
});

// ─── Built-in skill classification ───────────────────────────────

describe("built-in skill tools declare access explicitly (#380)", () => {
  const all = [...builtinSkills, createFileSkill("/tmp/unused")];

  it("every built-in tool has access: read | write", () => {
    const missing = all.flatMap((s) =>
      s.tools.filter((t) => t.access !== "read" && t.access !== "write").map((t) => `${s.id}.${t.name}`),
    );
    expect(missing).toEqual([]);
  });

  it("known writes are classified write", () => {
    const access = new Map(all.flatMap((s) => s.tools.map((t) => [t.name, t.access] as const)));
    for (const name of [
      "github_create_issue",
      "github_add_comment",
      "github_create_pr",
      "linear_create_issue",
      "linear_add_comment",
      "linear_update_issue",
      "slack_send_message",
      "slack_send_thread_reply",
      "notify_webhook",
      "notify_discord",
      "notify_teams",
      "supabase_insert",
      "supabase_update",
      "supabase_delete",
      "supabase_rpc",
      "supabase_invoke_function",
      "fs_write_json",
      "fs_write_markdown",
    ]) {
      expect([name, access.get(name)]).toEqual([name, "write"]);
    }
  });

  it("analysis tools are classified read", () => {
    const access = new Map(all.flatMap((s) => s.tools.map((t) => [t.name, t.access] as const)));
    for (const name of [
      "github_search_code",
      "github_get_issue",
      "github_search_issues",
      "github_list_recent_commits",
      "github_get_file",
      "linear_search_issues",
      "linear_get_issue",
      "sentry_list_issues",
      "datadog_search_logs",
      "betterstack_query",
      "supabase_query",
      "fs_read_json",
    ]) {
      expect([name, access.get(name)]).toEqual([name, "read"]);
    }
  });
});

// ─── ClaudeClient read-only mode ─────────────────────────────────

describe("ClaudeClient readOnly (#380)", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let ClaudeClient: any;
  let READ_ONLY_DISALLOWED_TOOLS: readonly string[];

  function doneStream() {
    return (async function* () {
      yield { type: "result", subtype: "success", result: "{}" };
    })();
  }

  beforeEach(async () => {
    vi.resetModules();
    mockQuery = vi.fn().mockImplementation(() => doneStream());
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn().mockImplementation((name: string) => ({ name })),
    }));
    const mod = await import("../claude.js");
    ClaudeClient = mod.ClaudeClient;
    READ_ONLY_DISALLOWED_TOOLS = mod.READ_ONLY_DISALLOWED_TOOLS;
  });

  afterEach(() => {
    vi.doUnmock("@anthropic-ai/claude-agent-sdk");
    vi.resetModules();
  });

  const readTool: Tool = {
    name: "read_pr",
    description: "",
    input_schema: { type: "object" },
    access: "read",
    handler: async () => ({}),
  };

  it("drops external MCP servers and disallows write-capable built-ins", async () => {
    const client = new ClaudeClient({ mcpServers: { github: { type: "http", url: "https://example.com/mcp" } } });
    await client.run({
      instruction: "x",
      context: {},
      tools: [readTool],
      readOnly: true,
      disallowedTools: ["WebSearch"],
    });

    const opts = mockQuery.mock.calls[0][0].options;
    expect(Object.keys(opts.mcpServers)).toEqual(["sweny-core"]);
    for (const t of ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      expect(opts.disallowedTools).toContain(t);
    }
    expect(opts.disallowedTools).toContain("WebSearch");
    expect(READ_ONLY_DISALLOWED_TOOLS).toContain("Bash");
  });

  it("read-only with no skill tools passes no MCP servers at all", async () => {
    const client = new ClaudeClient({ mcpServers: { github: { type: "http", url: "https://example.com/mcp" } } });
    await client.run({ instruction: "x", context: {}, tools: [], readOnly: true });
    expect(mockQuery.mock.calls[0][0].options.mcpServers).toBeUndefined();
  });

  it("without readOnly, external MCP servers and built-ins are unchanged", async () => {
    const client = new ClaudeClient({ mcpServers: { github: { type: "http", url: "https://example.com/mcp" } } });
    await client.run({ instruction: "x", context: {}, tools: [readTool] });
    const opts = mockQuery.mock.calls[0][0].options;
    expect(Object.keys(opts.mcpServers).sort()).toEqual(["github", "sweny-core"]);
    expect(opts.disallowedTools).toBeUndefined();
  });
});
