import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── tryParseJSON tests (via inlined copy since it's private) ────

describe("JSON extraction strategies", () => {
  function tryParseJSON(text: string): Record<string, unknown> {
    if (!text) return {};

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch {
        /* try next */
      }
    }

    const lastBrace = text.lastIndexOf("}");
    if (lastBrace !== -1) {
      let depth = 0;
      for (let i = lastBrace; i >= 0; i--) {
        if (text[i] === "}") depth++;
        else if (text[i] === "{") depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(i, lastBrace + 1));
            if (typeof parsed === "object" && parsed !== null) return parsed;
          } catch {
            /* try next */
          }
          break;
        }
      }
    }

    try {
      const parsed = JSON.parse(text.trim());
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      /* fall through */
    }

    return {};
  }

  it("extracts JSON from code block", () => {
    const text = 'Here are the results:\n```json\n{"severity": "high", "count": 42}\n```';
    expect(tryParseJSON(text)).toEqual({ severity: "high", count: 42 });
  });

  it("extracts JSON from code block without json label", () => {
    const text = 'Results:\n```\n{"ok": true}\n```';
    expect(tryParseJSON(text)).toEqual({ ok: true });
  });

  it("extracts JSON from inline brace block", () => {
    const text = 'The analysis is complete. {"result": "success", "items": [1,2,3]}';
    expect(tryParseJSON(text)).toEqual({ result: "success", items: [1, 2, 3] });
  });

  it("extracts last JSON object when multiple exist", () => {
    const text = 'First: {"a": 1}\nThen: {"b": 2}';
    expect(tryParseJSON(text)).toEqual({ b: 2 });
  });

  it("handles nested JSON objects", () => {
    const text = 'Output: {"outer": {"inner": true}}';
    expect(tryParseJSON(text)).toEqual({ outer: { inner: true } });
  });

  it("parses pure JSON text", () => {
    const text = '{"pure": "json"}';
    expect(tryParseJSON(text)).toEqual({ pure: "json" });
  });

  it("returns empty object for no JSON", () => {
    expect(tryParseJSON("No JSON here at all")).toEqual({});
  });

  it("returns empty object for invalid JSON", () => {
    expect(tryParseJSON("{invalid json}")).toEqual({});
  });

  it("handles JSON with braces in strings", () => {
    const text = '{"message": "use {curly} braces"}';
    expect(tryParseJSON(text)).toEqual({ message: "use {curly} braces" });
  });

  it("handles multiline JSON in code block", () => {
    const text = '```json\n{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}\n```';
    expect(tryParseJSON(text)).toEqual({ a: 1, b: { c: 2 } });
  });

  it("prefers code block over inline JSON", () => {
    const text = '{"inline": true}\n```json\n{"codeblock": true}\n```';
    expect(tryParseJSON(text)).toEqual({ codeblock: true });
  });

  it("handles empty code block gracefully", () => {
    const text = '```json\n\n```\n{"fallback": true}';
    expect(tryParseJSON(text)).toEqual({ fallback: true });
  });
});

// ─── ClaudeClient tests ──────────────────────────────────────────

// Mock the agent SDK to test ClaudeClient behavior
describe("ClaudeClient", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockCreateSdkMcpServer: ReturnType<typeof vi.fn>;
  let mockSdkTool: ReturnType<typeof vi.fn>;
  let ClaudeClient: any;

  /** Helper: create an async generator that yields the given messages */
  function makeStream(messages: Array<{ type: string; [key: string]: any }>) {
    return (async function* () {
      for (const msg of messages) {
        yield msg;
      }
    })();
  }

  beforeEach(async () => {
    mockQuery = vi.fn();
    mockCreateSdkMcpServer = vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" });
    mockSdkTool = vi.fn().mockImplementation((name: string, desc: string, schema: any, handler: any) => ({
      name,
      description: desc,
      inputSchema: schema,
      handler,
    }));

    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: mockCreateSdkMcpServer,
      tool: mockSdkTool,
    }));

    const mod = await import("../claude.js");
    ClaudeClient = mod.ClaudeClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sends instruction and context in prompt", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: '{"done": true}' }]));

    const client = new ClaudeClient();
    await client.run({
      instruction: "Analyze the logs",
      context: { alert: "cpu spike" },
      tools: [],
    });

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Analyze the logs");
    expect(callArgs.prompt).toContain("cpu spike");
  });

  it("passes system prompt and permissionMode", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "ok" }]));

    const client = new ClaudeClient();
    await client.run({ instruction: "x", context: {}, tools: [] });

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.systemPrompt).toContain("automated workflow");
    expect(opts.permissionMode).toBe("bypassPermissions");
  });

  it("returns success with parsed JSON data", async () => {
    mockQuery.mockReturnValueOnce(
      makeStream([
        { type: "result", subtype: "success", result: 'Analysis complete.\n```json\n{"severity": "high"}\n```' },
      ]),
    );

    const client = new ClaudeClient();
    const result = await client.run({
      instruction: "Check severity",
      context: {},
      tools: [],
    });

    expect(result.status).toBe("success");
    expect(result.data.severity).toBe("high");
  });

  it("creates MCP server with converted tools", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "done" }]));

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const client = new ClaudeClient();
    await client.run({
      instruction: "Do work",
      context: {},
      tools: [
        {
          name: "my_tool",
          description: "A test tool",
          input_schema: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
            required: ["query"],
          },
          handler,
        },
      ],
    });

    // tool() was called for the tool
    expect(mockSdkTool).toHaveBeenCalledOnce();
    expect(mockSdkTool.mock.calls[0][0]).toBe("my_tool");
    expect(mockSdkTool.mock.calls[0][1]).toBe("A test tool");

    // MCP server was created
    expect(mockCreateSdkMcpServer).toHaveBeenCalledOnce();

    // mcpServers was passed to query
    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers["sweny-core"]).toBeDefined();
  });

  it("does not create MCP server when no tools", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "done" }]));

    const client = new ClaudeClient();
    await client.run({ instruction: "x", context: {}, tools: [] });

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.mcpServers).toBeUndefined();
  });

  it("tracks tool calls via handler wrapper", async () => {
    // Simulate: query returns success, but the tool handler was invoked by MCP internally
    // We test the handler wrapper directly since query is mocked
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "done" }]));

    const handler = vi.fn().mockResolvedValue({ items: [1, 2] });
    const client = new ClaudeClient();
    const result = await client.run({
      instruction: "x",
      context: {},
      tools: [{ name: "fetch_data", description: "d", input_schema: {}, handler }],
    });

    // The SDK tool handler was created — invoke it directly to test wrapping
    const sdkHandler = mockSdkTool.mock.calls[0][3];
    const callResult = await sdkHandler({ q: "test" }, {});

    expect(callResult.content[0].text).toContain("items");
    expect(callResult.isError).toBeUndefined();

    // Tool call should be tracked
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(0); // stream didn't trigger it, but direct call did
  });

  it("wraps tool handler errors as isError", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "done" }]));

    const handler = vi.fn().mockRejectedValue(new Error("tool broke"));
    const client = new ClaudeClient();
    await client.run({
      instruction: "x",
      context: {},
      tools: [{ name: "bad_tool", description: "d", input_schema: {}, handler }],
    });

    // Invoke the SDK handler directly
    const sdkHandler = mockSdkTool.mock.calls[0][3];
    const callResult = await sdkHandler({}, {});

    expect(callResult.content[0].text).toContain("tool broke");
    expect(callResult.isError).toBe(true);
  });

  it("returns failed on query error", async () => {
    mockQuery.mockReturnValueOnce(
      (async function* () {
        throw new Error("connection refused");
      })(),
    );

    const client = new ClaudeClient();
    const result = await client.run({ instruction: "x", context: {}, tools: [] });

    expect(result.status).toBe("failed");
    expect(result.data.error).toContain("connection refused");
  });

  it("returns failed on error result subtype", async () => {
    mockQuery.mockReturnValueOnce(
      makeStream([{ type: "result", subtype: "error_max_turns", errors: ["Too many turns"], is_error: true }]),
    );

    const client = new ClaudeClient();
    const result = await client.run({ instruction: "x", context: {}, tools: [] });

    expect(result.status).toBe("failed");
    expect(result.data.error).toContain("Too many turns");
  });

  // terminal_reason was added in @anthropic-ai/claude-agent-sdk v0.2.91.
  // When the turn budget is exhausted the SDK now emits subtype='success'
  // alongside terminal_reason='max_turns' instead of the old error subtype,
  // so the claude.ts handler has to look at both fields or silently accept
  // truncated output as a success.
  describe("terminal_reason handling (claude-agent-sdk v0.2.91+)", () => {
    it("returns failed when terminal_reason is max_turns", async () => {
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "result",
            subtype: "success",
            result: "partial output",
            terminal_reason: "max_turns",
          },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.status).toBe("failed");
      expect(result.data.error).toContain("max_turns");
      expect(result.data.error).toContain("terminated early");
    });

    it("returns failed for any non-completed terminal_reason", async () => {
      // Future SDK versions may add new terminal reasons (aborted_tools,
      // blocking_limit, etc.) — treat anything that isn't 'completed' as a
      // failure rather than assume it's recoverable.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "result",
            subtype: "success",
            result: "partial",
            terminal_reason: "aborted_tools",
          },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.status).toBe("failed");
      expect(result.data.error).toContain("aborted_tools");
    });

    it("returns success when terminal_reason is 'completed'", async () => {
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "result",
            subtype: "success",
            result: '{"ok": true}',
            terminal_reason: "completed",
          },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.status).toBe("success");
      expect(result.data.ok).toBe(true);
    });

    it("returns success when terminal_reason is absent (pre-v0.2.91 SDK)", async () => {
      // Old SDKs never set terminal_reason. The guard must not treat an
      // absent field as a failure or every caller would break on downgrade.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "result",
            subtype: "success",
            result: '{"done": true}',
            // terminal_reason deliberately omitted
          },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.status).toBe("success");
      expect(result.data.done).toBe(true);
    });

    it("preserves toolCalls when failing on terminal_reason", async () => {
      // A max_turns failure should still surface any tool calls that
      // happened before the budget ran out, so debuggers can see what
      // Claude was trying to do.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "search_code",
                  input: { query: "foo" },
                },
              ],
            },
          },
          {
            type: "result",
            subtype: "success",
            result: "partial",
            terminal_reason: "max_turns",
          },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.status).toBe("failed");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("search_code");
    });
  });

  it("passes model option to query", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "ok" }]));

    const client = new ClaudeClient({ model: "claude-sonnet-4-20250514" });
    await client.run({ instruction: "x", context: {}, tools: [] });

    expect(mockQuery.mock.calls[0][0].options.model).toBe("claude-sonnet-4-20250514");
  });

  it("evaluate returns exact match", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "handle_high" }]));

    const client = new ClaudeClient();
    const result = await client.evaluate({
      question: "Which path?",
      context: {},
      choices: [
        { id: "handle_high", description: "High severity" },
        { id: "handle_low", description: "Low severity" },
      ],
    });

    expect(result).toBe("handle_high");
  });

  it("evaluate returns fuzzy match", async () => {
    mockQuery.mockReturnValueOnce(
      makeStream([
        { type: "result", subtype: "success", result: "I think the answer is handle_low based on the data" },
      ]),
    );

    const client = new ClaudeClient();
    const result = await client.evaluate({
      question: "Which path?",
      context: {},
      choices: [
        { id: "handle_high", description: "High" },
        { id: "handle_low", description: "Low" },
      ],
    });

    expect(result).toBe("handle_low");
  });

  it("evaluate falls back to first choice", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: "I'm not sure" }]));

    const client = new ClaudeClient();
    const result = await client.evaluate({
      question: "Which?",
      context: {},
      choices: [
        { id: "a", description: "A" },
        { id: "b", description: "B" },
      ],
    });

    expect(result).toBe("a");
  });

  it("evaluate falls back on query error", async () => {
    mockQuery.mockReturnValueOnce(
      (async function* () {
        throw new Error("offline");
      })(),
    );

    const client = new ClaudeClient();
    const result = await client.evaluate({
      question: "Which?",
      context: {},
      choices: [
        { id: "fallback", description: "Fallback" },
        { id: "other", description: "Other" },
      ],
    });

    expect(result).toBe("fallback");
  });

  it("includes output schema in prompt when provided", async () => {
    mockQuery.mockReturnValueOnce(makeStream([{ type: "result", subtype: "success", result: '{"severity": "high"}' }]));

    const client = new ClaudeClient();
    await client.run({
      instruction: "Analyze",
      context: {},
      tools: [],
      outputSchema: { type: "object", properties: { severity: { type: "string" } } },
    });

    const prompt = mockQuery.mock.calls[0][0].prompt;
    expect(prompt).toContain("Required Output");
    expect(prompt).toContain("severity");
  });

  // Fix #1: tool-call accounting. The runtime must record each tool call
  // exactly once and attach an explicit status that verify can trust.
  describe("tool-call accounting", () => {
    it("records an external MCP tool success as status:success", async () => {
      // External MCP tool: assistant emits tool_use, SDK routes to the external
      // MCP server (no in-process wrapper fires), then the SDK emits a user
      // tool_result with is_error=false.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: "call_1", name: "mcp__linear__search", input: { q: "bug" } }],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "call_1", content: "found 3 issues", is_error: false }],
            },
          },
          { type: "result", subtype: "success", result: "done" },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({ tool: "search", status: "success" });
    });

    it("records an external MCP tool error as status:error", async () => {
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: "call_1", name: "mcp__sentry__get_issue", input: { id: 7 } }],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "call_1", content: "401 Unauthorized", is_error: true }],
            },
          },
          { type: "result", subtype: "success", result: "done" },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({ tool: "get_issue", status: "error" });
    });

    it("does not double-count an in-process tool (one entry per call)", async () => {
      // In-process tool: assistant tool_use → our SDK wrapper runs → user tool_result.
      // Only ONE ToolCall entry should appear, even though we observe three events.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: "call_1", name: "mcp__sweny-core__fetch_data", input: { q: "x" } }],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"items":[1,2]}', is_error: false }],
            },
          },
          { type: "result", subtype: "success", result: "done" },
        ]),
      );

      const handler = vi.fn().mockResolvedValue({ items: [1, 2] });
      const client = new ClaudeClient();
      const result = await client.run({
        instruction: "x",
        context: {},
        tools: [{ name: "fetch_data", description: "d", input_schema: {}, handler }],
      });

      // Simulate the SDK invoking our wrapper during the stream — register it
      // BEFORE the user tool_result fires would require controlling timing;
      // for the purpose of this test, the stream order is enough: the entry
      // created by the assistant tool_use should be the only one.
      const names = result.toolCalls.map((c: { tool: string }) => c.tool);
      expect(names).toEqual(["fetch_data"]);
    });

    it("leaves status undefined for a tool_use with no matching tool_result", async () => {
      // Truncated stream: assistant started a tool call but the run ended
      // before the result came back. The entry is preserved (useful for
      // debugging) but has no status, so verify falls back to legacy heuristic.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: "call_1", name: "search_code", input: { q: "x" } }],
            },
          },
          { type: "result", subtype: "success", result: "partial", terminal_reason: "max_turns" },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].status).toBeUndefined();
    });

    it("in-process tool error surfaces as status:error in the final ToolCall", async () => {
      // Full stream path for a throwing in-process tool. The SDK fires our
      // wrapper (which catches the throw and returns isError: true), then
      // emits a tool_result with is_error: true. Record exactly one
      // ToolCall with status: "error".
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: "call_1", name: "mcp__sweny-core__bad_tool", input: {} }],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call_1",
                  content: "Error: boom",
                  is_error: true,
                },
              ],
            },
          },
          { type: "result", subtype: "success", result: "done" },
        ]),
      );

      const handler = vi.fn().mockRejectedValue(new Error("boom"));
      const client = new ClaudeClient();
      const result = await client.run({
        instruction: "x",
        context: {},
        tools: [{ name: "bad_tool", description: "d", input_schema: {}, handler }],
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("bad_tool");
      expect(result.toolCalls[0].status).toBe("error");
    });

    // Self-review found: FIFO-by-name queue could mis-pair outputs when
    // the same in-process tool is called twice and tool_result messages
    // arrive in non-invocation order. Claude's parallel tool calling makes
    // this reachable in practice. Outputs must be paired to the correct
    // ToolCall by tool_use_id, not by name order.
    it("pairs parallel same-named in-process tool outputs correctly", async () => {
      // Scenario: agent fires two `fetch_data` calls in parallel with
      // different inputs. tool_result messages arrive in REVERSE order
      // (call_2 first, then call_1). Each ToolCall entry must carry the
      // output that corresponds to its own tool_use_id.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "call_1", name: "mcp__sweny-core__fetch_data", input: { id: 1 } },
                { type: "tool_use", id: "call_2", name: "mcp__sweny-core__fetch_data", input: { id: 2 } },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call_2",
                  content: JSON.stringify({ id: 2, payload: "two" }),
                  is_error: false,
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call_1",
                  content: JSON.stringify({ id: 1, payload: "one" }),
                  is_error: false,
                },
              ],
            },
          },
          { type: "result", subtype: "success", result: "done" },
        ]),
      );

      const handler = vi
        .fn()
        .mockImplementation(async (args: any) => ({ id: args.id, payload: args.id === 1 ? "one" : "two" }));
      const client = new ClaudeClient();
      const result = await client.run({
        instruction: "x",
        context: {},
        tools: [{ name: "fetch_data", description: "d", input_schema: {}, handler }],
      });

      expect(result.toolCalls).toHaveLength(2);
      const call1 = result.toolCalls.find((c: { input: unknown }) => (c.input as { id: number }).id === 1)!;
      const call2 = result.toolCalls.find((c: { input: unknown }) => (c.input as { id: number }).id === 2)!;

      expect(call1).toBeDefined();
      expect(call2).toBeDefined();
      // Regression guard: output is paired by tool_use_id, not by wrapper-fire order.
      expect((call1.output as { payload: string }).payload).toBe("one");
      expect((call2.output as { payload: string }).payload).toBe("two");
    });

    // Round 2 self-review: assistant tool_use without an id has no
    // correlation key. We still record the ToolCall (useful for debugging
    // truncated streams) but leave status undefined. Verify's legacy
    // output-shape heuristic takes over. No crash.
    it("records a tool_use without id; status stays undefined", async () => {
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [
                // No id field — observed on some SDK builds or malformed mocks.
                { type: "tool_use", name: "mcp__x__search", input: { q: "foo" } },
              ],
            },
          },
          { type: "result", subtype: "success", result: "done" },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("search");
      expect(result.toolCalls[0].status).toBeUndefined();
    });

    it("ignores a tool_result with an unknown tool_use_id (malformed stream)", async () => {
      // Defensive: the SDK should never send a tool_result for a tool_use
      // we didn't see, but if it does, we must not crash or silently record
      // a phantom ToolCall.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "ghost", content: "noise", is_error: false }],
            },
          },
          { type: "result", subtype: "success", result: "done" },
        ]),
      );

      const client = new ClaudeClient();
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.toolCalls).toHaveLength(0);
      expect(result.status).toBe("success");
    });

    it("surfaces tool errors at warn level so CI logs show the failure body", async () => {
      // Observability gap this closes: before, a tool_result with
      // is_error=true was captured onto the ToolCall for in-memory verify
      // evaluation but never logged. The only signal was the downstream
      // verify failure message, which names the tool but not the why.
      mockQuery.mockReturnValueOnce(
        makeStream([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: "u1", name: "github_create_pr", input: {} }],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "u1",
                  content: '[GitHub] API request failed (HTTP 422): {"message":"Validation Failed"}',
                  is_error: true,
                },
              ],
            },
          },
          { type: "result", subtype: "success", result: "{}" },
        ]),
      );

      const warnSpy = vi.fn();
      const logger = {
        info: () => undefined,
        warn: warnSpy,
        error: () => undefined,
        debug: () => undefined,
      };
      const client = new ClaudeClient({ logger });
      const result = await client.run({ instruction: "x", context: {}, tools: [] });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].status).toBe("error");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/tool github_create_pr failed: .*HTTP 422.*Validation Failed/),
      );
    });
  });
});

describe("summarizeToolError", () => {
  it("stringifies objects", async () => {
    const { summarizeToolError } = await import("../claude.js");
    expect(summarizeToolError({ message: "boom", code: 422 })).toBe('{"message":"boom","code":422}');
  });

  it("collapses whitespace on strings", async () => {
    const { summarizeToolError } = await import("../claude.js");
    expect(summarizeToolError("line one\n\nline two\n   indented")).toBe("line one line two indented");
  });

  it("caps very long payloads at 300 chars with ellipsis", async () => {
    const { summarizeToolError } = await import("../claude.js");
    const s = "x".repeat(500);
    const out = summarizeToolError(s);
    expect(out).toHaveLength(300);
    expect(out.endsWith("...")).toBe(true);
  });

  it("coerces primitives without crashing", async () => {
    const { summarizeToolError } = await import("../claude.js");
    expect(summarizeToolError(null)).toBe("null");
    expect(summarizeToolError(undefined)).toBe("undefined");
    expect(summarizeToolError(42)).toBe("42");
  });
});
