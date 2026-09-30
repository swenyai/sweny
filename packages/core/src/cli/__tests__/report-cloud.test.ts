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
      anthropicAuthToken: "",
      claudeOauthToken: "",
      anthropicBaseUrl: "",
      swenyAuth: "auto",
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
      verbose: false,
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
      fileRoot: "",
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

  // ── Privacy: the report is shape-only, never raw agent prose ──────────
  //
  // The triage `investigate` node emits findings that carry `title`,
  // `root_cause`, and `fix_approach` — free LLM prose about the customer's
  // private bug and the proposed fix. That MUST NEVER leave the host. These
  // tests pin the leak closed: the serialized POST body may not contain any
  // of those fields or their prose values.
  function makeResultsWithProse(): Map<string, NodeResult> {
    return new Map([
      [
        "investigate",
        {
          status: "success" as const,
          data: {
            recommendation: "implement",
            highest_severity: "high",
            novel_count: 1,
            findings: [
              {
                title: "SECRET_BUG_TITLE null deref in checkout",
                root_cause: "SECRET_ROOT_CAUSE the session token is read before auth resolves",
                fix_approach: "SECRET_FIX_APPROACH guard the token read behind the auth promise",
                severity: "high",
                is_duplicate: false,
                duplicate_of: "OFF-9999",
                fix_complexity: "moderate",
                affected_services: ["checkout-api", "auth-service"],
              },
              {
                title: "SECRET_DUP_TITLE",
                root_cause: "SECRET_DUP_ROOT_CAUSE",
                severity: "low",
                is_duplicate: true,
                fix_complexity: "simple",
                affected_services: ["billing"],
              },
            ],
          },
          toolCalls: [],
        },
      ],
    ]);
  }

  it("does NOT ship root_cause / fix_approach / title or any raw prose", async () => {
    await reportToCloud(makeResultsWithProse(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    const [, init] = fetchMock.mock.calls[0];
    const raw = init.body as string;

    // Prose field values must be absent from the wire entirely.
    for (const secret of [
      "SECRET_BUG_TITLE",
      "SECRET_ROOT_CAUSE",
      "SECRET_FIX_APPROACH",
      "SECRET_DUP_TITLE",
      "SECRET_DUP_ROOT_CAUSE",
      "OFF-9999",
    ]) {
      expect(raw).not.toContain(secret);
    }

    // And no finding object may carry the prose keys, even empty.
    const body = JSON.parse(raw);
    for (const f of body.findings) {
      expect(f).not.toHaveProperty("title");
      expect(f).not.toHaveProperty("root_cause");
      expect(f).not.toHaveProperty("fix_approach");
      expect(f).not.toHaveProperty("duplicate_of");
    }
  });

  it("ships shape-only finding classification: severity, novel/dup, complexity, service count", async () => {
    await reportToCloud(makeResultsWithProse(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);

    expect(body.findings).toEqual([
      {
        severity: "high",
        is_duplicate: false,
        fix_complexity: "moderate",
        affected_services_count: 2,
      },
      {
        severity: "low",
        is_duplicate: true,
        fix_complexity: "simple",
        affected_services_count: 1,
      },
    ]);
    const raw = init.body as string;
    for (const name of ["checkout-api", "auth-service", "billing"]) expect(raw).not.toContain(name);
    for (const f of body.findings) {
      expect(Object.keys(f).sort()).toEqual(["affected_services_count", "fix_complexity", "is_duplicate", "severity"]);
    }
    expect(body.findings_count).toBe(2);
    expect(body.duplicate_count).toBe(1);
    expect(body.severity_counts).toEqual({ high: 1, low: 1 });
  });

  it("top-level report body is a closed key allowlist", async () => {
    await reportToCloud(makeResultsWithProse(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const allowed = new Set([
      "owner",
      "repo",
      "status",
      "workflow",
      "duration_ms",
      "recommendation",
      "findings",
      "findings_count",
      "duplicate_count",
      "severity_counts",
      "highest_severity",
      "novel_count",
      "pr_url",
      "pr_number",
      "issue_url",
      "issue_identifier",
      "issues_found",
      "nodes",
      "action_version",
      "runner_os",
    ]);
    expect(Object.keys(body).filter((k) => !allowed.has(k))).toEqual([]);
    for (const n of body.nodes) expect(Object.keys(n).sort()).toEqual(["id", "name", "status"]);
  });

  it("recommendation is clamped to the enum; free text becomes 'other'", async () => {
    const send = async (rec: unknown) => {
      fetchMock.mockClear();
      const r = new Map([
        ["investigate", { status: "success" as const, data: { recommendation: rec }, toolCalls: [] }],
      ]);
      await reportToCloud(r, 1, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
      const [, init] = fetchMock.mock.calls[0];
      return JSON.parse(init.body as string).recommendation;
    };
    expect(await send("implement")).toBe("implement");
    expect(await send("  Escalate ")).toBe("escalate");
    expect(await send("skip")).toBe("skip");
    expect(await send("implement the null guard in src/auth.ts")).toBe("other");
    expect(await send(42)).toBe("other");
  });
});
