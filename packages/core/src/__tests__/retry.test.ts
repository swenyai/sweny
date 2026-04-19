import { describe, expect, it, vi } from "vitest";
import { buildRetryPreamble } from "../retry.js";
import type { Claude, ToolCall, Logger } from "../types.js";

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

describe("buildRetryPreamble", () => {
  const verifyError = "verify failed:\n  - any_tool_called: required one of [foo]";
  const nodeInstruction = "Open a PR with the fix";

  it("uses default preamble when no instruction is provided", async () => {
    const claude = fakeClaude("");
    const result = await buildRetryPreamble({
      retry: { max: 1 },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(result).toMatch(/Previous attempt failed verification/);
    expect(result).toContain(verifyError);
    expect(claude.ask).not.toHaveBeenCalled();
  });

  it("uses static string preamble when instruction is a string", async () => {
    const claude = fakeClaude("");
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: "Remember to call linear_create_issue first." },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(result).toContain("Remember to call linear_create_issue first.");
    expect(result).toContain(verifyError);
    expect(claude.ask).not.toHaveBeenCalled();
  });

  it("calls claude.ask with default reflection prompt when instruction.auto is true", async () => {
    const claude = fakeClaude("Diagnosis: you forgot to call foo. Strategy: call foo first.");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
      toolCalls: [tc("bar", { ok: true })],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(askSpy).toHaveBeenCalledOnce();
    const callArg = askSpy.mock.calls[0][0];
    expect(callArg.instruction).toMatch(/Briefly diagnose the failure/);
    expect(callArg.instruction).toContain(nodeInstruction);
    expect(callArg.instruction).toContain(verifyError);
    expect(callArg.instruction).toContain("bar");
    expect(result).toContain("Diagnosis: you forgot to call foo");
    expect(result).toContain(verifyError);
  });

  it("calls claude.ask with author prompt when instruction.reflect is set", async () => {
    const claude = fakeClaude("Custom diagnosis.");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    await buildRetryPreamble({
      retry: { max: 1, instruction: { reflect: "Focus on the missing tool calls only." } },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    const callArg = askSpy.mock.calls[0][0];
    expect(callArg.instruction).toContain("Focus on the missing tool calls only.");
    expect(callArg.instruction).toContain(verifyError);
  });

  it("falls back to default preamble when claude.ask throws", async () => {
    const claude = fakeClaude(() => {
      throw new Error("network exploded");
    });
    const warnSpy = vi.fn();
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger,
    });
    expect(result).toMatch(/Previous attempt failed verification/);
    expect(result).toContain(verifyError);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/reflection/i);
  });

  it("falls back to default preamble when claude.ask returns empty string", async () => {
    const claude = fakeClaude("   ");
    const warnSpy = vi.fn();
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger,
    });
    expect(result).toMatch(/Previous attempt failed verification/);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("includes tool call summary in reflection prompt (names + ok/error)", async () => {
    const claude = fakeClaude("ok");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
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
});
