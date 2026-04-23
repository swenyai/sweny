import { describe, it, expect } from "vitest";
import { validateInputs, parseCliInputs, parsePositiveInt } from "./config.js";
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
    observabilityProviders: ["file"],
    observabilityCredentials: { file: {} },
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
    offline: false,
    fetchAuth: {},
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

describe("validateInputs — observability provider", () => {
  it("accepts 'none' without requiring any credentials", () => {
    const errors = validateInputs(baseConfig({ observabilityProviders: [], observabilityCredentials: {} }));
    expect(errors.filter((e) => e.includes("DD_") || e.includes("observability"))).toEqual([]);
  });

  it("requires DD keys when explicitly set to datadog", () => {
    const errors = validateInputs(baseConfig({ observabilityProviders: ["datadog"], observabilityCredentials: {} }));
    expect(errors.some((e) => e.includes("DD_API_KEY"))).toBe(true);
    expect(errors.some((e) => e.includes("DD_APP_KEY"))).toBe(true);
  });
});

describe("parseCliInputs — observability provider default", () => {
  it("defaults to empty array when no provider is configured", () => {
    const config = parseCliInputs({}, {});
    expect(config.observabilityProviders).toEqual([]);
  });

  it("respects explicit datadog provider", () => {
    const config = parseCliInputs({ observabilityProvider: "datadog" }, {});
    expect(config.observabilityProviders).toEqual(["datadog"]);
  });

  it("supports comma-separated multiple providers", () => {
    const config = parseCliInputs({ observabilityProvider: "loki,sentry" }, {});
    expect(config.observabilityProviders).toEqual(["loki", "sentry"]);
  });
});

describe("fetch.auth + offline parsing", () => {
  it("parses offline flag", () => {
    const config = parseCliInputs({ offline: true }, {});
    expect(config.offline).toBe(true);
  });

  it("defaults fetchAuth to {} and offline to false", () => {
    const config = parseCliInputs({}, {});
    expect(config.offline).toBe(false);
    expect(config.fetchAuth).toEqual({});
  });

  it("parses fetch.auth from file config", () => {
    const config = parseCliInputs({}, { "fetch.auth": { "api.example.com": "MY_TOKEN" } as any });
    expect(config.fetchAuth).toEqual({ "api.example.com": "MY_TOKEN" });
  });
});

// Fix #10 completion: parsePositiveInt helper. Returns the fallback for
// null/undefined/empty, NaN for malformed input (so validateInputs can
// surface a field-specific error), parsed integer otherwise.
describe("parsePositiveInt", () => {
  it("returns fallback for undefined", () => {
    expect(parsePositiveInt(undefined, 42)).toBe(42);
  });

  it("returns fallback for null", () => {
    expect(parsePositiveInt(null, 42)).toBe(42);
  });

  it("returns fallback for empty string", () => {
    expect(parsePositiveInt("", 42)).toBe(42);
    expect(parsePositiveInt("   ", 42)).toBe(42);
  });

  it("parses numeric string", () => {
    expect(parsePositiveInt("100", 42)).toBe(100);
  });

  it("parses number value", () => {
    expect(parsePositiveInt(100, 42)).toBe(100);
  });

  it("truncates fractional numbers", () => {
    expect(parsePositiveInt(100.7, 42)).toBe(100);
    expect(parsePositiveInt("100.7", 42)).toBe(100);
  });

  it("returns NaN for malformed string (not silent fallback)", () => {
    expect(Number.isNaN(parsePositiveInt("abc", 42))).toBe(true);
    expect(Number.isNaN(parsePositiveInt("5o", 42))).toBe(true);
    expect(Number.isNaN(parsePositiveInt("not a number", 42))).toBe(true);
  });

  it("returns NaN for NaN number input", () => {
    expect(Number.isNaN(parsePositiveInt(Number.NaN, 42))).toBe(true);
  });

  it("returns NaN for Infinity", () => {
    expect(Number.isNaN(parsePositiveInt(Infinity, 42))).toBe(true);
  });

  // Round 2: the helper must enforce the "positive" in its name.
  // Non-positive input returns NaN so validateInputs can reject it
  // with a field-specific error instead of silently accepting <= 0.
  it("returns NaN for zero (not positive)", () => {
    expect(Number.isNaN(parsePositiveInt(0, 42))).toBe(true);
    expect(Number.isNaN(parsePositiveInt("0", 42))).toBe(true);
  });

  it("returns NaN for negative string", () => {
    expect(Number.isNaN(parsePositiveInt("-5", 42))).toBe(true);
  });

  it("returns NaN for negative number", () => {
    expect(Number.isNaN(parsePositiveInt(-5, 42))).toBe(true);
  });
});

// Fix #10: numeric flags must reject NaN. Previously parseInt("abc", 10) → NaN
// slipped past the bounds check because NaN compares false for both < min and
// > max. Invalid values now fail validation with a clear field-specific error.
describe("validateInputs — numeric bounds reject NaN", () => {
  it("rejects non-numeric max-investigate-turns", () => {
    const errors = validateInputs(baseConfig({ maxInvestigateTurns: Number.NaN }));
    expect(errors.some((e) => e.includes("max-investigate-turns"))).toBe(true);
  });

  it("rejects non-numeric max-implement-turns", () => {
    const errors = validateInputs(baseConfig({ maxImplementTurns: Number.NaN }));
    expect(errors.some((e) => e.includes("max-implement-turns"))).toBe(true);
  });

  it("rejects Infinity values", () => {
    const errors = validateInputs(baseConfig({ maxInvestigateTurns: Infinity }));
    expect(errors.some((e) => e.includes("max-investigate-turns"))).toBe(true);
  });
});

describe("parseCliInputs — numeric parsing rejects junk", () => {
  it("rejects a non-numeric --max-investigate-turns via validateInputs", () => {
    const config = parseCliInputs({ maxInvestigateTurns: "abc" }, {});
    // parseInt produces NaN; the config object reflects that.
    expect(Number.isNaN(config.maxInvestigateTurns)).toBe(true);
    // validateInputs must catch the NaN and report it.
    const errors = validateInputs(config);
    expect(errors.some((e) => e.includes("max-investigate-turns"))).toBe(true);
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
