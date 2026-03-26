import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test tryParseJSON indirectly since it's not exported.
// We also test ClaudeClient by mocking the Anthropic SDK.

// ─── tryParseJSON tests (via exported behavior) ──────────────────

// Since tryParseJSON is private, we test it through a re-export for testing
// Or we can test the extraction logic directly by copying it
// Let's test the extraction strategies directly:

describe("JSON extraction strategies", () => {
  // Replicate the tryParseJSON logic for testing
  function tryParseJSON(text: string): Record<string, unknown> {
    // 1. Code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch {
        /* try next strategy */
      }
    }

    // 2. Last brace-delimited block
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
            /* try next strategy */
          }
          break;
        }
      }
    }

    // 3. Full text parse
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

// We mock the Anthropic SDK to test ClaudeClient behavior
describe("ClaudeClient", () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let ClaudeClient: any;

  beforeEach(async () => {
    mockCreate = vi.fn();

    // Mock the Anthropic SDK
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: mockCreate };
        constructor() {}
      },
    }));

    // Re-import to get mocked version
    const mod = await import("../claude.js");
    ClaudeClient = mod.ClaudeClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sends instruction and context in user message", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"done": true}' }],
      stop_reason: "end_turn",
    });

    const client = new ClaudeClient({ apiKey: "test" });
    await client.run({
      instruction: "Analyze the logs",
      context: { alert: "cpu spike" },
      tools: [],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("Analyze the logs");
    expect(callArgs.messages[0].content).toContain("cpu spike");
  });

  it("returns success with parsed JSON data", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: 'Analysis complete.\n```json\n{"severity": "high"}\n```' }],
      stop_reason: "end_turn",
    });

    const client = new ClaudeClient({ apiKey: "test" });
    const result = await client.run({
      instruction: "Check severity",
      context: {},
      tools: [],
    });

    expect(result.status).toBe("success");
    expect(result.data.severity).toBe("high");
  });

  it("executes tool calls in a loop", async () => {
    // First response: tool use
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "tu_1", name: "my_tool", input: { x: 1 } }],
      stop_reason: "tool_use",
    });
    // Second response: end turn
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"result": "done"}' }],
      stop_reason: "end_turn",
    });

    const handler = vi.fn().mockResolvedValue({ output: "tool_result" });

    const client = new ClaudeClient({ apiKey: "test" });
    const result = await client.run({
      instruction: "Do work",
      context: {},
      tools: [{ name: "my_tool", description: "test", input_schema: {}, handler }],
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("my_tool");
  });

  it("handles tool errors gracefully", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "tu_1", name: "bad_tool", input: {} }],
      stop_reason: "tool_use",
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Failed" }],
      stop_reason: "end_turn",
    });

    const handler = vi.fn().mockRejectedValue(new Error("tool broke"));

    const client = new ClaudeClient({ apiKey: "test" });
    const result = await client.run({
      instruction: "x",
      context: {},
      tools: [{ name: "bad_tool", description: "d", input_schema: {}, handler }],
    });

    expect(result.toolCalls[0].output).toEqual({ error: "tool broke" });
  });

  it("handles unknown tool names", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "tu_1", name: "unknown_tool", input: {} }],
      stop_reason: "tool_use",
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const client = new ClaudeClient({ apiKey: "test" });
    const result = await client.run({
      instruction: "x",
      context: {},
      tools: [], // no tools registered
    });

    // Should still complete without crashing
    expect(result.status).toBe("success");
  });

  it("returns failed on max turns exceeded", async () => {
    // Always return tool_use to force infinite loop
    mockCreate.mockResolvedValue({
      content: [{ type: "tool_use", id: "tu", name: "t", input: {} }],
      stop_reason: "tool_use",
    });

    const client = new ClaudeClient({ apiKey: "test", maxTurns: 2 });
    const result = await client.run({
      instruction: "x",
      context: {},
      tools: [{ name: "t", description: "d", input_schema: {}, handler: async () => "ok" }],
    });

    expect(result.status).toBe("failed");
    expect(result.data.reason).toContain("max turns");
  });

  it("evaluate returns exact match", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "handle_high" }],
    });

    const client = new ClaudeClient({ apiKey: "test" });
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
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I think the answer is handle_low based on the data" }],
    });

    const client = new ClaudeClient({ apiKey: "test" });
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
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I'm not sure" }],
    });

    const client = new ClaudeClient({ apiKey: "test" });
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

  it("uses default context for tool handlers", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "tu_1", name: "ctx_tool", input: {} }],
      stop_reason: "tool_use",
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
    });

    let capturedCtx: any = null;
    const handler = vi.fn().mockImplementation((_input: any, ctx: any) => {
      capturedCtx = ctx;
      return "result";
    });

    const client = new ClaudeClient({ apiKey: "test" });
    await client.run({
      instruction: "x",
      context: {},
      tools: [{ name: "ctx_tool", description: "d", input_schema: {}, handler }],
    });

    // Default context should be provided, not undefined
    expect(capturedCtx).toBeDefined();
    expect(capturedCtx.config).toBeDefined();
    expect(capturedCtx.logger).toBeDefined();
  });
});
