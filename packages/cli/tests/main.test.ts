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

// Action handlers captured by mock command registrations
let capturedTriageAction: ((opts: Record<string, unknown>) => Promise<void>) | null = null;
let capturedImplementAction: ((issueId: string, opts: Record<string, unknown>) => Promise<void>) | null = null;

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
  mcpServers: {},
  workspaceTools: [],
};

// ── Helper: set up all doMocks and import main.ts ─────────────────────────────
async function loadMain(argv: string[]) {
  process.argv = argv;
  capturedTriageAction = null;
  capturedImplementAction = null;

  vi.doMock("node:fs", () => ({
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
  }));
  vi.doMock("node:path", () => ({
    join: (...args: string[]) => args.join("/"),
  }));
  vi.doMock("chalk", () => ({
    default: Object.assign((s: string) => s, {
      red: (s: string) => s,
      green: (s: string) => s,
      yellow: (s: string) => s,
      dim: (s: string) => s,
      cyan: (s: string) => s,
    }),
    red: (s: string) => s,
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
      action: (handler: (issueId: string, opts: Record<string, unknown>) => Promise<void>) => {
        capturedImplementAction = handler;
        return {};
      },
    })),
    parseCliInputs: mockParseCliInputs,
    validateInputs: mockValidateInputs,
  }));
  vi.doMock("@sweny-ai/engine", () => ({
    runWorkflow: mockRunWorkflow,
    triageWorkflow: { name: "triage", definition: { steps: {} } },
    implementWorkflow: { name: "implement", definition: { steps: {} } },
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

  // ── MCP auto-injection ──────────────────────────────────────────────────────

  it("injects GitHub MCP server when source control is github", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      sourceControlProvider: "github",
      githubToken: "ghp_abc",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["github"]).toMatchObject({
      type: "stdio",
      command: "npx",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abc" },
    });
  });

  it("injects GitHub MCP server when issue tracker is github-issues (botToken fallback)", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      sourceControlProvider: "gitlab",
      issueTrackerProvider: "github-issues",
      githubToken: "",
      botToken: "ghp_bot",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["github"]).toMatchObject({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_bot" } });
  });

  it("does not inject GitHub MCP server when no token is present", async () => {
    const triageConfig = await runWithConfig({ ...BASE_CONFIG, githubToken: "", botToken: "" });
    const mcp = triageConfig.mcpServers as Record<string, unknown> | undefined;
    expect(mcp?.["github"]).toBeUndefined();
  });

  it("injects Linear MCP server when issue tracker is linear", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      issueTrackerProvider: "linear",
      linearApiKey: "lin_api_key",
      githubToken: "",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["linear"]).toMatchObject({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer lin_api_key" },
    });
  });

  it("injects Datadog MCP server when observability provider is datadog with both keys", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd_api", appKey: "dd_app", site: "datadoghq.com" },
      githubToken: "",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["datadog"]).toMatchObject({
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: "dd_api", DD_APPLICATION_KEY: "dd_app" },
    });
  });

  it("injects GitLab MCP server when source control is gitlab", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      sourceControlProvider: "gitlab",
      gitlabToken: "glpat_test",
      gitlabBaseUrl: "https://gitlab.com",
      githubToken: "",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["gitlab"]).toMatchObject({ type: "stdio", env: { GITLAB_PERSONAL_ACCESS_TOKEN: "glpat_test" } });
  });

  it("includes GITLAB_API_URL for self-hosted GitLab", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      sourceControlProvider: "gitlab",
      gitlabToken: "glpat_test",
      gitlabBaseUrl: "https://gitlab.internal.example.com",
      githubToken: "",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect((mcp?.["gitlab"] as Record<string, unknown>)?.["env"]).toMatchObject({
      GITLAB_API_URL: "https://gitlab.internal.example.com/api/v4",
    });
  });

  it("injects Sentry MCP server when observability provider is sentry", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "sentry",
      observabilityCredentials: { authToken: "sntryu_secret", organization: "acme", project: "api" },
      githubToken: "",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    // @sentry/mcp-server uses SENTRY_ACCESS_TOKEN (not SENTRY_AUTH_TOKEN)
    expect(mcp?.["sentry"]).toMatchObject({ type: "stdio", env: { SENTRY_ACCESS_TOKEN: "sntryu_secret" } });
  });

  it("injects New Relic MCP server when observability provider is newrelic", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "newrelic",
      observabilityCredentials: { apiKey: "NRAK-test", accountId: "123456", region: "us" },
      githubToken: "",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["newrelic"]).toMatchObject({
      type: "http",
      url: "https://mcp.newrelic.com/mcp/",
      headers: { "Api-Key": "NRAK-test" },
    });
  });

  it("uses EU endpoint for New Relic when region is eu", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      observabilityProvider: "newrelic",
      observabilityCredentials: { apiKey: "NRAK-test", accountId: "123456", region: "eu" },
      githubToken: "",
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect((mcp?.["newrelic"] as Record<string, unknown>)?.["url"]).toBe("https://mcp.eu.newrelic.com/mcp/");
  });

  it("injects Slack MCP when declared in workspaceTools and SLACK_BOT_TOKEN is set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    try {
      const triageConfig = await runWithConfig({ ...BASE_CONFIG, githubToken: "", botToken: "", mcpServers: {}, workspaceTools: ["slack"] });
      const mcp = triageConfig.mcpServers as Record<string, unknown>;
      expect(mcp?.["slack"]).toMatchObject({ type: "stdio", env: { SLACK_BOT_TOKEN: "xoxb-test" } });
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
    }
  });

  it("does not inject Slack MCP when token is set but tool is not declared", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    try {
      const triageConfig = await runWithConfig({ ...BASE_CONFIG, githubToken: "", botToken: "", mcpServers: {}, workspaceTools: [] });
      const mcp = triageConfig.mcpServers as Record<string, unknown> | undefined;
      expect(mcp?.["slack"]).toBeUndefined();
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
    }
  });

  it("injects Notion MCP when declared in workspaceTools and NOTION_TOKEN is set", async () => {
    process.env.NOTION_TOKEN = "secret_notion";
    try {
      const triageConfig = await runWithConfig({ ...BASE_CONFIG, githubToken: "", botToken: "", mcpServers: {}, workspaceTools: ["notion"] });
      const mcp = triageConfig.mcpServers as Record<string, unknown>;
      expect(mcp?.["notion"]).toMatchObject({ type: "stdio", env: { NOTION_TOKEN: "secret_notion" } });
    } finally {
      delete process.env.NOTION_TOKEN;
    }
  });

  it("injects PagerDuty MCP when declared in workspaceTools and PAGERDUTY_API_TOKEN is set", async () => {
    process.env.PAGERDUTY_API_TOKEN = "pd_token_abc";
    try {
      const triageConfig = await runWithConfig({ ...BASE_CONFIG, githubToken: "", botToken: "", mcpServers: {}, workspaceTools: ["pagerduty"] });
      const mcp = triageConfig.mcpServers as Record<string, unknown>;
      expect(mcp?.["pagerduty"]).toMatchObject({
        type: "http",
        url: "https://mcp.pagerduty.com/mcp",
        headers: { Authorization: "Token token=pd_token_abc" },
      });
    } finally {
      delete process.env.PAGERDUTY_API_TOKEN;
    }
  });

  it("injects Monday.com MCP when declared in workspaceTools and MONDAY_TOKEN is set", async () => {
    process.env.MONDAY_TOKEN = "monday_key_abc";
    try {
      const triageConfig = await runWithConfig({ ...BASE_CONFIG, githubToken: "", botToken: "", mcpServers: {}, workspaceTools: ["monday"] });
      const mcp = triageConfig.mcpServers as Record<string, unknown>;
      expect(mcp?.["monday"]).toMatchObject({ type: "stdio", env: { MONDAY_TOKEN: "monday_key_abc" } });
    } finally {
      delete process.env.MONDAY_TOKEN;
    }
  });

  it("user-supplied mcpServers override auto-injected ones on key conflict", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      sourceControlProvider: "github",
      githubToken: "ghp_auto",
      mcpServers: { github: { type: "http", url: "https://my-github-proxy.example.com/mcp" } },
    });
    const mcp = triageConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["github"]).toMatchObject({ url: "https://my-github-proxy.example.com/mcp" });
    expect((mcp?.["github"] as Record<string, unknown>)["env"]).toBeUndefined();
  });

  it("returns undefined mcpServers when no providers trigger injection and no user servers", async () => {
    const triageConfig = await runWithConfig({
      ...BASE_CONFIG,
      sourceControlProvider: "gitlab",
      issueTrackerProvider: "jira",
      observabilityProvider: "sentry",
      observabilityCredentials: {},
      githubToken: "",
      botToken: "",
      mcpServers: {},
    });
    expect(triageConfig.mcpServers).toBeUndefined();
  });
});

// ── mapToImplementConfig ────────────────────────────────────────────────────

describe("mapToImplementConfig", () => {
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

  async function runImplementWithConfig(config: typeof BASE_CONFIG) {
    mockParseCliInputs.mockReturnValue(config);
    mockValidateInputs.mockReturnValue([]);
    mockRunWorkflow.mockResolvedValue({ status: "success" });
    await capturedImplementAction!("ENG-1", {});
    return mockRunWorkflow.mock.calls[0][1] as Record<string, unknown>;
  }

  it("maps reviewMode 'auto' to implementConfig.reviewMode", async () => {
    const implementConfig = await runImplementWithConfig({ ...BASE_CONFIG, reviewMode: "auto" });
    expect(implementConfig.reviewMode).toBe("auto");
  });

  it("defaults reviewMode to 'review'", async () => {
    const implementConfig = await runImplementWithConfig({ ...BASE_CONFIG, reviewMode: "review" });
    expect(implementConfig.reviewMode).toBe("review");
  });

  it("injects GitHub MCP server into implementConfig", async () => {
    const implementConfig = await runImplementWithConfig({
      ...BASE_CONFIG,
      sourceControlProvider: "github",
      githubToken: "ghp_impl",
    });
    const mcp = implementConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["github"]).toMatchObject({ type: "stdio", env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_impl" } });
  });

  it("injects Linear MCP server into implementConfig when issue tracker is linear", async () => {
    const implementConfig = await runImplementWithConfig({
      ...BASE_CONFIG,
      issueTrackerProvider: "linear",
      linearApiKey: "lin_impl_key",
      githubToken: "",
    });
    const mcp = implementConfig.mcpServers as Record<string, unknown>;
    expect(mcp?.["linear"]).toMatchObject({ type: "http", url: "https://mcp.linear.app/mcp" });
  });

  it("injects Slack MCP when workspace-tools includes 'slack' and SLACK_BOT_TOKEN is set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-impl-test";
    try {
      const implementConfig = await runImplementWithConfig({ ...BASE_CONFIG, workspaceTools: ["slack"] });
      const mcp = implementConfig.mcpServers as Record<string, unknown>;
      expect(mcp?.["slack"]).toMatchObject({ type: "stdio", env: { SLACK_BOT_TOKEN: "xoxb-impl-test" } });
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
    }
  });

  it("does not inject Slack MCP when SLACK_BOT_TOKEN is set but workspace-tools is empty", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-impl-test";
    try {
      const implementConfig = await runImplementWithConfig({ ...BASE_CONFIG, workspaceTools: [] });
      const mcp = implementConfig.mcpServers as Record<string, unknown>;
      expect(mcp?.["slack"]).toBeUndefined();
    } finally {
      delete process.env.SLACK_BOT_TOKEN;
    }
  });
});
