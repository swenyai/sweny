/**
 * Tests for the buildAutoMcpServers logic surfaced via mapToTriageConfig.
 *
 * Uses the same vi.resetModules() + vi.doMock() + dynamic import pattern as
 * main.test.ts to avoid triggering Commander's program.parse() at import time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CliConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Base CliConfig
// ---------------------------------------------------------------------------

const BASE: CliConfig = {
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
  reviewMode: "review",
  noveltyMode: false,
  issueOverride: "",
  additionalInstructions: "",
  observabilityProvider: "datadog",
  observabilityCredentials: {},
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
  jiraBaseUrl: "",
  jiraEmail: "",
  jiraApiToken: "",
  issueLabels: [],
  mcpServers: {},
  workspaceTools: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadMapToTriageConfig(): Promise<(config: CliConfig) => unknown> {
  vi.doMock("node:fs", () => ({ existsSync: vi.fn(), writeFileSync: vi.fn() }));
  vi.doMock("node:path", () => ({ join: (...a: string[]) => a.join("/") }));
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
    STARTER_CONFIG: "",
  }));
  vi.doMock("../src/config.js", () => ({
    registerTriageCommand: vi.fn().mockReturnValue({ action: vi.fn().mockReturnValue({}) }),
    registerImplementCommand: vi.fn().mockReturnValue({ action: vi.fn().mockReturnValue({}) }),
    parseCliInputs: vi.fn(),
    validateInputs: vi.fn(),
  }));
  vi.doMock("@sweny-ai/engine", () => ({
    runWorkflow: vi.fn(),
    triageWorkflow: { definition: { steps: {} } },
    implementWorkflow: { definition: { steps: {} } },
    triageDefinition: { id: "triage", name: "triage", version: "1.0.0", initial: "verify-access", steps: {} },
    implementDefinition: { id: "implement", name: "implement", version: "1.0.0", initial: "verify-access", steps: {} },
    createProviderRegistry: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), has: vi.fn() })),
    validateWorkflow: vi.fn().mockReturnValue([]),
    resolveWorkflow: vi.fn().mockReturnValue({ definition: { steps: {} }, implementations: {} }),
  }));
  vi.doMock("@sweny-ai/engine/builtin-steps", () => ({}));
  vi.doMock("yaml", () => ({ parse: vi.fn().mockReturnValue({}), stringify: vi.fn().mockReturnValue("") }));
  vi.doMock("../src/providers/index.js", () => ({
    createProviders: vi.fn().mockReturnValue(new Map()),
    createImplementProviders: vi.fn().mockReturnValue(new Map()),
  }));
  vi.doMock("../src/cache.js", () => ({
    createFsCache: vi.fn().mockReturnValue({ get: vi.fn(), set: vi.fn() }),
    hashConfig: vi.fn().mockReturnValue("hash"),
  }));
  vi.doMock("../src/output.js", () => ({
    c: { subtle: (s: string) => s, ok: (s: string) => s, fail: (s: string) => s },
    phaseColor: vi.fn().mockReturnValue((s: string) => s),
    formatBanner: vi.fn().mockReturnValue(""),
    formatPhaseHeader: vi.fn().mockReturnValue(""),
    formatStepLine: vi.fn().mockReturnValue(""),
    getStepDetails: vi.fn().mockReturnValue([]),
    formatResultHuman: vi.fn().mockReturnValue(""),
    formatResultJson: vi.fn().mockReturnValue("{}"),
    formatValidationErrors: vi.fn().mockReturnValue(""),
    formatCrashError: vi.fn().mockReturnValue(""),
  }));
  vi.doMock("ora", () => ({
    default: vi
      .fn()
      .mockReturnValue({ start: vi.fn().mockReturnThis(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() }),
  }));

  const { mapToTriageConfig } = await import("../src/main.js");
  return mapToTriageConfig as (config: CliConfig) => unknown;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mapToTriageConfig — buildAutoMcpServers", () => {
  let mapToTriageConfig: (config: CliConfig) => unknown;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    process.argv = ["node", "sweny"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    mapToTriageConfig = await loadMapToTriageConfig();
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("injects GitHub MCP server with GITHUB_PERSONAL_ACCESS_TOKEN when source control is github", () => {
    const config: CliConfig = { ...BASE, sourceControlProvider: "github", githubToken: "ghp_abc" };
    const result = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(result.mcpServers?.["github"]).toMatchObject({
      type: "stdio",
      command: "npx",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abc" },
    });
  });

  it("injects GitHub MCP server when issue tracker is github-issues (botToken fallback)", () => {
    const config: CliConfig = {
      ...BASE,
      sourceControlProvider: "file",
      issueTrackerProvider: "github-issues",
      githubToken: "",
      botToken: "ghp_bot",
    };
    const result = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(result.mcpServers?.["github"]).toMatchObject({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_bot" } });
  });

  it("does not inject GitHub MCP server when no token is present", () => {
    const config: CliConfig = { ...BASE, githubToken: "", botToken: "" };
    const result = mapToTriageConfig(config) as { mcpServers: unknown };
    expect((result.mcpServers as Record<string, unknown> | undefined)?.["github"]).toBeUndefined();
  });

  it("injects Linear MCP server when issue tracker is linear", () => {
    const config: CliConfig = {
      ...BASE,
      issueTrackerProvider: "linear",
      linearApiKey: "lin_api_key",
      githubToken: "",
    };
    const result = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(result.mcpServers?.["linear"]).toMatchObject({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer lin_api_key" },
    });
  });

  it("does not inject Linear MCP server when linearApiKey is absent", () => {
    const config: CliConfig = { ...BASE, issueTrackerProvider: "linear", linearApiKey: "", githubToken: "" };
    const result = mapToTriageConfig(config) as { mcpServers: unknown };
    expect((result.mcpServers as Record<string, unknown> | undefined)?.["linear"]).toBeUndefined();
  });

  it("user-supplied mcpServers override auto-injected ones on key conflict", () => {
    const config: CliConfig = {
      ...BASE,
      sourceControlProvider: "github",
      githubToken: "ghp_auto",
      mcpServers: { github: { type: "http", url: "https://my-github-proxy.example.com/mcp" } },
    };
    const result = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(result.mcpServers?.["github"]).toMatchObject({ url: "https://my-github-proxy.example.com/mcp" });
    expect((result.mcpServers?.["github"] as Record<string, unknown>)["env"]).toBeUndefined();
  });

  it("injects Datadog MCP server when observability provider is datadog with both keys", () => {
    const config: CliConfig = {
      ...BASE,
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd_api", appKey: "dd_app" },
      githubToken: "",
    };
    const result = mapToTriageConfig(config) as { mcpServers: Record<string, unknown> };
    expect(result.mcpServers?.["datadog"]).toMatchObject({
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: "dd_api", DD_APPLICATION_KEY: "dd_app" },
    });
  });

  it("does not inject Datadog MCP server when either key is absent", () => {
    const config: CliConfig = {
      ...BASE,
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd_api" }, // no appKey
      githubToken: "",
    };
    const result = mapToTriageConfig(config) as { mcpServers: unknown };
    expect((result.mcpServers as Record<string, unknown> | undefined)?.["datadog"]).toBeUndefined();
  });

  it("returns undefined when no providers trigger injection and no user mcpServers", () => {
    const config: CliConfig = {
      ...BASE,
      sourceControlProvider: "file",
      issueTrackerProvider: "linear",
      observabilityProvider: "datadog",
      observabilityCredentials: {},
      linearApiKey: "",
      githubToken: "",
      botToken: "",
      mcpServers: {},
    };
    const result = mapToTriageConfig(config) as { mcpServers: unknown };
    expect(result.mcpServers).toBeUndefined();
  });
});
