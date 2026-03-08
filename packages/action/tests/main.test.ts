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
const mockCreateProviders = vi.fn();
const mockRunRecipe = vi.fn();

// ---------------------------------------------------------------------------
// Helper: re-register all doMocks and dynamically import main.ts fresh
// ---------------------------------------------------------------------------

async function loadMain() {
  vi.resetModules();
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
  vi.doMock("@sweny-ai/engine", () => ({
    runRecipe: mockRunRecipe,
    triageRecipe: { name: "triage", start: "verify-access", nodes: [] },
    implementRecipe: { name: "implement", start: "verify-access", nodes: [] },
  }));
  vi.doMock("../src/config.js", () => ({
    parseInputs: mockParseInputs,
    validateInputs: mockValidateInputs,
  }));
  vi.doMock("../src/providers/index.js", () => ({
    createProviders: mockCreateProviders,
  }));
  await import("../src/main.js");
}

// ---------------------------------------------------------------------------
// Default config returned by parseInputs in most tests
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  recipe: "triage" as const,
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
};

const DEFAULT_PROVIDERS = new Map();

// ---------------------------------------------------------------------------
// Shared beforeEach: reset all mocks and set up happy-path defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockParseInputs.mockReturnValue(DEFAULT_CONFIG);
  mockValidateInputs.mockReturnValue([]);
  mockCreateProviders.mockReturnValue(DEFAULT_PROVIDERS);
  mockRunRecipe.mockResolvedValue({ steps: [] });
});

// ---------------------------------------------------------------------------
// describe: run() orchestration
// ---------------------------------------------------------------------------

describe("run() orchestration", () => {
  it("calls parseInputs, validateInputs, createProviders, and runRecipe in sequence", async () => {
    const callOrder: string[] = [];
    mockParseInputs.mockImplementation(() => {
      callOrder.push("parseInputs");
      return DEFAULT_CONFIG;
    });
    mockValidateInputs.mockImplementation(() => {
      callOrder.push("validateInputs");
      return [];
    });
    mockCreateProviders.mockImplementation(() => {
      callOrder.push("createProviders");
      return DEFAULT_PROVIDERS;
    });
    mockRunRecipe.mockImplementation(async () => {
      callOrder.push("runRecipe");
      return { steps: [] };
    });

    await loadMain();

    expect(callOrder).toEqual(["parseInputs", "validateInputs", "createProviders", "runRecipe"]);
  });

  it("calls core.setFailed with joined validation errors and skips runRecipe", async () => {
    mockValidateInputs.mockReturnValue(["Error 1", "Error 2"]);

    await loadMain();

    expect(mockSetFailed).toHaveBeenCalledWith("Error 1\nError 2");
    expect(mockRunRecipe).not.toHaveBeenCalled();
  });

  it("passes triageRecipe as first arg and providers as third arg to runRecipe", async () => {
    const fakeProviders = new Map([["obs", {}]]);
    mockCreateProviders.mockReturnValue(fakeProviders);

    await loadMain();

    const [firstArg, , thirdArg] = mockRunRecipe.mock.calls[0];
    expect(firstArg).toMatchObject({ name: "triage" });
    expect(thirdArg).toBe(fakeProviders);
  });

  it("routes to implementRecipe when config.recipe is 'implement'", async () => {
    mockParseInputs.mockReturnValue({ ...DEFAULT_CONFIG, recipe: "implement" as const });

    await loadMain();

    const [firstArg] = mockRunRecipe.mock.calls[0];
    expect(firstArg).toMatchObject({ name: "implement" });
  });

  it("calls core.setFailed with error.message when runRecipe throws Error", async () => {
    mockRunRecipe.mockRejectedValue(new Error("workflow exploded"));

    await loadMain();

    expect(mockSetFailed).toHaveBeenCalledWith("workflow exploded");
  });

  it("calls core.setFailed with generic message when runRecipe throws non-Error", async () => {
    mockRunRecipe.mockRejectedValue("plain string error");

    await loadMain();

    expect(mockSetFailed).toHaveBeenCalledWith("An unexpected error occurred");
  });
});

// ---------------------------------------------------------------------------
// describe: beforeStep / afterStep hooks
// ---------------------------------------------------------------------------

describe("beforeStep / afterStep hooks", () => {
  it("beforeStep calls core.startGroup with phase and step name", async () => {
    await loadMain();

    const options = mockRunRecipe.mock.calls[0][3];
    await options.beforeStep({ phase: "investigate", name: "fetch-logs" });

    expect(mockStartGroup).toHaveBeenCalledWith("investigate: fetch-logs");
  });

  it("afterStep calls core.info with step name and status, then core.endGroup", async () => {
    await loadMain();

    const options = mockRunRecipe.mock.calls[0][3];
    await options.afterStep({ phase: "investigate", name: "fetch-logs" }, { status: "success" });

    expect(mockInfo).toHaveBeenCalledWith("fetch-logs: success");
    expect(mockEndGroup).toHaveBeenCalled();
  });

  it("afterStep includes reason in log message when stepResult.reason is set", async () => {
    await loadMain();

    const options = mockRunRecipe.mock.calls[0][3];
    await options.afterStep(
      { phase: "investigate", name: "fetch-logs" },
      { status: "skipped", reason: "no logs found" },
    );

    expect(mockInfo).toHaveBeenCalledWith("fetch-logs: skipped — no logs found");
  });
});

// ---------------------------------------------------------------------------
// describe: setGitHubOutputs
// ---------------------------------------------------------------------------

describe("setGitHubOutputs", () => {
  it("sets issues-found and recommendation from investigate step", async () => {
    mockRunRecipe.mockResolvedValue({
      steps: [
        {
          name: "investigate",
          phase: "investigate",
          result: { status: "success", data: { issuesFound: true, recommendation: "implement" } },
        },
      ],
    });

    await loadMain();

    expect(mockSetOutput).toHaveBeenCalledWith("issues-found", "true");
    expect(mockSetOutput).toHaveBeenCalledWith("recommendation", "implement");
  });

  it("sets pr outputs from create-pr step", async () => {
    mockRunRecipe.mockResolvedValue({
      steps: [
        {
          name: "create-pr",
          phase: "implement",
          result: {
            status: "success",
            data: {
              issueIdentifier: "ENG-42",
              issueUrl: "https://linear.app/ENG-42",
              prUrl: "https://github.com/org/repo/pull/7",
              prNumber: 7,
            },
          },
        },
      ],
    });

    await loadMain();

    expect(mockSetOutput).toHaveBeenCalledWith("issue-identifier", "ENG-42");
    expect(mockSetOutput).toHaveBeenCalledWith("issue-url", "https://linear.app/ENG-42");
    expect(mockSetOutput).toHaveBeenCalledWith("pr-url", "https://github.com/org/repo/pull/7");
    expect(mockSetOutput).toHaveBeenCalledWith("pr-number", "7");
  });

  it("sets issue-only outputs from create-issue step when no create-pr", async () => {
    mockRunRecipe.mockResolvedValue({
      steps: [
        {
          name: "create-issue",
          phase: "implement",
          result: {
            status: "success",
            data: {
              issueIdentifier: "ENG-99",
              issueUrl: "https://linear.app/ENG-99",
            },
          },
        },
      ],
    });

    await loadMain();

    expect(mockSetOutput).toHaveBeenCalledWith("issue-identifier", "ENG-99");
    expect(mockSetOutput).toHaveBeenCalledWith("issue-url", "https://linear.app/ENG-99");
    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-url", expect.anything());
    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-number", expect.anything());
  });

  it("does not set pr outputs when no create-pr step exists", async () => {
    mockRunRecipe.mockResolvedValue({
      steps: [
        {
          name: "investigate",
          phase: "investigate",
          result: { status: "success", data: { issuesFound: false, recommendation: "skip" } },
        },
      ],
    });

    await loadMain();

    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-url", expect.anything());
    expect(mockSetOutput).not.toHaveBeenCalledWith("pr-number", expect.anything());
  });

  it("does not crash when investigate step is absent", async () => {
    mockRunRecipe.mockResolvedValue({
      steps: [
        {
          name: "create-pr",
          phase: "implement",
          result: {
            status: "success",
            data: {
              issueIdentifier: "ENG-1",
              issueUrl: "https://linear.app/ENG-1",
              prUrl: "https://github.com/org/repo/pull/1",
              prNumber: 1,
            },
          },
        },
      ],
    });

    await loadMain();

    // Should not throw and should NOT set investigate outputs
    expect(mockSetOutput).not.toHaveBeenCalledWith("issues-found", expect.anything());
    expect(mockSetOutput).not.toHaveBeenCalledWith("recommendation", expect.anything());
    // But should still set PR outputs
    expect(mockSetOutput).toHaveBeenCalledWith("pr-url", "https://github.com/org/repo/pull/1");
  });
});
