import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Prevent real git calls in detectRepository()
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue("git@github.com:acme/api.git"),
}));

const { parseCliInputs, validateInputs } = await import("../src/config.js");

// ── parseCliInputs ──────────────────────────────────────────────────────────

describe("parseCliInputs", () => {
  const ENV_KEYS = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_OWNER",
    "DD_API_KEY",
    "DD_APP_KEY",
    "LINEAR_API_KEY",
    "LINEAR_TEAM_ID",
    "GITHUB_TOKEN",
    "SWENY_CACHE_DIR",
  ];

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    // Provide repository so detectRepository() is bypassed
    process.env.GITHUB_REPOSITORY = "acme/api";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("applies defaults when options are empty", () => {
    const config = parseCliInputs({});

    expect(config.codingAgentProvider).toBe("claude");
    expect(config.observabilityProvider).toBe("datadog");
    expect(config.issueTrackerProvider).toBe("github-issues");
    expect(config.sourceControlProvider).toBe("github");
    expect(config.timeRange).toBe("24h");
    expect(config.severityFocus).toBe("errors");
    expect(config.serviceFilter).toBe("*");
    expect(config.investigationDepth).toBe("standard");
    expect(config.maxInvestigateTurns).toBe(50);
    expect(config.maxImplementTurns).toBe(30);
    expect(config.baseBranch).toBe("main");
    expect(config.prLabels).toEqual(["agent", "triage", "needs-review"]);
    expect(config.dryRun).toBe(false);
    expect(config.noveltyMode).toBe(true);
    expect(config.json).toBe(false);
    expect(config.cacheTtl).toBe(86400);
    expect(config.noCache).toBe(false);
    expect(config.cacheDir).toBe(".sweny/cache");
  });

  it("overrides defaults with provided CLI options", () => {
    const config = parseCliInputs({
      codingAgentProvider: "codex",
      observabilityProvider: "sentry",
      timeRange: "4h",
      severityFocus: "warnings",
      maxInvestigateTurns: "100",
      maxImplementTurns: "20",
      baseBranch: "develop",
      prLabels: "fix, bot",
      dryRun: true,
      json: true,
    });

    expect(config.codingAgentProvider).toBe("codex");
    expect(config.observabilityProvider).toBe("sentry");
    expect(config.timeRange).toBe("4h");
    expect(config.severityFocus).toBe("warnings");
    expect(config.maxInvestigateTurns).toBe(100);
    expect(config.maxImplementTurns).toBe(20);
    expect(config.baseBranch).toBe("develop");
    expect(config.prLabels).toEqual(["fix", "bot"]);
    expect(config.dryRun).toBe(true);
    expect(config.json).toBe(true);
  });

  it("reads ANTHROPIC_API_KEY from environment", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const config = parseCliInputs({});
    expect(config.anthropicApiKey).toBe("sk-ant-test-key");
  });

  it("reads CLAUDE_CODE_OAUTH_TOKEN from environment", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-abc";
    const config = parseCliInputs({});
    expect(config.claudeOauthToken).toBe("oauth-abc");
  });

  it("reads GEMINI_API_KEY from environment", () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    const config = parseCliInputs({});
    expect(config.geminiApiKey).toBe("gemini-key");
  });

  it("falls back to GOOGLE_API_KEY when GEMINI_API_KEY is absent", () => {
    process.env.GOOGLE_API_KEY = "google-fallback";
    const config = parseCliInputs({});
    expect(config.geminiApiKey).toBe("google-fallback");
  });

  it("GEMINI_API_KEY takes precedence over GOOGLE_API_KEY", () => {
    process.env.GEMINI_API_KEY = "gemini-specific";
    process.env.GOOGLE_API_KEY = "google-fallback";
    const config = parseCliInputs({});
    expect(config.geminiApiKey).toBe("gemini-specific");
  });

  it("uses repository from GITHUB_REPOSITORY when not passed as option", () => {
    process.env.GITHUB_REPOSITORY = "myorg/myrepo";
    const config = parseCliInputs({});
    expect(config.repository).toBe("myorg/myrepo");
  });

  it("repository option takes precedence over GITHUB_REPOSITORY env var", () => {
    process.env.GITHUB_REPOSITORY = "org/env-repo";
    const config = parseCliInputs({ repository: "org/cli-repo" });
    expect(config.repository).toBe("org/cli-repo");
  });

  it("sets noCache when options.cache is false (--no-cache)", () => {
    const config = parseCliInputs({ cache: false });
    expect(config.noCache).toBe(true);
  });

  it("noCache is false when cache option is not specified", () => {
    const config = parseCliInputs({});
    expect(config.noCache).toBe(false);
  });

  it("sets noveltyMode to false when options.noveltyMode is false (--no-novelty-mode)", () => {
    const config = parseCliInputs({ noveltyMode: false });
    expect(config.noveltyMode).toBe(false);
  });

  it("uses SWENY_CACHE_DIR env var for cacheDir default", () => {
    process.env.SWENY_CACHE_DIR = "/custom/cache";
    const config = parseCliInputs({});
    expect(config.cacheDir).toBe("/custom/cache");
  });

  it("cacheDir option takes precedence over SWENY_CACHE_DIR", () => {
    process.env.SWENY_CACHE_DIR = "/env/cache";
    const config = parseCliInputs({ cacheDir: "/cli/cache" });
    expect(config.cacheDir).toBe("/cli/cache");
  });

  it("parses maxInvestigateTurns as integer", () => {
    const config = parseCliInputs({ maxInvestigateTurns: "75" });
    expect(config.maxInvestigateTurns).toBe(75);
  });

  it("trims whitespace from prLabels entries", () => {
    const config = parseCliInputs({ prLabels: " agent , triage , fix " });
    expect(config.prLabels).toEqual(["agent", "triage", "fix"]);
  });
});

// ── validateInputs ──────────────────────────────────────────────────────────

describe("validateInputs", () => {
  function base(overrides: Record<string, unknown> = {}): Parameters<typeof validateInputs>[0] {
    return {
      codingAgentProvider: "claude",
      anthropicApiKey: "sk-ant-test",
      claudeOauthToken: "",
      openaiApiKey: "",
      geminiApiKey: "",
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd-api", appKey: "dd-app" },
      issueTrackerProvider: "github-issues",
      linearApiKey: "",
      linearTeamId: "",
      jiraBaseUrl: "",
      jiraEmail: "",
      jiraApiToken: "",
      sourceControlProvider: "github",
      githubToken: "ghp-token",
      botToken: "",
      gitlabToken: "",
      gitlabProjectId: "",
      notificationProvider: "console",
      notificationWebhookUrl: "",
      sendgridApiKey: "",
      emailFrom: "",
      emailTo: "",
      repository: "acme/api",
      maxInvestigateTurns: 50,
      maxImplementTurns: 30,
      ...overrides,
    } as Parameters<typeof validateInputs>[0];
  }

  it("returns no errors for a valid configuration", () => {
    expect(validateInputs(base())).toEqual([]);
  });

  // ── Coding agent ─────────────────────────────────────────────────

  describe("coding agent", () => {
    it("errors when claude has neither API key nor OAuth token", () => {
      const errors = validateInputs(base({ anthropicApiKey: "", claudeOauthToken: "" }));
      expect(errors.some((e) => e.includes("ANTHROPIC_API_KEY"))).toBe(true);
    });

    it("passes when claude has only an OAuth token", () => {
      const errors = validateInputs(base({ anthropicApiKey: "", claudeOauthToken: "oauth-token" }));
      expect(errors.filter((e) => e.includes("ANTHROPIC"))).toHaveLength(0);
    });

    it("passes when claude has only an API key", () => {
      const errors = validateInputs(base({ anthropicApiKey: "sk-ant", claudeOauthToken: "" }));
      expect(errors.filter((e) => e.includes("ANTHROPIC"))).toHaveLength(0);
    });

    it("errors when codex has no OpenAI key", () => {
      const errors = validateInputs(base({ codingAgentProvider: "codex", openaiApiKey: "" }));
      expect(errors.some((e) => e.includes("OPENAI_API_KEY"))).toBe(true);
    });

    it("errors when gemini has no Gemini key", () => {
      const errors = validateInputs(base({ codingAgentProvider: "gemini", geminiApiKey: "" }));
      expect(errors.some((e) => e.includes("GEMINI_API_KEY"))).toBe(true);
    });

    it("errors for an unknown coding agent provider", () => {
      const errors = validateInputs(base({ codingAgentProvider: "llama" }));
      expect(errors.some((e) => e.includes("Unsupported coding agent provider"))).toBe(true);
    });
  });

  // ── Repository ───────────────────────────────────────────────────

  describe("repository", () => {
    it("errors when repository is empty", () => {
      const errors = validateInputs(base({ repository: "" }));
      expect(errors.some((e) => e.toLowerCase().includes("repository"))).toBe(true);
    });
  });

  // ── Observability ────────────────────────────────────────────────

  describe("observability", () => {
    it("errors for datadog missing both apiKey and appKey", () => {
      const errors = validateInputs(
        base({ observabilityProvider: "datadog", observabilityCredentials: { apiKey: "", appKey: "" } }),
      );
      expect(errors.some((e) => e.includes("DD_API_KEY"))).toBe(true);
      expect(errors.some((e) => e.includes("DD_APP_KEY"))).toBe(true);
    });

    it("errors for sentry missing authToken, org, and project", () => {
      const errors = validateInputs(
        base({
          observabilityProvider: "sentry",
          observabilityCredentials: { authToken: "", organization: "", project: "" },
        }),
      );
      expect(errors.some((e) => e.includes("SENTRY_AUTH_TOKEN"))).toBe(true);
      expect(errors.some((e) => e.includes("--sentry-org"))).toBe(true);
      expect(errors.some((e) => e.includes("--sentry-project"))).toBe(true);
    });

    it("errors for cloudwatch missing log group prefix", () => {
      const errors = validateInputs(
        base({ observabilityProvider: "cloudwatch", observabilityCredentials: { logGroupPrefix: "" } }),
      );
      expect(errors.some((e) => e.includes("--cloudwatch-log-group-prefix"))).toBe(true);
    });

    it("errors for splunk missing baseUrl and token", () => {
      const errors = validateInputs(
        base({ observabilityProvider: "splunk", observabilityCredentials: { baseUrl: "", token: "" } }),
      );
      expect(errors.some((e) => e.includes("SPLUNK_URL"))).toBe(true);
      expect(errors.some((e) => e.includes("SPLUNK_TOKEN"))).toBe(true);
    });

    it("errors for elastic missing baseUrl and apiKey", () => {
      const errors = validateInputs(
        base({ observabilityProvider: "elastic", observabilityCredentials: { baseUrl: "", apiKey: "" } }),
      );
      expect(errors.some((e) => e.includes("ELASTIC_URL"))).toBe(true);
      expect(errors.some((e) => e.includes("ELASTIC_API_KEY"))).toBe(true);
    });

    it("errors for newrelic missing apiKey and accountId", () => {
      const errors = validateInputs(
        base({ observabilityProvider: "newrelic", observabilityCredentials: { apiKey: "", accountId: "" } }),
      );
      expect(errors.some((e) => e.includes("NR_API_KEY"))).toBe(true);
      expect(errors.some((e) => e.includes("NR_ACCOUNT_ID"))).toBe(true);
    });

    it("errors for loki missing baseUrl", () => {
      const errors = validateInputs(base({ observabilityProvider: "loki", observabilityCredentials: { baseUrl: "" } }));
      expect(errors.some((e) => e.includes("LOKI_URL"))).toBe(true);
    });

    it("errors for file provider missing path", () => {
      const errors = validateInputs(base({ observabilityProvider: "file", observabilityCredentials: { path: "" } }));
      expect(errors.some((e) => e.includes("--log-file"))).toBe(true);
    });
  });

  // ── Issue tracker ────────────────────────────────────────────────

  describe("issue tracker", () => {
    it("errors for linear missing apiKey and teamId", () => {
      const errors = validateInputs(base({ issueTrackerProvider: "linear", linearApiKey: "", linearTeamId: "" }));
      expect(errors.some((e) => e.includes("LINEAR_API_KEY"))).toBe(true);
      expect(errors.some((e) => e.includes("LINEAR_TEAM_ID"))).toBe(true);
    });

    it("errors for jira missing baseUrl, email, and apiToken", () => {
      const errors = validateInputs(
        base({ issueTrackerProvider: "jira", jiraBaseUrl: "", jiraEmail: "", jiraApiToken: "" }),
      );
      expect(errors.some((e) => e.includes("JIRA_BASE_URL"))).toBe(true);
      expect(errors.some((e) => e.includes("JIRA_EMAIL"))).toBe(true);
      expect(errors.some((e) => e.includes("JIRA_API_TOKEN"))).toBe(true);
    });

    it("passes for github-issues with no extra credentials required", () => {
      const errors = validateInputs(base({ issueTrackerProvider: "github-issues" }));
      expect(errors.filter((e) => e.includes("issue tracker"))).toHaveLength(0);
    });
  });

  // ── Source control ───────────────────────────────────────────────

  describe("source control", () => {
    it("errors for github missing both githubToken and botToken", () => {
      const errors = validateInputs(base({ githubToken: "", botToken: "" }));
      expect(errors.some((e) => e.includes("GITHUB_TOKEN"))).toBe(true);
    });

    it("passes for github when only botToken is set", () => {
      const errors = validateInputs(base({ githubToken: "", botToken: "bot-token-123" }));
      expect(errors.filter((e) => e.includes("GITHUB_TOKEN"))).toHaveLength(0);
    });

    it("errors for gitlab missing token and projectId", () => {
      const errors = validateInputs(base({ sourceControlProvider: "gitlab", gitlabToken: "", gitlabProjectId: "" }));
      expect(errors.some((e) => e.includes("GITLAB_TOKEN"))).toBe(true);
      expect(errors.some((e) => e.includes("GITLAB_PROJECT_ID"))).toBe(true);
    });
  });

  // ── Notification ─────────────────────────────────────────────────

  describe("notification", () => {
    it("errors for slack missing webhook URL", () => {
      const errors = validateInputs(base({ notificationProvider: "slack", notificationWebhookUrl: "" }));
      expect(errors.some((e) => e.includes("NOTIFICATION_WEBHOOK_URL"))).toBe(true);
    });

    it("errors for teams missing webhook URL", () => {
      const errors = validateInputs(base({ notificationProvider: "teams", notificationWebhookUrl: "" }));
      expect(errors.some((e) => e.includes("NOTIFICATION_WEBHOOK_URL"))).toBe(true);
    });

    it("errors for discord missing webhook URL", () => {
      const errors = validateInputs(base({ notificationProvider: "discord", notificationWebhookUrl: "" }));
      expect(errors.some((e) => e.includes("NOTIFICATION_WEBHOOK_URL"))).toBe(true);
    });

    it("errors for email missing sendgridApiKey, emailFrom, and emailTo", () => {
      const errors = validateInputs(
        base({ notificationProvider: "email", sendgridApiKey: "", emailFrom: "", emailTo: "" }),
      );
      expect(errors.some((e) => e.includes("SENDGRID_API_KEY"))).toBe(true);
      expect(errors.some((e) => e.includes("EMAIL_FROM"))).toBe(true);
      expect(errors.some((e) => e.includes("EMAIL_TO"))).toBe(true);
    });

    it("passes for console notification with no extra credentials", () => {
      const errors = validateInputs(base({ notificationProvider: "console" }));
      expect(errors).toHaveLength(0);
    });
  });

  // ── Turn limits ──────────────────────────────────────────────────

  describe("turn limits", () => {
    it("errors when maxInvestigateTurns is 0 (below minimum)", () => {
      const errors = validateInputs(base({ maxInvestigateTurns: 0 }));
      expect(errors.some((e) => e.includes("--max-investigate-turns"))).toBe(true);
    });

    it("errors when maxInvestigateTurns exceeds 500", () => {
      const errors = validateInputs(base({ maxInvestigateTurns: 501 }));
      expect(errors.some((e) => e.includes("--max-investigate-turns"))).toBe(true);
    });

    it("errors when maxImplementTurns is 0 (below minimum)", () => {
      const errors = validateInputs(base({ maxImplementTurns: 0 }));
      expect(errors.some((e) => e.includes("--max-implement-turns"))).toBe(true);
    });

    it("errors when maxImplementTurns exceeds 500", () => {
      const errors = validateInputs(base({ maxImplementTurns: 501 }));
      expect(errors.some((e) => e.includes("--max-implement-turns"))).toBe(true);
    });

    it("accepts boundary values of 1 and 500", () => {
      const errors = validateInputs(base({ maxInvestigateTurns: 1, maxImplementTurns: 500 }));
      expect(errors.filter((e) => e.includes("turns"))).toHaveLength(0);
    });

    it("accepts boundary values of 500 and 1", () => {
      const errors = validateInputs(base({ maxInvestigateTurns: 500, maxImplementTurns: 1 }));
      expect(errors.filter((e) => e.includes("turns"))).toHaveLength(0);
    });
  });
});
