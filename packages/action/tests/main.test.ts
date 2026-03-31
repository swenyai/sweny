import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Persistent mock functions (survive vi.resetModules())
// ---------------------------------------------------------------------------

const mockSetFailed = vi.fn();
const mockSetOutput = vi.fn();
const mockStartGroup = vi.fn();
const mockEndGroup = vi.fn();
const mockInfo = vi.fn();
const mockParseInputs = vi.fn();
const mockValidateInputs = vi.fn();
const mockExecute = vi.fn();
const mockCreateSkillMap = vi.fn().mockReturnValue(new Map());
const mockConfiguredSkills = vi.fn().mockReturnValue([]);
const mockBuildAutoMcpServers = vi.fn().mockReturnValue({});
const mockResolveTemplates = vi.fn().mockResolvedValue({ issueTemplate: "", prTemplate: "" });
const mockLoadAdditionalContext = vi.fn().mockResolvedValue({ resolved: "", urls: [] });
const mockLoadConfigFile = vi.fn().mockReturnValue({});

/** Track ClaudeClient constructor calls */
let claudeClientArgs: unknown[] = [];

// ---------------------------------------------------------------------------
// Helper: re-register all doMocks and dynamically import main.ts fresh
// ---------------------------------------------------------------------------

async function loadMain() {
  vi.resetModules();
  claudeClientArgs = [];
  vi.doMock("@actions/core", () => {
    const summaryObj = { addRaw: vi.fn().mockReturnThis(), write: vi.fn().mockResolvedValue(undefined) };
    return {
      getInput: vi.fn().mockReturnValue(""),
      getBooleanInput: vi.fn().mockReturnValue(false),
      setFailed: mockSetFailed,
      setOutput: mockSetOutput,
      startGroup: mockStartGroup,
      endGroup: mockEndGroup,
      info: mockInfo,
      debug: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      summary: summaryObj,
    };
  });
  vi.doMock("@sweny-ai/core", () => ({
    execute: mockExecute,
    ClaudeClient: class MockClaudeClient {
      constructor(...args: unknown[]) {
        claudeClientArgs = args;
      }
    },
    createSkillMap: mockCreateSkillMap,
    configuredSkills: mockConfiguredSkills,
    buildAutoMcpServers: mockBuildAutoMcpServers,
    buildProviderContext: vi.fn().mockReturnValue(""),
    consoleLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    resolveTemplates: mockResolveTemplates,
    loadAdditionalContext: mockLoadAdditionalContext,
    loadConfigFile: mockLoadConfigFile,
  }));
  vi.doMock("@sweny-ai/core/workflows", () => ({
    triageWorkflow: { id: "triage", name: "triage", entry: "investigate", nodes: {}, edges: [] },
    implementWorkflow: { id: "implement", name: "implement", entry: "implement", nodes: {}, edges: [] },
  }));
  vi.doMock("../src/config.js", () => ({
    parseInputs: mockParseInputs,
    validateInputs: mockValidateInputs,
  }));
  await import("../src/main.js");
}

// ---------------------------------------------------------------------------
// Default config returned by parseInputs in most tests
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  workflow: "triage" as const,
  anthropicApiKey: "sk-ant-test",
  claudeOauthToken: "",
  observabilityProvider: "datadog",
  observabilityCredentials: { apiKey: "k", appKey: "a", site: "datadoghq.com" },
  issueTrackerProvider: "github-issues",
  sourceControlProvider: "github",
  codingAgentProvider: "claude",
  notificationProvider: "github-summary",
  repository: "org/repo",
  repositoryOwner: "org",
  linearApiKey: "",
  linearTeamId: "",
  linearBugLabelId: "",
  linearTriageLabelId: "",
  linearStateBacklog: "",
  linearStateInProgress: "",
  linearStatePeerReview: "",
  timeRange: "24h",
  severityFocus: "errors",
  serviceFilter: "*",
  investigationDepth: "standard",
  maxInvestigateTurns: 50,
  maxImplementTurns: 30,
  baseBranch: "main",
  prLabels: [],
  dryRun: false,
  noveltyMode: false,
  linearIssue: "",
  additionalInstructions: "",
  serviceMapPath: ".github/service-map.yml",
  githubToken: "gh_test",
  botToken: "",
  jiraBaseUrl: "",
  jiraEmail: "",
  jiraApiToken: "",
  gitlabToken: "",
  gitlabProjectId: "",
  gitlabBaseUrl: "https://gitlab.com",
  notificationWebhookUrl: "",
  sendgridApiKey: "",
  emailFrom: "",
  emailTo: "",
  webhookSigningSecret: "",
  openaiApiKey: "",
  geminiApiKey: "",
  logFilePath: "",
  mcpServers: {},
  workspaceTools: [],
  reviewMode: "review",
  outputDir: ".github/sweny-output",
  issueTemplate: "",
  prTemplate: "",
  additionalContext: [],
};

// ---------------------------------------------------------------------------
// Shared beforeEach: reset all mocks and set up happy-path defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockParseInputs.mockReturnValue(DEFAULT_CONFIG);
  mockValidateInputs.mockReturnValue([]);
  mockExecute.mockResolvedValue(new Map());
  mockCreateSkillMap.mockReturnValue(new Map());
  mockConfiguredSkills.mockReturnValue([]);
  mockBuildAutoMcpServers.mockReturnValue({});
  mockResolveTemplates.mockResolvedValue({ issueTemplate: "", prTemplate: "" });
  mockLoadAdditionalContext.mockResolvedValue({ resolved: "", urls: [] });
  mockLoadConfigFile.mockReturnValue({});
});

// ---------------------------------------------------------------------------
// describe: run() orchestration
// ---------------------------------------------------------------------------

describe("run() orchestration", () => {
  it("calls parseInputs, validateInputs, and execute in sequence", async () => {
    const callOrder: string[] = [];
    mockParseInputs.mockImplementation(() => {
      callOrder.push("parseInputs");
      return DEFAULT_CONFIG;
    });
    mockValidateInputs.mockImplementation(() => {
      callOrder.push("validateInputs");
      return [];
    });
    mockExecute.mockImplementation(async () => {
      callOrder.push("execute");
      return new Map();
    });

    await loadMain();

    expect(callOrder).toEqual(["parseInputs", "validateInputs", "execute"]);
  });

  it("calls core.setFailed with joined validation errors and skips execute", async () => {
    mockValidateInputs.mockReturnValue(["Error 1", "Error 2"]);

    await loadMain();

    expect(mockSetFailed).toHaveBeenCalledWith("Error 1\nError 2");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("passes triageWorkflow to execute when workflow is triage", async () => {
    await loadMain();

    const [workflow] = mockExecute.mock.calls[0];
    expect(workflow).toMatchObject({ id: "triage" });
  });

  it("passes implementWorkflow to execute when workflow is implement", async () => {
    mockParseInputs.mockReturnValue({ ...DEFAULT_CONFIG, workflow: "implement" as const });

    await loadMain();

    const [workflow] = mockExecute.mock.calls[0];
    expect(workflow).toMatchObject({ id: "implement" });
  });

  it("calls core.setFailed with error.message when execute throws Error", async () => {
    mockExecute.mockRejectedValue(new Error("workflow exploded"));

    await loadMain();

    expect(mockSetFailed).toHaveBeenCalledWith("workflow exploded");
  });

  it("calls core.setFailed with generic message when execute throws non-Error", async () => {
    mockExecute.mockRejectedValue("plain string error");

    await loadMain();

    expect(mockSetFailed).toHaveBeenCalledWith("An unexpected error occurred");
  });

  it("passes buildAutoMcpServers result to ClaudeClient", async () => {
    const fakeMcpServers = { github: { type: "stdio", command: "npx" } };
    mockBuildAutoMcpServers.mockReturnValue(fakeMcpServers);

    await loadMain();

    expect(claudeClientArgs[0]).toMatchObject({ mcpServers: fakeMcpServers });
  });
});

// ---------------------------------------------------------------------------
// describe: setGitHubOutputs
// ---------------------------------------------------------------------------

describe("setGitHubOutputs", () => {
  it("sets issues-found and recommendation from investigate node", async () => {
    const results = new Map([
      ["investigate", { status: "success", data: { issuesFound: true, recommendation: "implement" }, toolCalls: [] }],
    ]);
    mockExecute.mockResolvedValue(results);

    await loadMain();

    expect(mockSetOutput).toHaveBeenCalledWith("issues-found", "true");
    expect(mockSetOutput).toHaveBeenCalledWith("recommendation", "implement");
  });

  it("sets pr outputs from create_pr node", async () => {
    const results = new Map([
      [
        "create_pr",
        {
          status: "success",
          data: {
            issueIdentifier: "ENG-42",
            issueUrl: "https://linear.app/ENG-42",
            prUrl: "https://github.com/org/repo/pull/7",
            prNumber: 7,
          },
          toolCalls: [],
        },
      ],
    ]);
    mockExecute.mockResolvedValue(results);

    await loadMain();

    expect(mockSetOutput).toHaveBeenCalledWith("issue-identifier", "ENG-42");
    expect(mockSetOutput).toHaveBeenCalledWith("issue-url", "https://linear.app/ENG-42");
    expect(mockSetOutput).toHaveBeenCalledWith("pr-url", "https://github.com/org/repo/pull/7");
    expect(mockSetOutput).toHaveBeenCalledWith("pr-number", "7");
  });

  it("sets issue-only outputs from create_issue node when no create_pr", async () => {
    const results = new Map([
      [
        "create_issue",
        {
          status: "success",
          data: {
            issueIdentifier: "ENG-99",
            issueUrl: "https://linear.app/ENG-99",
          },
          toolCalls: [],
        },
      ],
    ]);
    mockExecute.mockResolvedValue(results);

    await loadMain();

    expect(mockSetOutput).toHaveBeenCalledWith("issue-identifier", "ENG-99");
    expect(mockSetOutput).toHaveBeenCalledWith("issue-url", "https://linear.app/ENG-99");
    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-url", expect.anything());
    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-number", expect.anything());
  });

  it("does not set pr outputs when no create_pr node exists", async () => {
    const results = new Map([
      ["investigate", { status: "success", data: { issuesFound: false, recommendation: "skip" }, toolCalls: [] }],
    ]);
    mockExecute.mockResolvedValue(results);

    await loadMain();

    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-url", expect.anything());
    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-number", expect.anything());
  });

  it("does not crash when investigate node is absent", async () => {
    const results = new Map([
      [
        "create_pr",
        {
          status: "success",
          data: {
            issueIdentifier: "ENG-1",
            issueUrl: "https://linear.app/ENG-1",
            prUrl: "https://github.com/org/repo/pull/1",
            prNumber: 1,
          },
          toolCalls: [],
        },
      ],
    ]);
    mockExecute.mockResolvedValue(results);

    await loadMain();

    // Should not throw and should NOT set investigate outputs
    expect(mockSetOutput).not.toHaveBeenCalledWith("issues-found", expect.anything());
    expect(mockSetOutput).not.toHaveBeenCalledWith("recommendation", expect.anything());
    // But should still set PR outputs
    expect(mockSetOutput).toHaveBeenCalledWith("pr-url", "https://github.com/org/repo/pull/1");
  });
});

// ---------------------------------------------------------------------------
// describe: handleEvent — observer callback event logging
// ---------------------------------------------------------------------------

describe("handleEvent observer", () => {
  /**
   * Helper: loads main.ts with mockExecute configured to fire the given
   * events via the observer callback, then returns all mockInfo call args.
   */
  async function fireEvents(events: Array<Record<string, unknown>>): Promise<string[]> {
    mockExecute.mockImplementation(
      async (_wf: unknown, _input: unknown, opts: { observer: (e: Record<string, unknown>) => void }) => {
        for (const e of events) {
          opts.observer(e);
        }
        return new Map();
      },
    );

    await loadMain();

    return mockInfo.mock.calls.map((c: unknown[]) => c[0] as string);
  }

  // -- node:progress: tool call pattern ---------------------------------

  it("logs node:progress with tool pattern using → prefix", async () => {
    const logs = await fireEvents([
      { type: "node:progress", node: "investigate", message: "mcp__linear__create_issue (3s)" },
    ]);

    expect(logs).toContain("  → mcp__linear__create_issue (3s)");
  });

  it("logs node:progress tool pattern with large elapsed time", async () => {
    const logs = await fireEvents([
      { type: "node:progress", node: "investigate", message: "mcp__betterstack__telemetry_query (142s)" },
    ]);

    expect(logs).toContain("  → mcp__betterstack__telemetry_query (142s)");
  });

  // -- node:progress: generic message -----------------------------------

  it("logs node:progress with generic message using ↳ prefix", async () => {
    const logs = await fireEvents([
      { type: "node:progress", node: "investigate", message: "Analyzing error patterns" },
    ]);

    expect(logs).toContain("  ↳ Analyzing error patterns");
  });

  // -- node:progress: edge cases that should NOT match tool pattern ------

  it("does not treat parenthetical content without time suffix as tool call", async () => {
    const logs = await fireEvents([
      { type: "node:progress", node: "investigate", message: "Found 3 issues (high severity)" },
    ]);

    // Should use the generic ↳ prefix, not the tool → prefix
    expect(logs).toContain("  ↳ Found 3 issues (high severity)");
    expect(logs).not.toContain("  → Found 3 issues (3s)");
  });

  it("does not treat decimal seconds as tool call pattern", async () => {
    const logs = await fireEvents([{ type: "node:progress", node: "investigate", message: "some_tool (3.2s)" }]);

    // Regex requires integer seconds — 3.2s should not match
    expect(logs).toContain("  ↳ some_tool (3.2s)");
  });

  it("does not treat message ending with (Ns) mid-string as tool call", async () => {
    const logs = await fireEvents([
      { type: "node:progress", node: "investigate", message: "Retried request (5s) and succeeded" },
    ]);

    // The pattern requires (Ns) at end-of-string — this has trailing text
    expect(logs).toContain("  ↳ Retried request (5s) and succeeded");
  });

  // -- tool:call --------------------------------------------------------

  it("logs tool:call events with → prefix and summarized input", async () => {
    const logs = await fireEvents([
      { type: "tool:call", node: "investigate", tool: "search_logs", input: { query: "error 500", limit: 10 } },
    ]);

    expect(logs).toContain("  → search_logs(query=error 500, limit=10)");
  });

  // -- tool:result ------------------------------------------------------

  it("logs tool:result events with ✓ prefix and summarized output", async () => {
    const logs = await fireEvents([
      { type: "tool:result", node: "investigate", tool: "search_logs", output: "Found 5 matching entries" },
    ]);

    expect(logs).toContain("  ✓ search_logs → Found 5 matching entries");
  });

  // -- workflow:start ---------------------------------------------------

  it("logs workflow:start with ▲ prefix", async () => {
    const logs = await fireEvents([{ type: "workflow:start", workflow: "triage" }]);

    expect(logs).toContain("▲ triage");
  });

  // -- node:enter -------------------------------------------------------

  it("logs node:enter with → prefix and starts a group", async () => {
    await fireEvents([
      {
        type: "node:enter",
        node: "investigate",
        instruction: "Investigate the error patterns in the observability data",
      },
    ]);

    expect(mockStartGroup).toHaveBeenCalledWith(
      "investigate: Investigate the error patterns in the observability data",
    );
    expect(mockInfo).toHaveBeenCalledWith("→ investigate");
  });

  // -- node:exit (success) ----------------------------------------------

  it("logs successful node:exit with ✓ prefix and tool call count", async () => {
    const logs = await fireEvents([
      { type: "node:exit", node: "investigate", result: { status: "success", data: {}, toolCalls: [{}, {}, {}] } },
    ]);

    expect(logs).toContain("✓ investigate: success (3 tool calls)");
    expect(mockEndGroup).toHaveBeenCalled();
  });

  // -- route ------------------------------------------------------------

  it("logs route events with ⤳ prefix", async () => {
    const logs = await fireEvents([{ type: "route", from: "investigate", to: "create_issue", reason: "issues found" }]);

    expect(logs).toContain("⤳ investigate → create_issue (issues found)");
  });
});

// ---------------------------------------------------------------------------
// describe: .sweny.yml rules/context integration
// ---------------------------------------------------------------------------

describe(".sweny.yml rules/context integration", () => {
  it("calls loadConfigFile with process.cwd()", async () => {
    await loadMain();

    expect(mockLoadConfigFile).toHaveBeenCalledWith(process.cwd());
  });

  it("passes rules from .sweny.yml as input.rules to execute", async () => {
    mockLoadConfigFile.mockReturnValue({
      rules: ["Never use var", "Always add tests"],
    });
    mockLoadAdditionalContext.mockResolvedValue({ resolved: "Never use var\n\n---\n\nAlways add tests", urls: [] });

    await loadMain();

    const [, input] = mockExecute.mock.calls[0];
    expect(input.rules).toBe("Never use var\n\n---\n\nAlways add tests");
  });

  it("passes rule URLs as rulesUrls to execute", async () => {
    mockLoadConfigFile.mockReturnValue({
      rules: ["https://example.com/coding-standards.md"],
    });
    mockLoadAdditionalContext.mockResolvedValue({ resolved: "", urls: ["https://example.com/coding-standards.md"] });

    await loadMain();

    const [, input] = mockExecute.mock.calls[0];
    expect(input.rulesUrls).toEqual(["https://example.com/coding-standards.md"]);
  });

  it("merges .sweny.yml context with action additional-context", async () => {
    mockParseInputs.mockReturnValue({
      ...DEFAULT_CONFIG,
      additionalContext: ["https://action-input.com/guide.md"],
    });
    mockLoadConfigFile.mockReturnValue({
      context: ["./local-architecture.md"],
    });

    // loadAdditionalContext is called twice: once for rules (empty), once for merged context
    mockLoadAdditionalContext
      .mockResolvedValueOnce({ resolved: "", urls: [] }) // rules call
      .mockResolvedValueOnce({ resolved: "", urls: ["https://action-input.com/guide.md"] }); // context call

    await loadMain();

    // Second call should receive both .sweny.yml context and action additional-context merged
    const contextCall = mockLoadAdditionalContext.mock.calls[1];
    expect(contextCall[0]).toEqual(["./local-architecture.md", "https://action-input.com/guide.md"]);
  });

  it("calls loadAdditionalContext twice: once for rules, once for context", async () => {
    mockLoadConfigFile.mockReturnValue({
      rules: ["rule-1"],
      context: ["ctx-1"],
    });

    await loadMain();

    expect(mockLoadAdditionalContext).toHaveBeenCalledTimes(2);
    // First call: rules from .sweny.yml
    expect(mockLoadAdditionalContext.mock.calls[0][0]).toEqual(["rule-1"]);
    // Second call: .sweny.yml context merged with action additionalContext (empty in DEFAULT_CONFIG)
    expect(mockLoadAdditionalContext.mock.calls[1][0]).toEqual(["ctx-1"]);
  });

  it("omits rules and rulesUrls from input when .sweny.yml has no rules", async () => {
    mockLoadConfigFile.mockReturnValue({});

    await loadMain();

    const [, input] = mockExecute.mock.calls[0];
    expect(input).not.toHaveProperty("rules");
    expect(input).not.toHaveProperty("rulesUrls");
  });

  it("handles .sweny.yml with scalar rules value gracefully", async () => {
    // loadConfigFile returns string for scalar YAML values — the action guards with Array.isArray
    mockLoadConfigFile.mockReturnValue({ rules: "single-rule" as unknown });

    await loadMain();

    // Should not crash; rules array should be empty (scalar fails Array.isArray check)
    const rulesCall = mockLoadAdditionalContext.mock.calls[0];
    expect(rulesCall[0]).toEqual([]);
  });

  it("does not call setFailed on happy path with .sweny.yml rules", async () => {
    mockLoadConfigFile.mockReturnValue({
      rules: ["https://example.com/rules.md"],
      context: ["./docs/arch.md"],
    });

    await loadMain();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });
});
