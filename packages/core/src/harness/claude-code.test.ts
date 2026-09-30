import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodePolicy } from "./types.js";

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

  it("run() fails closed when the stream ends without a result, keeping tool calls and warning", async () => {
    const logger = noopLogger();
    mockQuery.mockReturnValueOnce(
      (async function* () {
        yield {
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "t1", name: "lookup", input: { q: 1 } }] },
        };
      })(),
    );
    const h = new mod.ClaudeCodeHarness({ logger });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(r.data.error).toBe("agent stream ended without a result message");
    expect(r.data.summary).toBeUndefined();
    expect(r.toolCalls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ended without a result message"));
  });

  it("complete() returns null when the stream ends without a result; ask() maps it to the empty string", async () => {
    const logger = noopLogger();
    const h = new mod.ClaudeCodeHarness({ logger });
    mockQuery.mockReturnValueOnce((async function* () {})());
    expect(await h.complete({ prompt: "p", purpose: "evaluate" })).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^claude\.evaluate: agent stream ended without a result message/),
    );
    mockQuery.mockReturnValueOnce((async function* () {})());
    expect(await h.ask({ instruction: "x", context: {} })).toBe("");
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
    expect(r.data.refused).toBe(true);
    expect(r.degraded).toEqual([]);
    expect(r.harness.id).toBe("claude-code");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("declares honest capabilities and preflights ok", async () => {
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), authProbe: () => ({ ok: true, via: "test" }) });
    expect(h.id).toBe("claude-code");
    expect(h.capabilities.builtinDeny).toBe("by-name");
    expect(h.capabilities.readOnly).toBe("native");
    expect(h.capabilities.structuredOutput).toBe("native");
    expect(h.defaultJudgeModel).toBe("claude-haiku-4-5");
    expect(await h.preflight()).toMatchObject({ ok: true });
  });

  it("preflight fails with the login fix when Claude Code has no auth (#339)", async () => {
    const h = new mod.ClaudeCodeHarness({
      logger: noopLogger(),
      authProbe: () => ({ ok: false, reason: "Claude Code has no login. Set ANTHROPIC_API_KEY" }),
    });
    const pre = await h.preflight();
    expect(pre.ok).toBe(false);
    expect(!pre.ok && pre.reason).toMatch(/Claude Code has no login/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  describe("policy compile (#365)", () => {
    const policy = (over: Partial<NodePolicy> = {}): NodePolicy => ({
      readOnly: false,
      deny: [],
      egress: [],
      strict: false,
      ...over,
    });

    it("a strict request refuses an unsupported host even when the client sandbox is off", async () => {
      mockQuery.mockReturnValueOnce(resultStream("must not run"));
      const probe = vi.fn(() => "unsupported host");
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), sandbox: "off", sandboxProbe: probe });
      const result = await h.run({
        instruction: "x",
        context: {},
        tools: [],
        policy: policy({ sandbox: "strict" }),
      });
      expect(result.status).toBe("failed");
      expect(result.data.refused).toBe(true);
      expect(probe).toHaveBeenCalledOnce();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("a supported strict request uses its policy hosts and preserves legacy env access", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      vi.stubEnv("SWENY_REQUEST_TEST_KEY", "synthetic-value");
      const h = new mod.ClaudeCodeHarness({
        logger: noopLogger(),
        sandbox: "off",
        sandboxProbe: () => undefined,
        envScope: true,
      });
      const result = await h.run({
        instruction: "x",
        context: {},
        tools: [],
        agentAccess: { domains: ["legacy.example.test"], envVars: ["SWENY_REQUEST_TEST_KEY"] },
        policy: policy({ sandbox: "strict", egress: ["policy.example.test"] }),
      });
      expect(result.status).toBe("success");
      const options = mockQuery.mock.calls[0][0].options;
      expect(options.sandbox.enabled).toBe(true);
      expect(options.sandbox.network.allowedDomains).toContain("policy.example.test");
      expect(options.sandbox.network.allowedDomains).not.toContain("legacy.example.test");
      expect(options.env.SWENY_REQUEST_TEST_KEY).toBe("synthetic-value");
    });

    it("policy.deny classes reach the SDK as native disallowedTools, merged with the legacy names", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
      await h.run({
        instruction: "x",
        context: {},
        tools: [],
        disallowedTools: ["Glob"],
        policy: policy({ deny: ["shell", "net"], nativeDeny: ["Glob"] }),
      });
      const opts = mockQuery.mock.calls[0][0].options;
      expect(opts.disallowedTools).toEqual(["Glob", "Bash", "WebFetch", "WebSearch"]);
      expect(opts.strictMcpConfig).toBeUndefined();
    });

    it("every class compiles to at least one native name", () => {
      for (const c of ["shell", "write", "edit", "net", "subagent"] as const) {
        expect(mod.compileClaudeCodeDeny(policy({ deny: [c] })).length, c).toBeGreaterThan(0);
      }
    });

    it("policy.readOnly alone is a read-only run (no legacy flag needed)", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({
        logger: noopLogger(),
        mcpServers: { github: { type: "http", url: "https://example.test/mcp" } },
      });
      await h.run({ instruction: "x", context: {}, tools: [], policy: policy({ readOnly: true }) });
      const opts = mockQuery.mock.calls[0][0].options;
      for (const t of mod.READ_ONLY_DISALLOWED_TOOLS) expect(opts.disallowedTools).toContain(t);
      expect(opts.mcpServers).toBeUndefined();
      expect(opts.strictMcpConfig).toBe(true);
    });

    it("strict makes MCP exclusive on a write-capable node", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({
        logger: noopLogger(),
        mcpServers: { github: { type: "http", url: "https://example.test/mcp" } },
      });
      await h.run({ instruction: "x", context: {}, tools: [], policy: policy({ strict: true }) });
      const opts = mockQuery.mock.calls[0][0].options;
      expect(opts.strictMcpConfig).toBe(true);
      // Still write-capable: its own servers stay, no built-in is denied.
      expect(Object.keys(opts.mcpServers)).toEqual(["github"]);
      expect(opts.disallowedTools).toBeUndefined();
    });

    it("without a policy the legacy fields behave exactly as before", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
      await h.run({ instruction: "x", context: {}, tools: [], disallowedTools: ["Bash"] });
      const opts = mockQuery.mock.calls[0][0].options;
      expect(opts.disallowedTools).toEqual(["Bash"]);
      expect(opts.strictMcpConfig).toBeUndefined();
    });
  });

  it("ClaudeClient is the same class (deprecated alias)", () => {
    expect(mod.ClaudeClient).toBe(mod.ClaudeCodeHarness);
  });

  describe("createHarness", () => {
    it("builds a ClaudeCodeHarness for claude and claude-code", () => {
      expect(index.createHarness("claude-code", { logger: noopLogger() })).toBeInstanceOf(mod.ClaudeCodeHarness);
      expect(index.createHarness("claude", { logger: noopLogger() })).toBeInstanceOf(mod.ClaudeCodeHarness);
    });

    it("ids without an adapter keep an honest error", () => {
      expect(() => index.createHarness("gemini")).toThrow(
        'Unsupported coding agent "gemini": supported agents are "claude" (headless Claude Code) ' +
          'and "codex" (Codex CLI), or "pi" (pi coding agent, experimental). Remove --agent / coding-agent-provider or set it to one of them.',
      );
    });

    it("the CLI validation error in cli/config.ts uses the same words", async () => {
      const fs = await import("node:fs");
      const src = fs.readFileSync(new URL("../cli/config.ts", import.meta.url), "utf-8");
      expect(src).toContain("errors.push(unsupportedAgentError(config.codingAgentProvider));");
    });
  });
});
