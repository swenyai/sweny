/**
 * Tests for packages/cli/src/providers/index.ts — createProviders wiring.
 *
 * Strategy:
 *  - vi.mock() all provider packages so each factory returns a tagged object
 *    (e.g. { __type: "datadog" }) instead of making real network calls.
 *  - Use the real createProviderRegistry from @sweny-ai/engine (it is a
 *    simple Map wrapper with no side effects).
 *  - Call createProviders(config, logger) directly and assert registry.get().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all provider packages ────────────────────────────────────────────────
// vi.mock() is hoisted — these run before imports.

vi.mock("@sweny-ai/providers/observability", () => ({
  datadog: vi.fn(() => ({ __type: "datadog" })),
  sentry: vi.fn(() => ({ __type: "sentry" })),
  cloudwatch: vi.fn(() => ({ __type: "cloudwatch" })),
  splunk: vi.fn(() => ({ __type: "splunk" })),
  elastic: vi.fn(() => ({ __type: "elastic" })),
  newrelic: vi.fn(() => ({ __type: "newrelic" })),
  loki: vi.fn(() => ({ __type: "loki" })),
  file: vi.fn(() => ({ __type: "file-obs" })),
}));

vi.mock("@sweny-ai/providers/issue-tracking", () => ({
  linear: vi.fn(() => ({ __type: "linear" })),
  jira: vi.fn(() => ({ __type: "jira" })),
  githubIssues: vi.fn(() => ({ __type: "github-issues" })),
  fileIssueTracking: vi.fn(() => ({ __type: "file-issue" })),
}));

vi.mock("@sweny-ai/providers/source-control", () => ({
  github: vi.fn(() => ({ __type: "github" })),
  gitlab: vi.fn(() => ({ __type: "gitlab" })),
  fileSourceControl: vi.fn(() => ({ __type: "file-sc" })),
}));

vi.mock("@sweny-ai/providers/notification", () => ({
  slackWebhook: vi.fn(() => ({ __type: "slack" })),
  teamsWebhook: vi.fn(() => ({ __type: "teams" })),
  discordWebhook: vi.fn(() => ({ __type: "discord" })),
  email: vi.fn(() => ({ __type: "email" })),
  webhook: vi.fn(() => ({ __type: "webhook" })),
  fileNotification: vi.fn(() => ({ __type: "file-notification" })),
}));

vi.mock("@sweny-ai/providers/coding-agent", () => ({
  claudeCode: vi.fn(() => ({ __type: "claude" })),
  openaiCodex: vi.fn(() => ({ __type: "codex" })),
  googleGemini: vi.fn(() => ({ __type: "gemini" })),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { createProviders } from "../src/providers/index.js";
import type { CliConfig } from "../src/config.js";

// ── Shared test helpers ───────────────────────────────────────────────────────

/** A no-op logger that satisfies the CliLogger interface. */
const noop = () => {};
const logger = { info: noop, debug: noop, warn: noop, error: noop };

/** Minimal valid CliConfig. Observability defaults to "file" to avoid cred checks. */
const BASE_CONFIG: CliConfig = {
  codingAgentProvider: "claude",
  anthropicApiKey: "sk-ant-test",
  claudeOauthToken: "",
  openaiApiKey: "",
  geminiApiKey: "",

  observabilityProvider: "file",
  observabilityCredentials: { path: "/tmp/obs.log" },

  issueTrackerProvider: "github-issues",
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
  issueOverride: "",
  additionalInstructions: "",
  serviceMapPath: "",
  githubToken: "gh_test",
  botToken: "",

  sourceControlProvider: "github",

  jiraBaseUrl: "",
  jiraEmail: "",
  jiraApiToken: "",

  gitlabToken: "gl_test",
  gitlabProjectId: "123",
  gitlabBaseUrl: "https://gitlab.com",

  notificationProvider: "console",
  notificationWebhookUrl: "https://hooks.example.com/webhook",
  sendgridApiKey: "",
  emailFrom: "",
  emailTo: "",
  webhookSigningSecret: "",

  repository: "acme/api",
  repositoryOwner: "acme",

  json: false,
  bell: false,

  cacheDir: ".sweny/cache",
  cacheTtl: 86400,
  noCache: false,

  outputDir: ".sweny/output",
};

// ── Observability provider selection ─────────────────────────────────────────

describe("createProviders — observability selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets datadog provider when observabilityProvider is 'datadog'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd_key", appKey: "dd_app", site: "datadoghq.com" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("datadog");
  });

  it("sets sentry provider when observabilityProvider is 'sentry'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "sentry",
      observabilityCredentials: { authToken: "sntryu_tok", organization: "acme", project: "api" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("sentry");
  });

  it("sets file provider when observabilityProvider is 'file'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "file",
      observabilityCredentials: { path: "/tmp/obs.log" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("file-obs");
  });

  it("sets cloudwatch provider when observabilityProvider is 'cloudwatch'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "cloudwatch",
      observabilityCredentials: { region: "us-east-1", logGroupPrefix: "/ecs/api" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("cloudwatch");
  });

  it("sets splunk provider when observabilityProvider is 'splunk'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "splunk",
      observabilityCredentials: { baseUrl: "https://splunk.acme.com", token: "tok", index: "main" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("splunk");
  });

  it("sets elastic provider when observabilityProvider is 'elastic'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "elastic",
      observabilityCredentials: { baseUrl: "https://elastic.acme.com", apiKey: "el_key", index: "logs-*" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("elastic");
  });

  it("sets newrelic provider when observabilityProvider is 'newrelic'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "newrelic",
      observabilityCredentials: { apiKey: "nr_key", accountId: "12345", region: "us" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("newrelic");
  });

  it("sets loki provider when observabilityProvider is 'loki'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "loki",
      observabilityCredentials: { baseUrl: "https://loki.acme.com", apiKey: "", orgId: "" },
    };
    const registry = createProviders(config, logger);
    expect((registry.get("observability") as { __type: string }).__type).toBe("loki");
  });

  it("throws a helpful error for an unknown observabilityProvider", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      observabilityProvider: "unknown-obs",
      observabilityCredentials: {},
    };
    expect(() => createProviders(config, logger)).toThrow("Unsupported observability provider: unknown-obs");
  });
});

// ── Issue tracker provider selection ─────────────────────────────────────────

describe("createProviders — issue tracker selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets linear issue tracker when issueTrackerProvider is 'linear'", () => {
    const config: CliConfig = { ...BASE_CONFIG, issueTrackerProvider: "linear", linearApiKey: "lin_key" };
    const registry = createProviders(config, logger);
    expect((registry.get("issueTracker") as { __type: string }).__type).toBe("linear");
  });

  it("sets github-issues tracker when issueTrackerProvider is 'github-issues'", () => {
    const config: CliConfig = { ...BASE_CONFIG, issueTrackerProvider: "github-issues" };
    const registry = createProviders(config, logger);
    expect((registry.get("issueTracker") as { __type: string }).__type).toBe("github-issues");
  });

  it("sets jira tracker when issueTrackerProvider is 'jira'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      issueTrackerProvider: "jira",
      jiraBaseUrl: "https://acme.atlassian.net",
      jiraEmail: "bot@acme.com",
      jiraApiToken: "jira_tok",
    };
    const registry = createProviders(config, logger);
    expect((registry.get("issueTracker") as { __type: string }).__type).toBe("jira");
  });

  it("sets file issue tracker when issueTrackerProvider is 'file'", () => {
    const config: CliConfig = { ...BASE_CONFIG, issueTrackerProvider: "file" };
    const registry = createProviders(config, logger);
    expect((registry.get("issueTracker") as { __type: string }).__type).toBe("file-issue");
  });

  it("throws a helpful error for an unknown issueTrackerProvider", () => {
    const config: CliConfig = { ...BASE_CONFIG, issueTrackerProvider: "unknown-tracker" };
    expect(() => createProviders(config, logger)).toThrow("Unsupported issue tracker provider: unknown-tracker");
  });
});

// ── Source control provider selection ────────────────────────────────────────

describe("createProviders — source control selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets github source control when sourceControlProvider is 'github'", () => {
    const config: CliConfig = { ...BASE_CONFIG, sourceControlProvider: "github" };
    const registry = createProviders(config, logger);
    expect((registry.get("sourceControl") as { __type: string }).__type).toBe("github");
  });

  it("sets gitlab source control when sourceControlProvider is 'gitlab'", () => {
    const config: CliConfig = { ...BASE_CONFIG, sourceControlProvider: "gitlab" };
    const registry = createProviders(config, logger);
    expect((registry.get("sourceControl") as { __type: string }).__type).toBe("gitlab");
  });

  it("sets file source control when sourceControlProvider is 'file'", () => {
    const config: CliConfig = { ...BASE_CONFIG, sourceControlProvider: "file" };
    const registry = createProviders(config, logger);
    expect((registry.get("sourceControl") as { __type: string }).__type).toBe("file-sc");
  });

  it("throws a helpful error for an unknown sourceControlProvider", () => {
    const config: CliConfig = { ...BASE_CONFIG, sourceControlProvider: "unknown-sc" };
    expect(() => createProviders(config, logger)).toThrow("Unsupported source control provider: unknown-sc");
  });
});

// ── Notification provider selection ──────────────────────────────────────────

describe("createProviders — notification selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets slack notification when notificationProvider is 'slack'", () => {
    const config: CliConfig = { ...BASE_CONFIG, notificationProvider: "slack" };
    const registry = createProviders(config, logger);
    expect((registry.get("notification") as { __type: string }).__type).toBe("slack");
  });

  it("sets teams notification when notificationProvider is 'teams'", () => {
    const config: CliConfig = { ...BASE_CONFIG, notificationProvider: "teams" };
    const registry = createProviders(config, logger);
    expect((registry.get("notification") as { __type: string }).__type).toBe("teams");
  });

  it("sets discord notification when notificationProvider is 'discord'", () => {
    const config: CliConfig = { ...BASE_CONFIG, notificationProvider: "discord" };
    const registry = createProviders(config, logger);
    expect((registry.get("notification") as { __type: string }).__type).toBe("discord");
  });

  it("sets email notification when notificationProvider is 'email'", () => {
    const config: CliConfig = {
      ...BASE_CONFIG,
      notificationProvider: "email",
      sendgridApiKey: "sg_key",
      emailFrom: "bot@acme.com",
      emailTo: "team@acme.com",
    };
    const registry = createProviders(config, logger);
    expect((registry.get("notification") as { __type: string }).__type).toBe("email");
  });

  it("sets webhook notification when notificationProvider is 'webhook'", () => {
    const config: CliConfig = { ...BASE_CONFIG, notificationProvider: "webhook" };
    const registry = createProviders(config, logger);
    expect((registry.get("notification") as { __type: string }).__type).toBe("webhook");
  });

  it("sets file notification when notificationProvider is 'file'", () => {
    const config: CliConfig = { ...BASE_CONFIG, notificationProvider: "file" };
    const registry = createProviders(config, logger);
    expect((registry.get("notification") as { __type: string }).__type).toBe("file-notification");
  });

  it("sets a console notification (inline object) when notificationProvider is 'console'", () => {
    const config: CliConfig = { ...BASE_CONFIG, notificationProvider: "console" };
    const registry = createProviders(config, logger);
    const notification = registry.get("notification") as { send: unknown };
    expect(typeof notification.send).toBe("function");
  });

  it("sets console notification as the default for unknown notificationProvider", () => {
    const config: CliConfig = { ...BASE_CONFIG, notificationProvider: "github-summary" };
    const registry = createProviders(config, logger);
    // Falls through to the default branch which sets the inline console object
    const notification = registry.get("notification") as { send: unknown };
    expect(typeof notification.send).toBe("function");
  });
});

// ── Coding agent provider selection ──────────────────────────────────────────

describe("createProviders — coding agent selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets claudeCode agent when codingAgentProvider is 'claude'", () => {
    const config: CliConfig = { ...BASE_CONFIG, codingAgentProvider: "claude" };
    const registry = createProviders(config, logger);
    expect((registry.get("codingAgent") as { __type: string }).__type).toBe("claude");
  });

  it("sets claudeCode agent as the default when codingAgentProvider is unrecognised", () => {
    const config: CliConfig = { ...BASE_CONFIG, codingAgentProvider: "unknown-agent" };
    const registry = createProviders(config, logger);
    expect((registry.get("codingAgent") as { __type: string }).__type).toBe("claude");
  });

  it("sets openaiCodex agent when codingAgentProvider is 'codex'", () => {
    const config: CliConfig = { ...BASE_CONFIG, codingAgentProvider: "codex" };
    const registry = createProviders(config, logger);
    expect((registry.get("codingAgent") as { __type: string }).__type).toBe("codex");
  });

  it("sets googleGemini agent when codingAgentProvider is 'gemini'", () => {
    const config: CliConfig = { ...BASE_CONFIG, codingAgentProvider: "gemini" };
    const registry = createProviders(config, logger);
    expect((registry.get("codingAgent") as { __type: string }).__type).toBe("gemini");
  });
});

// ── Registry completeness ─────────────────────────────────────────────────────

describe("createProviders — registry completeness", () => {
  it("registers all four provider slots", () => {
    const registry = createProviders(BASE_CONFIG, logger);
    expect(registry.has("observability")).toBe(true);
    expect(registry.has("issueTracker")).toBe(true);
    expect(registry.has("sourceControl")).toBe(true);
    expect(registry.has("notification")).toBe(true);
    expect(registry.has("codingAgent")).toBe(true);
  });
});
