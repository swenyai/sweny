import { describe, expect, it, vi } from "vitest";
import { buildRetryPreamble, formatEvalFailures } from "../retry.js";
import type { Claude, EvalResult, ToolCall, Logger } from "../types.js";

const tc = (tool: string, output?: unknown): ToolCall => ({ tool, input: {}, output });

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function fakeClaude(askResult: string | (() => string) | (() => Promise<string>)): Claude {
  return {
    run: async () => ({ status: "success", data: {}, toolCalls: [] }),
    evaluate: async () => "x",
    ask: vi.fn(async () => {
      if (typeof askResult === "function") return askResult();
      return askResult;
    }),
  };
}

describe("formatEvalFailures", () => {
  it("renders one bullet per failure as 'name (kind): reasoning'", () => {
    const out = formatEvalFailures([
      { name: "called", kind: "function", pass: false, reasoning: "missing tool" },
      { name: "shape", kind: "value", pass: false, reasoning: "wrong field" },
    ]);
    expect(out).toContain("- called (function): missing tool");
    expect(out).toContain("- shape (value): wrong field");
  });

  it("falls back to 'no reasoning' when an evaluator emitted none", () => {
    expect(formatEvalFailures([{ name: "x", kind: "value", pass: false }])).toContain("x (value): no reasoning");
  });

  it("returns a placeholder when given an empty list", () => {
    expect(formatEvalFailures([])).toMatch(/no failing evaluators/);
  });
});

describe("buildRetryPreamble", () => {
  const evalFailures: EvalResult[] = [
    { name: "issue_tool", kind: "function", pass: false, reasoning: "required one of [foo]" },
  ];
  const nodeInstruction = "Open a PR with the fix";

  it("uses default preamble when no instruction is provided", async () => {
    const claude = fakeClaude("");
    const result = await buildRetryPreamble({
      retry: { max: 1 },
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(result).toMatch(/Previous attempt failed evaluation/);
    expect(result).toContain("issue_tool (function): required one of [foo]");
    expect(claude.ask).not.toHaveBeenCalled();
  });

  it("uses static string preamble when instruction is a string", async () => {
    const claude = fakeClaude("");
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: "Remember to call linear_create_issue first." },
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(result).toContain("Remember to call linear_create_issue first.");
    expect(result).toContain("issue_tool (function): required one of [foo]");
    expect(claude.ask).not.toHaveBeenCalled();
  });

  it("calls claude.ask with default reflection prompt when instruction.auto is true", async () => {
    const claude = fakeClaude("Diagnosis: you forgot to call foo. Strategy: call foo first.");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      evalFailures,
      context: {},
      toolCalls: [tc("bar", { ok: true })],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(askSpy).toHaveBeenCalledOnce();
    const callArg = askSpy.mock.calls[0][0];
    expect(callArg.instruction).toMatch(/Briefly diagnose the failure/);
    expect(callArg.instruction).toContain(nodeInstruction);
    expect(callArg.instruction).toContain("issue_tool (function): required one of [foo]");
    expect(callArg.instruction).toContain("bar");
    expect(result).toContain("Diagnosis: you forgot to call foo");
    expect(result).toContain("issue_tool (function): required one of [foo]");
  });

  it("calls claude.ask with author prompt when instruction.reflect is set", async () => {
    const claude = fakeClaude("Custom diagnosis.");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    await buildRetryPreamble({
      retry: { max: 1, instruction: { reflect: "Focus on the missing tool calls only." } },
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    const callArg = askSpy.mock.calls[0][0];
    expect(callArg.instruction).toContain("Focus on the missing tool calls only.");
    expect(callArg.instruction).toContain("issue_tool (function): required one of [foo]");
  });

  it("falls back to default preamble when claude.ask throws", async () => {
    const claude = fakeClaude(() => {
      throw new Error("network exploded");
    });
    const warnSpy = vi.fn();
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction,
      claude,
      logger,
    });
    expect(result).toMatch(/Previous attempt failed evaluation/);
    expect(result).toContain("issue_tool (function): required one of [foo]");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/reflection/i);
  });

  it("falls back to default preamble when claude.ask returns empty string", async () => {
    const claude = fakeClaude("   ");
    const warnSpy = vi.fn();
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction,
      claude,
      logger,
    });
    expect(result).toMatch(/Previous attempt failed evaluation/);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("includes tool call summary in reflection prompt (names + ok/error)", async () => {
    const claude = fakeClaude("ok");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      evalFailures,
      context: {},
      toolCalls: [tc("foo", { ok: true }), tc("bar", { error: "boom" })],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    const promptText = askSpy.mock.calls[0][0].instruction as string;
    expect(promptText).toContain("foo");
    expect(promptText).toContain("bar");
    expect(promptText).toMatch(/error/i);
  });

  it("falls back to default preamble when claude.ask returns whitespace-only string", async () => {
    const warnSpy = vi.fn();
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const claude = fakeClaude("\n\n\t   ");
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction,
      claude,
      logger,
    });
    expect(result).toMatch(/Previous attempt failed evaluation/);
    expect(result).toContain("issue_tool (function): required one of [foo]");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/empty/i);
  });

  it("produces a correct preamble even when nodeInstruction contains the default header verbatim", async () => {
    const tricky = "## Previous attempt failed evaluation\nDo the thing anyway.";
    const claude = fakeClaude("Here is my diagnosis.");
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction: tricky,
      claude,
      logger: silentLogger,
    });
    expect(result).toMatch(/^## Reflection on previous attempt/);
    expect(result).toContain("Here is my diagnosis.");
    expect(result).toContain("issue_tool (function): required one of [foo]");
  });

  it("uses empty string as reflect prompt when reflect is '' (documents current behavior)", async () => {
    const claude = fakeClaude("diagnosis from empty reflect.");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    await buildRetryPreamble({
      retry: { max: 1, instruction: { reflect: "" } } as Parameters<typeof buildRetryPreamble>[0]["retry"],
      evalFailures,
      context: {},
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(askSpy).toHaveBeenCalledOnce();
    const sentInstruction = askSpy.mock.calls[0][0].instruction as string;
    expect(sentInstruction).not.toContain("Briefly diagnose");
    expect(sentInstruction).toContain("issue_tool (function): required one of [foo]");
  });
});
