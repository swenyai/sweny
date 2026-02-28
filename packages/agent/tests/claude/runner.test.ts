import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeRunner } from "../../src/claude/runner.js";
import type { RunnerConfig, RunnerResources } from "../../src/claude/runner.js";
import type { ModelRunner, RunResult, ModelRunOptions } from "../../src/model/types.js";
import type { PluginRegistry } from "../../src/plugins/registry.js";
import type { Session } from "../../src/session/manager.js";
import type { UserIdentity } from "../../src/auth/types.js";
import type { MemoryStore, MemoryEntry } from "../../src/storage/memory/types.js";
import type { WorkspaceStore } from "../../src/storage/workspace/types.js";
import type { AgentTool } from "@sweny/providers/agent-tool";
import { DENIED_TOOLS } from "../../src/claude/tool-guard.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<RunnerConfig>): RunnerConfig {
  return {
    name: "test-agent",
    maxTurns: 5,
    model: { apiKey: "sk-test" },
    ...overrides,
  };
}

function makeMemoryStore(): MemoryStore {
  return {
    getMemories: vi.fn(async () => ({ entries: [] })),
    addEntry: vi.fn(async () => ({ id: "m1", text: "", createdAt: "" })),
    removeEntry: vi.fn(async () => true),
    clearMemories: vi.fn(async () => {}),
  };
}

function makeWorkspaceStore(): WorkspaceStore {
  return {
    getManifest: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    reset: vi.fn(),
    getDownloadUrl: vi.fn(),
  } as unknown as WorkspaceStore;
}

function makeRegistry(overrides?: { sections?: string; tools?: AgentTool[] }): PluginRegistry {
  return {
    buildSystemPromptSections: vi.fn(() => overrides?.sections ?? ""),
    buildToolsForSession: vi.fn(async () => overrides?.tools ?? []),
    destroy: vi.fn(async () => {}),
  } as unknown as PluginRegistry;
}

function makeResources(overrides?: Partial<RunnerResources>): RunnerResources {
  return {
    registry: makeRegistry(),
    memoryStore: makeMemoryStore(),
    workspaceStore: makeWorkspaceStore(),
    ...overrides,
  };
}

function makeRunResult(overrides?: Partial<RunResult>): RunResult {
  return {
    response: "Hello from the model",
    sessionId: "session-123",
    toolCalls: [],
    ...overrides,
  };
}

function makeModelRunner(result?: RunResult): ModelRunner {
  return {
    run: vi.fn(async () => result ?? makeRunResult()),
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    threadKey: "thread-1",
    agentSessionId: "agent-session-1",
    userId: "user-1",
    createdAt: new Date(),
    lastActiveAt: new Date(),
    messageCount: 3,
    ...overrides,
  };
}

function makeUser(overrides?: Partial<UserIdentity>): UserIdentity {
  return {
    userId: "user-1",
    displayName: "Test User",
    roles: ["user"],
    metadata: {},
    ...overrides,
  };
}

function fakeTool(name: string): AgentTool {
  return {
    name,
    description: `Tool ${name}`,
    schema: {},
    execute: async () => ({ content: [] }),
  } as AgentTool;
}

function makeMemories(): MemoryEntry[] {
  return [
    { id: "m1", text: "Likes TypeScript", createdAt: "2025-01-01T00:00:00Z" },
    { id: "m2", text: "Prefers dark mode", createdAt: "2025-01-02T00:00:00Z" },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeRunner", () => {
  let config: RunnerConfig;
  let resources: RunnerResources;
  let modelRunner: ModelRunner;
  let runner: ClaudeRunner;

  beforeEach(() => {
    config = makeConfig();
    resources = makeResources();
    modelRunner = makeModelRunner();
    runner = new ClaudeRunner(config, resources, modelRunner);
  });

  // ---- Test 1: Passes prompt to modelRunner ----
  it("passes prompt to modelRunner", async () => {
    await runner.run({
      prompt: "What is TypeScript?",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.prompt).toBe("What is TypeScript?");
  });

  // ---- Test 2: Builds system prompt with config name ----
  it("includes config name in system prompt", async () => {
    config = makeConfig({ name: "SwenyBot" });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.systemPrompt).toContain("SwenyBot");
  });

  // ---- Test 2b: Builds system prompt with basePrompt ----
  it("includes basePrompt in system prompt when provided", async () => {
    config = makeConfig({ basePrompt: "You are a custom security assistant." });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.systemPrompt).toContain("You are a custom security assistant.");
  });

  // ---- Test 2c: Uses default prompt when basePrompt is not provided ----
  it("uses default prompt when basePrompt is not provided", async () => {
    config = makeConfig({ basePrompt: undefined });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    // The default prompt includes "helpful assistant"
    expect(runCall.systemPrompt).toContain("helpful assistant");
  });

  // ---- Test 2d: Includes formatHint in system prompt ----
  it("passes formatHint through to system prompt builder", async () => {
    config = makeConfig({ basePrompt: undefined });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
      formatHint: "discord-markdown",
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    // discord-markdown hint should produce Discord formatting instructions
    expect(runCall.systemPrompt).toContain("Discord");
  });

  // ---- Test 2e: Includes plugin sections in system prompt ----
  it("includes plugin sections in system prompt", async () => {
    const registry = makeRegistry({ sections: "## Database\nYou can query the database." });
    resources = makeResources({ registry });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.systemPrompt).toContain("## Database");
    expect(runCall.systemPrompt).toContain("You can query the database.");
  });

  // ---- Test 2f: Includes memories in system prompt ----
  it("includes memories in system prompt", async () => {
    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: makeMemories(),
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.systemPrompt).toContain("Likes TypeScript");
    expect(runCall.systemPrompt).toContain("Prefers dark mode");
    expect(runCall.systemPrompt).toContain("Things you remember about this user");
  });

  // ---- Test 3: Passes tools from registry ----
  it("passes tools from registry to modelRunner", async () => {
    const toolA = fakeTool("tool-a");
    const toolB = fakeTool("tool-b");
    const registry = makeRegistry({ tools: [toolA, toolB] });
    resources = makeResources({ registry });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.tools).toHaveLength(2);
    expect(runCall.tools).toContain(toolA);
    expect(runCall.tools).toContain(toolB);
  });

  // ---- Test 4: Passes maxTurns from config ----
  it("passes maxTurns from config to modelRunner", async () => {
    config = makeConfig({ maxTurns: 12 });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.maxTurns).toBe(12);
  });

  // ---- Test 5: Passes sessionId from session ----
  it("passes sessionId from session to modelRunner", async () => {
    const session = makeSession({ agentSessionId: "agent-sess-xyz" });

    await runner.run({
      prompt: "Hi",
      session,
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.sessionId).toBe("agent-sess-xyz");
  });

  it("passes null sessionId when session has no agentSessionId", async () => {
    const session = makeSession({ agentSessionId: null });

    await runner.run({
      prompt: "Hi",
      session,
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.sessionId).toBeNull();
  });

  // ---- Test 6: Passes DENIED_TOOLS as disallowedTools ----
  it("passes DENIED_TOOLS as disallowedTools to modelRunner", async () => {
    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.disallowedTools).toBe(DENIED_TOOLS);
    expect(runCall.disallowedTools).toContain("NotebookEdit");
  });

  // ---- Test 7: Passes config.name to modelRunner ----
  it("passes config.name to modelRunner", async () => {
    config = makeConfig({ name: "my-agent" });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.name).toBe("my-agent");
  });

  // ---- Test 8: Constructs PluginContext correctly ----
  it("constructs PluginContext with correct user identity", async () => {
    const user = makeUser({ userId: "u-42", displayName: "Alice" });
    const registry = makeRegistry();
    resources = makeResources({ registry });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user,
      memories: [],
    });

    const ctxArg = (registry.buildSystemPromptSections as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ctxArg.user.userId).toBe("u-42");
    expect(ctxArg.user.displayName).toBe("Alice");
  });

  it("constructs PluginContext with storage stores from resources", async () => {
    const memoryStore = makeMemoryStore();
    const workspaceStore = makeWorkspaceStore();
    const registry = makeRegistry();
    resources = makeResources({ registry, memoryStore, workspaceStore });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const ctxArg = (registry.buildSystemPromptSections as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ctxArg.storage.memory).toBe(memoryStore);
    expect(ctxArg.storage.workspace).toBe(workspaceStore);
  });

  it("constructs PluginContext with a logger", async () => {
    const registry = makeRegistry();
    resources = makeResources({ registry });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const ctxArg = (registry.buildSystemPromptSections as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ctxArg.logger).toBeDefined();
    expect(typeof ctxArg.logger.info).toBe("function");
    expect(typeof ctxArg.logger.error).toBe("function");
    expect(typeof ctxArg.logger.debug).toBe("function");
    expect(typeof ctxArg.logger.warn).toBe("function");
  });

  it("passes same PluginContext to both buildSystemPromptSections and buildToolsForSession", async () => {
    const registry = makeRegistry();
    resources = makeResources({ registry });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const sectionsCtx = (registry.buildSystemPromptSections as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const toolsCtx = (registry.buildToolsForSession as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Both calls should receive the same context object
    expect(sectionsCtx).toBe(toolsCtx);
  });

  // ---- Test 9: Returns modelRunner result unchanged ----
  it("returns modelRunner result unchanged", async () => {
    const expectedResult = makeRunResult({
      response: "Detailed answer",
      sessionId: "sess-99",
      toolCalls: [{ toolName: "search", toolInput: { q: "test" }, executedAt: "2025-01-01T00:00:00Z" }],
    });
    modelRunner = makeModelRunner(expectedResult);
    runner = new ClaudeRunner(config, resources, modelRunner);

    const result = await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    expect(result).toBe(expectedResult);
  });

  it("returns result with null sessionId when model returns null", async () => {
    const expectedResult = makeRunResult({ sessionId: null });
    modelRunner = makeModelRunner(expectedResult);
    runner = new ClaudeRunner(config, resources, modelRunner);

    const result = await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    expect(result.sessionId).toBeNull();
  });

  // ---- Edge cases ----
  it("handles empty plugin sections without adding blank section to prompt", async () => {
    const registry = makeRegistry({ sections: "   " });
    resources = makeResources({ registry });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    // System prompt should still be constructed, just without plugin sections
    expect(runCall.systemPrompt).toContain("test-agent");
  });

  it("handles empty memories without adding memory section to prompt", async () => {
    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.systemPrompt).not.toContain("Things you remember");
  });

  it("handles empty tools array from registry", async () => {
    const registry = makeRegistry({ tools: [] });
    resources = makeResources({ registry });
    runner = new ClaudeRunner(config, resources, modelRunner);

    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    const runCall = (modelRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRunOptions;
    expect(runCall.tools).toEqual([]);
  });

  it("calls modelRunner.run exactly once per invocation", async () => {
    await runner.run({
      prompt: "Hi",
      session: makeSession(),
      user: makeUser(),
      memories: [],
    });

    expect(modelRunner.run).toHaveBeenCalledOnce();
  });
});
