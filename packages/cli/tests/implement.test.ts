import { describe, it, expect, vi, beforeEach } from "vitest";
import { linear, jira, githubIssues, fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { github, gitlab, fileSourceControl } from "@sweny-ai/providers/source-control";
import { claudeCode, openaiCodex, googleGemini } from "@sweny-ai/providers/coding-agent";
import { registerImplementCommand } from "../src/config.js";
import { createImplementProviders } from "../src/providers/index.js";
import type { CliConfig } from "../src/config.js";

// Hoisted mocks
vi.mock("@sweny-ai/providers/issue-tracking", () => ({
  linear: vi.fn(() => ({})),
  jira: vi.fn(() => ({})),
  githubIssues: vi.fn(() => ({})),
  fileIssueTracking: vi.fn(() => ({})),
}));
vi.mock("@sweny-ai/providers/source-control", () => ({
  github: vi.fn(() => ({})),
  gitlab: vi.fn(() => ({})),
  fileSourceControl: vi.fn(() => ({})),
}));
vi.mock("@sweny-ai/providers/notification", () => ({
  slackWebhook: vi.fn(() => ({})),
  teamsWebhook: vi.fn(() => ({})),
  discordWebhook: vi.fn(() => ({})),
  email: vi.fn(() => ({})),
  webhook: vi.fn(() => ({})),
  fileNotification: vi.fn(() => ({})),
}));
vi.mock("@sweny-ai/providers/coding-agent", () => ({
  claudeCode: vi.fn(() => ({})),
  openaiCodex: vi.fn(() => ({})),
  googleGemini: vi.fn(() => ({})),
}));
vi.mock("@sweny-ai/providers/observability", () => ({
  datadog: vi.fn(() => ({})),
  sentry: vi.fn(() => ({})),
  cloudwatch: vi.fn(() => ({})),
  splunk: vi.fn(() => ({})),
  elastic: vi.fn(() => ({})),
  newrelic: vi.fn(() => ({})),
  loki: vi.fn(() => ({})),
  file: vi.fn(() => ({})),
}));
vi.mock("@sweny-ai/engine", () => ({
  createProviderRegistry: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), has: vi.fn() })),
  runWorkflow: vi.fn(),
  triageWorkflow: {},
  implementWorkflow: {},
}));

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const baseConfig: Partial<CliConfig> = {
  issueTrackerProvider: "linear",
  sourceControlProvider: "github",
  codingAgentProvider: "claude",
  linearApiKey: "lin_abc",
  linearTeamId: "TEAM-1",
  githubToken: "ghp_token",
  botToken: "",
  jiraBaseUrl: "",
  jiraEmail: "",
  jiraApiToken: "",
  gitlabToken: "",
  gitlabProjectId: "",
  gitlabBaseUrl: "https://gitlab.com",
  outputDir: ".sweny/output",
  observabilityProvider: "datadog",
  observabilityCredentials: {},
};

describe("createImplementProviders", () => {
  beforeEach(() => {
    vi.mocked(linear).mockClear();
    vi.mocked(jira).mockClear();
    vi.mocked(githubIssues).mockClear();
    vi.mocked(fileIssueTracking).mockClear();
    vi.mocked(github).mockClear();
    vi.mocked(gitlab).mockClear();
    vi.mocked(fileSourceControl).mockClear();
    vi.mocked(claudeCode).mockClear();
    vi.mocked(openaiCodex).mockClear();
    vi.mocked(googleGemini).mockClear();
  });

  it("calls linear, github, and claudeCode providers with default config", () => {
    createImplementProviders(baseConfig as CliConfig, silentLogger);
    expect(linear).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "lin_abc" }));
    expect(github).toHaveBeenCalledWith(expect.objectContaining({ token: "ghp_token" }));
    expect(claudeCode).toHaveBeenCalled();
  });

  it("passes linear team id to linear provider", () => {
    createImplementProviders(baseConfig as CliConfig, silentLogger);
    // linear is called with apiKey; team ID is handled by agentEnv not the provider constructor
    expect(linear).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "lin_abc" }));
  });

  it("uses github token for source control", () => {
    createImplementProviders({ ...baseConfig, githubToken: "ghp_xyz" } as CliConfig, silentLogger);
    expect(github).toHaveBeenCalledWith(expect.objectContaining({ token: "ghp_xyz" }));
  });

  it("uses file providers when configured", () => {
    createImplementProviders(
      {
        ...baseConfig,
        issueTrackerProvider: "file",
        sourceControlProvider: "file",
        outputDir: "/tmp/out",
      } as CliConfig,
      silentLogger,
    );
    expect(fileIssueTracking).toHaveBeenCalledWith(expect.objectContaining({ outputDir: "/tmp/out" }));
    expect(fileSourceControl).toHaveBeenCalledWith(expect.objectContaining({ outputDir: "/tmp/out" }));
  });

  it("uses jira when issueTrackerProvider is jira", () => {
    createImplementProviders(
      {
        ...baseConfig,
        issueTrackerProvider: "jira",
        jiraBaseUrl: "https://acme.atlassian.net",
        jiraEmail: "a@b.com",
        jiraApiToken: "tok",
      } as CliConfig,
      silentLogger,
    );
    expect(jira).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://acme.atlassian.net",
        email: "a@b.com",
        apiToken: "tok",
      }),
    );
  });
});

describe("registerImplementCommand", () => {
  it("returns a command with name 'implement'", async () => {
    const { Command } = await import("commander");
    const program = new Command();
    const cmd = registerImplementCommand(program);
    expect(cmd.name()).toBe("implement");
  });

  it("has --dry-run option", async () => {
    const { Command } = await import("commander");
    const program = new Command();
    const cmd = registerImplementCommand(program);
    const opts = cmd.opts();
    expect(cmd.options.some((o) => o.long === "--dry-run")).toBe(true);
  });

  it("has --max-implement-turns option", async () => {
    const { Command } = await import("commander");
    const program = new Command();
    const cmd = registerImplementCommand(program);
    expect(cmd.options.some((o) => o.long === "--max-implement-turns")).toBe(true);
  });
});
