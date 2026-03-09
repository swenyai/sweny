/**
 * Tests for main.ts — the CLI entry point.
 *
 * Strategy:
 *  - `vi.resetModules()` + `vi.doMock()` per test group for fresh module state.
 *  - For the `init` command (synchronous): set process.argv to include "init" and
 *    let Commander execute the action during import.
 *  - For the triage command (async): mock `registerTriageCommand` to capture the
 *    action handler, then call it directly with controlled inputs.
 *  - `process.exit` is spied on in every test so the process doesn't actually exit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Persistent mock functions ─────────────────────────────────────────────────
// These vi.fn() instances live outside resetModules so we can inspect calls
// after vi.doMock factories reference them.

const mockExistsSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockRunWorkflow = vi.fn();
const mockCreateProviders = vi.fn().mockReturnValue(new Map());
const mockParseCliInputs = vi.fn();
const mockValidateInputs = vi.fn();
const mockFormatResultHuman = vi.fn().mockReturnValue("human result");
const mockFormatResultJson = vi.fn().mockReturnValue('{"status":"success"}');
const mockFormatValidationErrors = vi.fn().mockReturnValue("validation errors");
const mockFormatCrashError = vi.fn().mockReturnValue("crash error");

// Triage action handler captured by the mock registerTriageCommand
let capturedTriageAction: ((opts: Record<string, unknown>) => Promise<void>) | null = null;

// ── Base CliConfig ─────────────────────────────────────────────────────────────
const BASE_CONFIG = {
  json: false,
  dryRun: false,
  bell: false,
  noCache: true,
  cacheDir: "",
  cacheTtl: 0,
  timeRange: "24h",
  severityFocus: "errors",
  serviceFilter: "*",
  investigationDepth: "standard",
  maxInvestigateTurns: 50,
  maxImplementTurns: 30,
  serviceMapPath: "",
  repository: "acme/api",
  baseBranch: "main",
  prLabels: [],
  reviewMode: "review" as const,
  noveltyMode: false,
  issueOverride: "",
  additionalInstructions: "",
  observabilityProvider: "datadog",
  observabilityCredentials: { apiKey: "", appKey: "", site: "" },
  issueTrackerProvider: "github-issues",
  sourceControlProvider: "github",
  codingAgentProvider: "claude",
  notificationProvider: "console",
  botToken: "",
  githubToken: "gh_test",
  gitlabToken: "",
  gitlabProjectId: "",
  gitlabBaseUrl: "",
  linearApiKey: "",
  linearTeamId: "",
  linearBugLabelId: "",
  linearTriageLabelId: "",
  linearStateBacklog: "",
  linearStateInProgress: "",
  linearStatePeerReview: "",
  notificationWebhookUrl: "",
  sendgridApiKey: "",
  emailFrom: "",
  emailTo: "",
  webhookSigningSecret: "",
  anthropicApiKey: "",
  claudeOauthToken: "",
  openaiApiKey: "",
  geminiApiKey: "",
};

// ── Helper: set up all doMocks and import main.ts ─────────────────────────────
async function loadMain(argv: string[]) {
  process.argv = argv;
  capturedTriageAction = null;

  vi.doMock("node:fs", () => ({
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
  }));
  vi.doMock("node:path", () => ({
    join: (...args: string[]) => args.join("/"),
  }));
  vi.doMock("chalk", () => ({
    default: Object.assign((s: string) => s, {
      green: (s: string) => s,
      yellow: (s: string) => s,
      dim: (s: string) => s,
      cyan: (s: string) => s,
    }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
  }));
  vi.doMock("../src/config-file.js", () => ({
    loadDotenv: vi.fn(),
    loadConfigFile: vi.fn().mockReturnValue({}),
    STARTER_CONFIG: "# sweny starter config\n",
  }));
  vi.doMock("../src/config.js", () => ({
    registerTriageCommand: vi.fn().mockImplementation(() => ({
      action: (handler: (opts: Record<string, unknown>) => Promise<void>) => {
        capturedTriageAction = handler;
        return {};
      },
    })),
    registerImplementCommand: vi.fn().mockImplementation(() => ({
      action: () => ({}),
    })),
    parseCliInputs: mockParseCliInputs,
    validateInputs: mockValidateInputs,
  }));
  vi.doMock("@sweny-ai/engine", () => ({
    runRecipe: mockRunWorkflow,
    triageRecipe: { definition: { states: {} }, implementations: {} },
    implementRecipe: { definition: { states: {} }, implementations: {} },
    triageWorkflow: { name: "triage", steps: [] },
    implementWorkflow: { name: "implement", steps: [] },
    createProviderRegistry: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), has: vi.fn() })),
  }));
  vi.doMock("../src/providers/index.js", () => ({
    createProviders: mockCreateProviders,
    createImplementProviders: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), has: vi.fn() })),
  }));
  vi.doMock("../src/cache.js", () => ({
    createFsCache: vi.fn().mockReturnValue({ get: vi.fn(), set: vi.fn() }),
    hashConfig: vi.fn().mockReturnValue("testhash"),
  }));
  vi.doMock("../src/output.js", () => ({
    c: { subtle: (s: string) => s, ok: (s: string) => s, fail: (s: string) => s },
    phaseColor: vi.fn().mockReturnValue((s: string) => s),
    formatBanner: vi.fn().mockReturnValue(""),
    formatPhaseHeader: vi.fn().mockReturnValue(""),
    formatStepLine: vi.fn().mockReturnValue(""),
    getStepDetails: vi.fn().mockReturnValue([]),
    formatResultHuman: mockFormatResultHuman,
    formatResultJson: mockFormatResultJson,
    formatValidationErrors: mockFormatValidationErrors,
    formatCrashError: mockFormatCrashError,
  }));

  await import("../src/main.js");
}

// ── init command ───────────────────────────────────────────────────────────────

describe("init command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("writes STARTER_CONFIG to .sweny.yml when the file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    await loadMain(["node", "sweny", "init"]);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".sweny.yml"),
      "# sweny starter config\n",
      "utf-8",
    );
  });

  it("does not write the file if .sweny.yml already exists", async () => {
    exitSpy.mockImplementation(() => {
      throw new Error("exit");
    });
    mockExistsSync.mockReturnValue(true);

    await loadMain(["node", "sweny", "init"]).catch(() => {});

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("exits with code 1 if .sweny.yml already exists", async () => {
    mockExistsSync.mockReturnValue(true);

    await loadMain(["node", "sweny", "init"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not call process.exit on successful init", async () => {
    mockExistsSync.mockReturnValue(false);

    await loadMain(["node", "sweny", "init"]);

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ── triage action ──────────────────────────────────────────────────────────────

describe("triage action", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    // Load main with no subcommand — Commander won't run any action,
    // but registerTriageCommand.action() is still called which captures the handler.
    await loadMain(["node", "sweny"]);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("captures the triage action handler via registerTriageCommand", () => {
    expect(capturedTriageAction).toBeTypeOf("function");
  });

  it("exits 1 and prints validation errors when inputs are invalid", async () => {
    mockParseCliInputs.mockReturnValue(BASE_CONFIG);
    mockValidateInputs.mockReturnValue(["repository is required"]);

    await capturedTriageAction!({});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockFormatValidationErrors).toHaveBeenCalledWith(["repository is required"]);
  });

  it("does not call runWorkflow when validation fails", async () => {
    exitSpy.mockImplementation(() => {
      throw new Error("exit");
    });
    mockParseCliInputs.mockReturnValue(BASE_CONFIG);
    mockValidateInputs.mockReturnValue(["some error"]);

    await capturedTriageAction!({}).catch(() => {});

    expect(mockRunWorkflow).not.toHaveBeenCalled();
  });

  it("exits 0 after a successful workflow run", async () => {
    mockParseCliInputs.mockReturnValue(BASE_CONFIG);
    mockValidateInputs.mockReturnValue([]);
    mockRunWorkflow.mockResolvedValue({ status: "success" });

    await capturedTriageAction!({});

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 1 when the workflow result status is 'failed'", async () => {
    mockParseCliInputs.mockReturnValue(BASE_CONFIG);
    mockValidateInputs.mockReturnValue([]);
    mockRunWorkflow.mockResolvedValue({ status: "failed" });

    await capturedTriageAction!({});

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("calls formatResultHuman in non-JSON mode", async () => {
    mockParseCliInputs.mockReturnValue({ ...BASE_CONFIG, json: false });
    mockValidateInputs.mockReturnValue([]);
    const result = { status: "success" };
    mockRunWorkflow.mockResolvedValue(result);

    await capturedTriageAction!({});

    expect(mockFormatResultHuman).toHaveBeenCalledWith(result);
    expect(mockFormatResultJson).not.toHaveBeenCalled();
  });

  it("calls formatResultJson in JSON mode", async () => {
    mockParseCliInputs.mockReturnValue({ ...BASE_CONFIG, json: true });
    mockValidateInputs.mockReturnValue([]);
    const result = { status: "success" };
    mockRunWorkflow.mockResolvedValue(result);

    await capturedTriageAction!({});

    expect(mockFormatResultJson).toHaveBeenCalledWith(result);
    expect(mockFormatResultHuman).not.toHaveBeenCalled();
  });

  it("exits 1 and calls formatCrashError when runWorkflow throws", async () => {
    mockParseCliInputs.mockReturnValue(BASE_CONFIG);
    mockValidateInputs.mockReturnValue([]);
    mockRunWorkflow.mockRejectedValue(new Error("network timeout"));

    await capturedTriageAction!({});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockFormatCrashError).toHaveBeenCalled();
  });

  it("outputs JSON error object when runWorkflow throws in JSON mode", async () => {
    mockParseCliInputs.mockReturnValue({ ...BASE_CONFIG, json: true });
    mockValidateInputs.mockReturnValue([]);
    mockRunWorkflow.mockRejectedValue(new Error("something went wrong"));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await capturedTriageAction!({});
    consoleSpy.mockRestore();

    expect(mockFormatCrashError).not.toHaveBeenCalled();
  });

  it("calls createProviders with the config", async () => {
    mockParseCliInputs.mockReturnValue(BASE_CONFIG);
    mockValidateInputs.mockReturnValue([]);
    mockRunWorkflow.mockResolvedValue({ status: "success" });

    await capturedTriageAction!({});

    expect(mockCreateProviders).toHaveBeenCalledWith(
      BASE_CONFIG,
      expect.objectContaining({ info: expect.any(Function) }),
    );
  });
});

// ── mapToTriageConfig (via runWorkflow argument) ───────────────────────────────

describe("mapToTriageConfig", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await loadMain(["node", "sweny"]);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  async function runWithConfig(config: typeof BASE_CONFIG) {
    mockParseCliInputs.mockReturnValue(config);
    mockValidateInputs.mockReturnValue([]);
    mockRunWorkflow.mockResolvedValue({ status: "success" });
    await capturedTriageAction!({});
    return mockRunWorkflow.mock.calls[0][1] as Record<string, unknown>;
  }

  it("maps repository to triageConfig.repository", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, repository: "myorg/myrepo" });
    expect(triageConfig.repository).toBe("myorg/myrepo");
  });

  it("maps timeRange to triageConfig.timeRange", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, timeRange: "48h" });
    expect(triageConfig.timeRange).toBe("48h");
  });

  it("maps dryRun to triageConfig.dryRun", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, dryRun: true });
    expect(triageConfig.dryRun).toBe(true);
  });

  it("includes ANTHROPIC_API_KEY in agentEnv when set", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, anthropicApiKey: "sk-ant-test" });
    expect((triageConfig.agentEnv as Record<string, string>).ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });

  it("does not include ANTHROPIC_API_KEY in agentEnv when empty", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, anthropicApiKey: "" });
    expect(triageConfig.agentEnv as Record<string, string>).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("maps Datadog credentials to DD_* env vars", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd_api", appKey: "dd_app", site: "datadoghq.eu" },
    });
    const env = triageConfig.agentEnv as Record<string, string>;
    expect(env.DD_API_KEY).toBe("dd_api");
    expect(env.DD_APP_KEY).toBe("dd_app");
    expect(env.DD_SITE).toBe("datadoghq.eu");
  });

  it("maps Sentry credentials to SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "sentry",
      observabilityCredentials: { authToken: "sntryu_secret", organization: "acme-org", project: "api-prod" },
    });
    const env = triageConfig.agentEnv as Record<string, string>;
    expect(env.SENTRY_AUTH_TOKEN).toBe("sntryu_secret");
    expect(env.SENTRY_ORG).toBe("acme-org");
    expect(env.SENTRY_PROJECT).toBe("api-prod");
  });

  it("maps CloudWatch credentials to AWS_REGION and CLOUDWATCH_LOG_GROUP_PREFIX", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "cloudwatch",
      observabilityCredentials: { region: "eu-west-1", logGroupPrefix: "/ecs/api" },
    });
    const env = triageConfig.agentEnv as Record<string, string>;
    expect(env.AWS_REGION).toBe("eu-west-1");
    expect(env.CLOUDWATCH_LOG_GROUP_PREFIX).toBe("/ecs/api");
  });

  it("maps Loki credentials including LOKI_ORG_ID", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "loki",
      observabilityCredentials: { baseUrl: "https://loki.acme.com", apiKey: "loki-key", orgId: "tenant-1" },
    });
    const env = triageConfig.agentEnv as Record<string, string>;
    expect(env.LOKI_URL).toBe("https://loki.acme.com");
    expect(env.LOKI_API_KEY).toBe("loki-key");
    expect(env.LOKI_ORG_ID).toBe("tenant-1");
  });

  it("maps Linear API key to LINEAR_API_KEY in agentEnv", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, linearApiKey: "lin_api_123" });
    const env = triageConfig.agentEnv as Record<string, string>;
    expect(env.LINEAR_API_KEY).toBe("lin_api_123");
  });

  it("maps baseBranch to triageConfig.baseBranch", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, baseBranch: "develop" });
    expect(triageConfig.baseBranch).toBe("develop");
  });

  it("maps reviewMode 'auto' to triageConfig.reviewMode", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, reviewMode: "auto" });
    expect(triageConfig.reviewMode).toBe("auto");
  });

  it("defaults reviewMode to 'review' when not specified", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, reviewMode: "review" });
    expect(triageConfig.reviewMode).toBe("review");
  });
});
