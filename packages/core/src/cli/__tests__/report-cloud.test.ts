import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeResult } from "../../types.js";
import type { CliConfig } from "../config.js";

describe("reportToCloud", () => {
  let reportToCloud: (
    results: Map<string, NodeResult>,
    durationMs: number,
    config: CliConfig,
    workflow: string,
  ) => Promise<void>;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ run_url: "https://cloud.sweny.ai/runs/abc" }), { status: 200 }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    // Dynamic import to handle any module-level side effects
    const mod = await import("../cloud-report.js");
    reportToCloud = mod.reportToCloud;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeConfig(overrides: Record<string, unknown> = {}): CliConfig {
    return {
      cloudToken: "",
      githubToken: "",
      repository: "acme/widget",
      codingAgentProvider: "claude",
      anthropicApiKey: "",
      claudeOauthToken: "",
      openaiApiKey: "",
      geminiApiKey: "",
      observabilityProviders: [],
      observabilityCredentials: {},
      issueTrackerProvider: "",
      linearApiKey: "",
      linearTeamId: "",
      linearBugLabelId: "",
      linearTriageLabelId: "",
      linearStateBacklog: "",
      linearStateInProgress: "",
      linearStatePeerReview: "",
      timeRange: "",
      severityFocus: "",
      serviceFilter: "",
      investigationDepth: "",
      maxInvestigateTurns: 50,
      maxImplementTurns: 40,
      baseBranch: "main",
      prLabels: [],
      issueLabels: [],
      dryRun: false,
      reviewMode: "review" as const,
      noveltyMode: false,
      issueOverride: "",
      additionalInstructions: "",
      serviceMapPath: "",
      botToken: "",
      sourceControlProvider: "",
      jiraBaseUrl: "",
      jiraEmail: "",
      jiraApiToken: "",
      gitlabToken: "",
      gitlabProjectId: "",
      gitlabBaseUrl: "",
      notificationProvider: "",
      notificationWebhookUrl: "",
      sendgridApiKey: "",
      emailFrom: "",
      emailTo: "",
      webhookSigningSecret: "",
      repositoryOwner: "",
      json: false,
      stream: false,
      bell: false,
      cacheDir: "",
      cacheTtl: 0,
      noCache: false,
      outputDir: "",
      mcpServers: {},
      workspaceTools: [],
      rules: [],
      context: [],
      offline: false,
      fetchAuth: {},
      ...overrides,
    };
  }

  function makeResults(): Map<string, NodeResult> {
    return new Map([
      [
        "investigate",
        {
          status: "success" as const,
          data: { findings: [{ id: "F1" }], recommendation: "implement" },
          toolCalls: [],
        },
      ],
      [
        "create_pr",
        {
          status: "success" as const,
          data: { prUrl: "https://github.com/acme/widget/pull/7", prNumber: 7 },
          toolCalls: [],
        },
      ],
    ]);
  }

  it("does NOT call fetch when cloudToken is empty", async () => {
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "" }), "triage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when repository is missing", async () => {
    const orig = process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY;
    try {
      await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_x", repository: "" }), "triage");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (orig !== undefined) process.env.GITHUB_REPOSITORY = orig;
    }
  });

  it("calls fetch with Bearer cloudToken when token is set", async () => {
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sweny_pk_abc");
  });

  it("does NOT send GITHUB_TOKEN in Authorization header", async () => {
    await reportToCloud(
      makeResults(),
      1000,
      makeConfig({ cloudToken: "sweny_pk_abc", githubToken: "ghs_evil" }),
      "triage",
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).not.toContain("ghs_evil");
    expect(init.headers.Authorization).not.toMatch(/^token /);
  });

  it("posts to SWENY_CLOUD_URL override when set", async () => {
    process.env.SWENY_CLOUD_URL = "https://cloud.example.test";
    try {
      await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://cloud.example.test/api/report");
    } finally {
      delete process.env.SWENY_CLOUD_URL;
    }
  });

  it("silently swallows network failures", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage"),
    ).resolves.toBeUndefined();
  });

  it("prints the run URL when response includes one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).toContain("cloud.sweny.ai/runs/abc");
    logSpy.mockRestore();
  });

  it("payload contains owner, repo, workflow, duration_ms, findings, nodes", async () => {
    await reportToCloud(makeResults(), 1234, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      owner: "acme",
      repo: "widget",
      workflow: "triage",
      duration_ms: 1234,
    });
    expect(Array.isArray(body.findings)).toBe(true);
    expect(Array.isArray(body.nodes)).toBe(true);
  });

  // ── GitHub Actions OIDC path ─────────────────────────────────
  describe("GitHub Actions OIDC", () => {
    const origOidcUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const origOidcToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

    beforeEach(() => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://runner.example/oidc";
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "runner-token";
    });

    afterEach(() => {
      if (origOidcUrl === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
      else process.env.ACTIONS_ID_TOKEN_REQUEST_URL = origOidcUrl;
      if (origOidcToken === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
      else process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = origOidcToken;
    });

    // Route fetch calls: runner mint URL returns JWT, cloud URL returns success.
    function routeFetch(opts: { jwt: string; mintStatus?: number }): void {
      fetchMock.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.startsWith("https://runner.example/oidc")) {
          return new Response(JSON.stringify({ value: opts.jwt }), {
            status: opts.mintStatus ?? 200,
          });
        }
        return new Response(JSON.stringify({ run_url: "https://cloud.sweny.ai/runs/x" }), {
          status: 200,
        });
      });
    }

    it("uses OIDC JWT as Bearer when runner env vars are set", async () => {
      routeFetch({ jwt: "oidc-jwt-value" });

      await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "" }), "triage");

      // Two fetches: mint + report
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const reportCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/api/report"));
      expect(reportCall).toBeDefined();
      expect(reportCall![1].headers.Authorization).toBe("Bearer oidc-jwt-value");
    });

    it("prefers OIDC over cloudToken when both available", async () => {
      routeFetch({ jwt: "oidc-wins" });

      await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");

      const reportCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/api/report"));
      expect(reportCall![1].headers.Authorization).toBe("Bearer oidc-wins");
    });

    it("mints JWT with SWENY_CLOUD_URL as audience when set", async () => {
      process.env.SWENY_CLOUD_URL = "https://cloud.test.example";
      try {
        routeFetch({ jwt: "jwt" });
        await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "" }), "triage");

        const mintCall = fetchMock.mock.calls.find(([url]) => url.toString().startsWith("https://runner.example/oidc"));
        expect(mintCall).toBeDefined();
        const mintUrl = new URL(mintCall![0] as string);
        expect(mintUrl.searchParams.get("audience")).toBe("https://cloud.test.example");
      } finally {
        delete process.env.SWENY_CLOUD_URL;
      }
    });

    it("falls back to cloudToken when OIDC mint fails", async () => {
      fetchMock.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.startsWith("https://runner.example/oidc")) {
          return new Response("nope", { status: 500 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_fallback" }), "triage");

      const reportCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/api/report"));
      expect(reportCall![1].headers.Authorization).toBe("Bearer sweny_pk_fallback");
    });

    it("is a no-op when OIDC fails AND cloudToken is empty", async () => {
      fetchMock.mockImplementation(async (url: string | URL) => {
        if (url.toString().startsWith("https://runner.example/oidc")) {
          return new Response("nope", { status: 500 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "" }), "triage");

      // Mint tried, but no /api/report call because auth could not be resolved
      expect(fetchMock.mock.calls.some(([url]) => url.toString().endsWith("/api/report"))).toBe(false);
    });
  });
});
