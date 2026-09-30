import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ClaudeCodeHarness behind the seam (#330): the SDK query options must be the
// ones ClaudeClient.ask / ClaudeClient.evaluate passed before the refactor.

function resultStream(result: string) {
  return (async function* () {
    yield { type: "result", subtype: "success", result };
  })();
}

function failedStream(subtype: string) {
  return (async function* () {
    yield { type: "result", subtype };
  })();
}

describe("ClaudeCodeHarness", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let mod: typeof import("./claude-code.js");
  let index: typeof import("./index.js");
  const noopLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

  beforeEach(async () => {
    mockQuery = vi.fn();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
    vi.stubEnv("SWENY_SANDBOX", "off");
    mod = await import("./claude-code.js");
    index = await import("./index.js");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** The exact options object ask()/evaluate() handed the SDK before the seam. */
  const classificationOptions = (extra: Record<string, unknown> = {}) => ({
    maxTurns: 1,
    cwd: process.cwd(),
    env: expect.any(Object),
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: [],
    mcpServers: {},
    strictMcpConfig: true,
    disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"],
    stderr: expect.any(Function),
    ...extra,
  });

  it("ask() passes the same query options as before", async () => {
    mockQuery.mockReturnValueOnce(resultStream("answer"));
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
    expect(await h.ask({ instruction: "Judge it.", context: {} })).toBe("answer");
    const call = mockQuery.mock.calls[0][0];
    expect(call.prompt).toBe("Judge it.");
    expect(call.options).toEqual(classificationOptions());
  });

  it("ask() with a per-call model passes it through", async () => {
    mockQuery.mockReturnValueOnce(resultStream("a"));
    await new mod.ClaudeCodeHarness({ logger: noopLogger() }).ask({
      instruction: "x",
      context: {},
      model: "claude-haiku-4-5",
    });
    expect(mockQuery.mock.calls[0][0].options).toEqual(classificationOptions({ model: "claude-haiku-4-5" }));
  });

  it("evaluate() passes the same query options as before (client default model only)", async () => {
    mockQuery.mockReturnValueOnce(resultStream("beta"));
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), model: "client-model" });
    const choice = await h.evaluate({
      question: "Which?",
      context: { a: 1 },
      choices: [{ id: "beta", description: "b" }],
    });
    expect(choice).toBe("beta");
    const call = mockQuery.mock.calls[0][0];
    expect(call.prompt).toBe(mod.buildEvaluatePrompt("Which?", { a: 1 }, [{ id: "beta", description: "b" }]));
    expect(call.options).toEqual(classificationOptions({ model: "client-model" }));
  });

  it("a per-call timeout adds only abortController", async () => {
    mockQuery.mockReturnValueOnce(resultStream("a"));
    await new mod.ClaudeCodeHarness({ logger: noopLogger() }).ask({ instruction: "x", context: {}, timeoutMs: 1000 });
    expect(mockQuery.mock.calls[0][0].options).toEqual(
      classificationOptions({ abortController: expect.any(AbortController) }),
    );
  });

  it("complete() returns null on a non-success result and logs per purpose", async () => {
    const logger = noopLogger();
    const h = new mod.ClaudeCodeHarness({ logger });
    mockQuery.mockReturnValueOnce(failedStream("error_during_execution"));
    expect(await h.complete({ prompt: "p", purpose: "evaluate" })).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^claude\.evaluate: SDK returned non-success subtype "error_during_execution"/),
    );
    mockQuery.mockReturnValueOnce(failedStream("error_max_turns"));
    expect(await h.complete({ prompt: "p" })).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^claude\.ask: SDK returned non-success subtype "error_max_turns"/),
    );
  });

  it("complete() returns null when the query throws; ask() maps it to the empty string, evaluate() to null", async () => {
    const logger = noopLogger();
    const h = new mod.ClaudeCodeHarness({ logger });
    mockQuery.mockImplementation(() => {
      throw new Error("sdk down");
    });
    expect(await h.complete({ prompt: "p" })).toBeNull();
    expect(await h.ask({ instruction: "x", context: {} })).toBe("");
    expect(await h.evaluate({ question: "q", context: {}, choices: [{ id: "a", description: "d" }] })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith("Ask query failed: sdk down");
    expect(logger.warn).toHaveBeenCalledWith("Evaluate query failed: sdk down. Failing closed (no route decision).");
  });

  it("run() tags the result with the harness and an empty degraded list", async () => {
    mockQuery.mockReturnValueOnce(resultStream("done"));
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("success");
    expect(r.degraded).toEqual([]);
    expect(r.harness.id).toBe("claude-code");
    expect(typeof r.harness.version).toBe("string");
    expect(r.harness.version.length).toBeGreaterThan(0);
  });

  it("a fail-closed run (sandbox strict, unsupported) is tagged too", async () => {
    vi.stubEnv("SWENY_SANDBOX", "strict");
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), sandboxProbe: () => "unsupported host" });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(r.degraded).toEqual([]);
    expect(r.harness.id).toBe("claude-code");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("declares honest capabilities and preflights ok", async () => {
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
    expect(h.id).toBe("claude-code");
    expect(h.capabilities.builtinDeny).toBe("by-name");
    expect(h.capabilities.readOnly).toBe("native");
    expect(h.capabilities.structuredOutput).toBe("native");
    expect(h.defaultJudgeModel).toBe("claude-haiku-4-5");
    expect(await h.preflight()).toMatchObject({ ok: true });
  });

  it("ClaudeClient is the same class (deprecated alias)", () => {
    expect(mod.ClaudeClient).toBe(mod.ClaudeCodeHarness);
  });

  describe("createHarness", () => {
    it("builds a ClaudeCodeHarness for claude and claude-code", () => {
      expect(index.createHarness("claude-code", { logger: noopLogger() })).toBeInstanceOf(mod.ClaudeCodeHarness);
      expect(index.createHarness("claude", { logger: noopLogger() })).toBeInstanceOf(mod.ClaudeCodeHarness);
    });

    it("unknown ids keep the original honest error", () => {
      expect(() => index.createHarness("codex")).toThrow(
        'Unsupported coding agent "codex": the only supported agent is "claude" ' +
          "(headless Claude Code). Remove --agent / coding-agent-provider or set it to claude.",
      );
    });

    it("matches the wording of the CLI validation error in cli/config.ts", async () => {
      const fs = await import("node:fs");
      const src = fs.readFileSync(new URL("../cli/config.ts", import.meta.url), "utf-8");
      expect(src).toContain("the only supported agent is");
      expect(src).toContain("(headless Claude Code). Remove --agent / coding-agent-provider or set it to claude.");
    });
  });
});
