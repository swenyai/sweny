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
      observabilityProvider: "",
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
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_x", repository: "" }), "triage");
    expect(fetchMock).not.toHaveBeenCalled();
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
});
