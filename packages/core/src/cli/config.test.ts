import { describe, it, expect } from "vitest";
import { validateInputs, parseCliInputs } from "./config.js";
import type { CliConfig } from "./config.js";

/**
 * Focused tests for validateInputs() — specifically the notification-provider
 * switch. Regressions here break every `swenyai/triage` action run because
 * that action passes --notification-provider github-summary by default.
 */

function baseConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    codingAgentProvider: "claude",
    anthropicApiKey: "sk-ant-test",
    claudeOauthToken: "",
    openaiApiKey: "",
    geminiApiKey: "",
    observabilityProvider: "file",
    observabilityCredentials: {},
    issueTrackerProvider: "file",
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
    prLabels: ["agent"],
    issueLabels: [],
    dryRun: false,
    reviewMode: "review",
    noveltyMode: true,
    issueOverride: "",
    additionalInstructions: "",
    serviceMapPath: ".github/service-map.yml",
    githubToken: "ghp_test",
    botToken: "",
    sourceControlProvider: "github",
    jiraBaseUrl: "",
    jiraEmail: "",
    jiraApiToken: "",
    gitlabToken: "",
    gitlabProjectId: "",
    gitlabBaseUrl: "https://gitlab.com",
    notificationProvider: "console",
    notificationWebhookUrl: "",
    sendgridApiKey: "",
    emailFrom: "",
    emailTo: "",
    webhookSigningSecret: "",
    repository: "acme/app",
    repositoryOwner: "",
    json: false,
    stream: false,
    bell: false,
    cacheDir: ".sweny/cache",
    cacheTtl: 86400,
    noCache: false,
    outputDir: ".sweny/output",
    mcpServers: {},
    workspaceTools: [],
    rules: [],
    context: [],
    cloudToken: "",
    ...overrides,
  };
}

describe("validateInputs — notification provider", () => {
  it("accepts console (no credentials required)", () => {
    const errors = validateInputs(baseConfig({ notificationProvider: "console" }));
    expect(errors.filter((e) => e.includes("notification-provider"))).toEqual([]);
  });

  it("accepts github-summary (no credentials required)", () => {
    // Regression guard: the `swenyai/triage` composite action passes this as
    // its default. If the validator stops accepting it every scheduled run
    // across every consumer immediately breaks.
    const errors = validateInputs(baseConfig({ notificationProvider: "github-summary" }));
    expect(errors.filter((e) => e.includes("notification-provider"))).toEqual([]);
  });

  it("accepts file (no credentials required)", () => {
    const errors = validateInputs(baseConfig({ notificationProvider: "file" }));
    expect(errors.filter((e) => e.includes("notification-provider"))).toEqual([]);
  });

  it("requires NOTIFICATION_WEBHOOK_URL for slack", () => {
    const errors = validateInputs(baseConfig({ notificationProvider: "slack", notificationWebhookUrl: "" }));
    expect(errors.some((e) => e.includes("NOTIFICATION_WEBHOOK_URL"))).toBe(true);
  });

  it("accepts slack when NOTIFICATION_WEBHOOK_URL is set", () => {
    const errors = validateInputs(
      baseConfig({
        notificationProvider: "slack",
        notificationWebhookUrl: "https://hooks.slack.com/services/T/B/X",
      }),
    );
    expect(errors.filter((e) => e.includes("notification"))).toEqual([]);
  });

  it("requires sendgrid credentials for email", () => {
    const errors = validateInputs(baseConfig({ notificationProvider: "email" }));
    expect(errors.some((e) => e.includes("SENDGRID_API_KEY"))).toBe(true);
    expect(errors.some((e) => e.includes("EMAIL_FROM"))).toBe(true);
    expect(errors.some((e) => e.includes("EMAIL_TO"))).toBe(true);
  });

  it("rejects unknown providers and lists github-summary in the error", () => {
    const errors = validateInputs(baseConfig({ notificationProvider: "bogus" }));
    const err = errors.find((e) => e.includes("Unknown --notification-provider"));
    expect(err).toBeDefined();
    expect(err).toContain("github-summary");
    expect(err).toContain("console");
  });
});

describe("parseCliInputs — cloud token", () => {
  it("reads SWENY_CLOUD_TOKEN from env", () => {
    const original = process.env.SWENY_CLOUD_TOKEN;
    process.env.SWENY_CLOUD_TOKEN = "sweny_pk_test123";
    try {
      const config = parseCliInputs({});
      expect(config.cloudToken).toBe("sweny_pk_test123");
    } finally {
      if (original === undefined) delete process.env.SWENY_CLOUD_TOKEN;
      else process.env.SWENY_CLOUD_TOKEN = original;
    }
  });

  it("reads cloud-token from config file", () => {
    const config = parseCliInputs({}, { "cloud-token": "sweny_pk_fromfile" });
    expect(config.cloudToken).toBe("sweny_pk_fromfile");
  });

  it("env var overrides config file", () => {
    const original = process.env.SWENY_CLOUD_TOKEN;
    process.env.SWENY_CLOUD_TOKEN = "sweny_pk_env";
    try {
      const config = parseCliInputs({}, { "cloud-token": "sweny_pk_file" });
      expect(config.cloudToken).toBe("sweny_pk_env");
    } finally {
      if (original === undefined) delete process.env.SWENY_CLOUD_TOKEN;
      else process.env.SWENY_CLOUD_TOKEN = original;
    }
  });

  it("defaults to empty string", () => {
    const original = process.env.SWENY_CLOUD_TOKEN;
    delete process.env.SWENY_CLOUD_TOKEN;
    try {
      const config = parseCliInputs({});
      expect(config.cloudToken).toBe("");
    } finally {
      if (original !== undefined) process.env.SWENY_CLOUD_TOKEN = original;
    }
  });
});
