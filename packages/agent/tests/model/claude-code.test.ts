import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the import
// ---------------------------------------------------------------------------

const mockQuery = vi.hoisted(() => vi.fn());
const mockCreateSdkMcpServer = vi.hoisted(() => vi.fn(() => ({ fake: "mcp" })));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: vi.fn((name: string, desc: string, schema: any, exec: any) => ({
    name,
    description: desc,
    schema,
    execute: exec,
  })),
}));

vi.mock("../../src/model/adapter.js", () => ({
  toSdkTools: vi.fn((tools: any[]) => tools.map((t: any) => ({ name: t.name }))),
}));

import { ClaudeCodeRunner } from "../../src/model/claude-code.js";
import type { ModelRunOptions } from "../../src/model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<ModelRunOptions> = {}): ModelRunOptions {
  return {
    prompt: "hello",
    systemPrompt: "you are a helper",
    tools: [],
    maxTurns: 5,
    ...overrides,
  };
}

/** Create an async iterable from an array of messages. */
function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { done: false as const, value: items[i++] };
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeCodeRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns response and sessionId from a successful stream", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "sess-123" },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "hi" }] },
        },
        { type: "result", subtype: "success", result: "Final answer." },
      ]),
    );

    const runner = new ClaudeCodeRunner({ apiKey: "sk-test" });
    const result = await runner.run(makeOpts());

    expect(result.response).toBe("Final answer.");
    expect(result.sessionId).toBe("sess-123");
    expect(result.toolCalls).toEqual([]);
  });

  it("collects tool calls from assistant messages", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "sess-1" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "readFile", input: { path: "/a" } },
              { type: "text", text: "reading..." },
              { type: "tool_use", name: "writeFile", input: { path: "/b", content: "x" } },
            ],
          },
        },
        { type: "result", subtype: "success", result: "done" },
      ]),
    );

    const runner = new ClaudeCodeRunner();
    const result = await runner.run(makeOpts());

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolName).toBe("readFile");
    expect(result.toolCalls[0].toolInput).toEqual({ path: "/a" });
    expect(result.toolCalls[1].toolName).toBe("writeFile");
    expect(result.toolCalls[1].toolInput).toEqual({ path: "/b", content: "x" });
    expect(result.toolCalls[0].executedAt).toBeDefined();
  });

  it("handles error_max_turns result subtype", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "sess-2" },
        { type: "result", subtype: "error_max_turns" },
      ]),
    );

    const runner = new ClaudeCodeRunner();
    const result = await runner.run(makeOpts());

    expect(result.response).toContain("maximum number of turns");
  });

  it("returns fallback response when stream has no result", async () => {
    mockQuery.mockReturnValue(asyncIter([{ type: "system", session_id: "sess-3" }]));

    const runner = new ClaudeCodeRunner();
    const result = await runner.run(makeOpts());

    expect(result.response).toBe("No response generated.");
    expect(result.sessionId).toBe("sess-3");
  });

  it("passes apiKey and oauthToken to env", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "s" },
        { type: "result", subtype: "success", result: "ok" },
      ]),
    );

    const runner = new ClaudeCodeRunner({
      apiKey: "sk-key",
      oauthToken: "oauth-tok",
    });
    await runner.run(makeOpts());

    const callOpts = mockQuery.mock.calls[0][0].options;
    expect(callOpts.env.ANTHROPIC_API_KEY).toBe("sk-key");
    expect(callOpts.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-tok");
  });

  it("passes sessionId as resume option", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "resumed" },
        { type: "result", subtype: "success", result: "ok" },
      ]),
    );

    const runner = new ClaudeCodeRunner();
    await runner.run(makeOpts({ sessionId: "prev-sess" }));

    const callOpts = mockQuery.mock.calls[0][0].options;
    expect(callOpts.resume).toBe("prev-sess");
  });

  it("does not pass resume when sessionId is null", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "new" },
        { type: "result", subtype: "success", result: "ok" },
      ]),
    );

    const runner = new ClaudeCodeRunner();
    await runner.run(makeOpts({ sessionId: null }));

    const callOpts = mockQuery.mock.calls[0][0].options;
    expect(callOpts.resume).toBeUndefined();
  });

  it("passes custom env, cwd, name, maxTurns, disallowedTools", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "s" },
        { type: "result", subtype: "success", result: "ok" },
      ]),
    );

    const runner = new ClaudeCodeRunner();
    await runner.run(
      makeOpts({
        env: { MY_VAR: "hello" },
        cwd: "/workspace",
        name: "my-agent",
        maxTurns: 10,
        disallowedTools: ["dangerousTool"],
      }),
    );

    const call = mockQuery.mock.calls[0][0];
    expect(call.prompt).toBe("hello");
    expect(call.options.maxTurns).toBe(10);
    expect(call.options.cwd).toBe("/workspace");
    expect(call.options.disallowedTools).toEqual(["dangerousTool"]);
    expect(call.options.env.MY_VAR).toBe("hello");

    // MCP server should use the custom name
    expect(mockCreateSdkMcpServer).toHaveBeenCalledWith(expect.objectContaining({ name: "my-agent" }));
    expect(call.options.mcpServers).toHaveProperty("my-agent");
  });

  it("defaults cwd to /tmp and name to sweny", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "s" },
        { type: "result", subtype: "success", result: "ok" },
      ]),
    );

    const runner = new ClaudeCodeRunner();
    await runner.run(makeOpts());

    const call = mockQuery.mock.calls[0][0];
    expect(call.options.cwd).toBe("/tmp");
    expect(call.options.mcpServers).toHaveProperty("sweny");
  });

  it("handles tool_use with missing input gracefully", async () => {
    mockQuery.mockReturnValue(
      asyncIter([
        { type: "system", session_id: "s" },
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", name: "myTool", input: undefined }],
          },
        },
        { type: "result", subtype: "success", result: "done" },
      ]),
    );

    const runner = new ClaudeCodeRunner();
    const result = await runner.run(makeOpts());

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolInput).toEqual({});
  });
});
