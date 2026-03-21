import { describe, it, expect, vi, afterEach } from "vitest";
import { checkProviderConnectivity } from "../src/check.js";
import { stripAnsi, formatCheckResults } from "../src/output.js";
import type { CliConfig } from "../src/config.js";

function plain(s: string): string {
  return stripAnsi(s);
}

// Minimal config with all file-based providers
function fileConfig(): CliConfig {
  return {
    codingAgentProvider: "claude",
    anthropicApiKey: "",
    claudeOauthToken: "",
    openaiApiKey: "",
    geminiApiKey: "",
    observabilityProvider: "file",
    observabilityCredentials: { path: "test.log" },
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
    dryRun: false,
    reviewMode: "review",
    noveltyMode: true,
    issueOverride: "",
    additionalInstructions: "",
    serviceMapPath: "",
    githubToken: "",
    botToken: "",
    sourceControlProvider: "file",
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
    repository: "acme/api",
    repositoryOwner: "acme",
    json: false,
    bell: false,
    cacheDir: ".sweny/cache",
    cacheTtl: 86400,
    noCache: false,
    outputDir: ".sweny/output",
    issueLabels: [],
    mcpServers: {},
    workspaceTools: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── All file providers ───────────────────────────────────────────────────────

describe("checkProviderConnectivity — file providers", () => {
  it("skips all checks when all providers are file-based and no keys are set", async () => {
    const results = await checkProviderConnectivity(fileConfig());
    expect(results.every((r) => r.status === "skip")).toBe(true);
  });
});

// ── Anthropic ────────────────────────────────────────────────────────────────

describe("checkProviderConnectivity — Anthropic", () => {
  it("returns ok when Anthropic API returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("anthropic.com")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("", { status: 404 });
    });

    const config = { ...fileConfig(), anthropicApiKey: "sk-ant-test" };
    const results = await checkProviderConnectivity(config);
    const r = results.find((x) => x.name.includes("Anthropic"));
    expect(r?.status).toBe("ok");
  });

  it("returns fail when Anthropic API returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("anthropic.com")) {
        return new Response("{}", { status: 401 });
      }
      return new Response("", { status: 404 });
    });

    const config = { ...fileConfig(), anthropicApiKey: "sk-bad" };
    const results = await checkProviderConnectivity(config);
    const r = results.find((x) => x.name.includes("Anthropic"));
    expect(r?.status).toBe("fail");
    expect(r?.detail).toMatch(/401/);
  });
});

// ── Datadog ──────────────────────────────────────────────────────────────────

describe("checkProviderConnectivity — Datadog", () => {
  it("returns ok when Datadog validate endpoint returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("datadoghq.com")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("", { status: 404 });
    });

    const config = {
      ...fileConfig(),
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "dd-api", appKey: "dd-app", site: "datadoghq.com" },
    };
    const results = await checkProviderConnectivity(config);
    const r = results.find((x) => x.name.includes("datadog"));
    expect(r?.status).toBe("ok");
  });

  it("returns fail when Datadog returns 403", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("datadoghq.com")) {
        return new Response("{}", { status: 403 });
      }
      return new Response("", { status: 404 });
    });

    const config = {
      ...fileConfig(),
      observabilityProvider: "datadog",
      observabilityCredentials: { apiKey: "bad", appKey: "bad", site: "datadoghq.com" },
    };
    const results = await checkProviderConnectivity(config);
    const r = results.find((x) => x.name.includes("datadog"));
    expect(r?.status).toBe("fail");
    expect(r?.detail).toMatch(/403/);
  });
});

// ── Network error ────────────────────────────────────────────────────────────

describe("checkProviderConnectivity — network errors", () => {
  it("returns fail with network error message on ENOTFOUND", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.anthropic.com");
    });

    const config = { ...fileConfig(), anthropicApiKey: "sk-ant-test" };
    const results = await checkProviderConnectivity(config);
    const r = results.find((x) => x.name.includes("Anthropic"));
    expect(r?.status).toBe("fail");
    expect(r?.detail).toMatch(/Network error/);
  });
});

// ── GitHub ───────────────────────────────────────────────────────────────────

describe("checkProviderConnectivity — GitHub", () => {
  it("returns ok with login name when GitHub returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("api.github.com/user")) {
        return new Response(JSON.stringify({ login: "octocat" }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });

    const config = {
      ...fileConfig(),
      issueTrackerProvider: "github-issues",
      sourceControlProvider: "github",
      githubToken: "ghp_test",
    };
    const results = await checkProviderConnectivity(config);
    const r = results.find((x) => x.name.includes("github-issues"));
    expect(r?.status).toBe("ok");
    expect(r?.detail).toContain("octocat");
  });

  it("returns fail when GitHub returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("api.github.com/user")) {
        return new Response("{}", { status: 401 });
      }
      return new Response("", { status: 404 });
    });

    const config = {
      ...fileConfig(),
      issueTrackerProvider: "github-issues",
      githubToken: "bad-token",
    };
    const results = await checkProviderConnectivity(config);
    const r = results.find((x) => x.name.includes("github-issues"));
    expect(r?.status).toBe("fail");
    expect(r?.detail).toMatch(/401/);
  });
});

// ── formatCheckResults ───────────────────────────────────────────────────────

describe("formatCheckResults", () => {
  it("renders ✓ for ok results", () => {
    const out = plain(formatCheckResults([{ name: "Anthropic", status: "ok", detail: "API key valid" }]));
    expect(out).toContain("✓");
    expect(out).toContain("Anthropic");
  });

  it("renders ✗ for fail results", () => {
    const out = plain(formatCheckResults([{ name: "Datadog", status: "fail", detail: "403 Forbidden" }]));
    expect(out).toContain("✗");
    expect(out).toContain("Datadog");
  });

  it("renders − for skip results", () => {
    const out = plain(formatCheckResults([{ name: "Linear", status: "skip", detail: "Not configured" }]));
    expect(out).toContain("−");
  });

  it("shows failure summary when any result is fail", () => {
    const out = plain(
      formatCheckResults([
        { name: "Anthropic", status: "ok", detail: "ok" },
        { name: "Datadog", status: "fail", detail: "403" },
      ]),
    );
    expect(out).toContain("One or more checks failed");
  });

  it("shows all passed summary when all are ok", () => {
    const out = plain(
      formatCheckResults([
        { name: "Anthropic", status: "ok", detail: "ok" },
        { name: "GitHub", status: "ok", detail: "ok" },
      ]),
    );
    expect(out).toContain("All checks passed");
  });
});
