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

/** Track ClaudeClient constructor calls */
let claudeClientArgs: unknown[] = [];

// ---------------------------------------------------------------------------
// Helper: re-register all doMocks and dynamically import main.ts fresh
// ---------------------------------------------------------------------------

async function loadMain() {
  vi.resetModules();
  claudeClientArgs = [];
  vi.doMock("@actions/core", () => ({
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
  }));
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
