import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExecutionEvent, NodeResult, Observer } from "../../types.js";
import type { CliConfig } from "../config.js";

describe("createCloudStreamObserver", () => {
  let createCloudStreamObserver: (opts: {
    workflow: string;
    config: CliConfig;
    startedAt: number;
  }) => Promise<Observer | null>;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, run_id: "run-uuid-123" }), {
        status: 201,
      }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    const mod = await import("../cloud-stream-observer.js");
    createCloudStreamObserver = mod.createCloudStreamObserver;
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

  function startEvent(workflow = "triage"): ExecutionEvent {
    return { type: "workflow:start", workflow };
  }
  function nodeEnter(node: string): ExecutionEvent {
    return { type: "node:enter", node, instruction: "" };
  }
  function nodeExit(node: string, status: NodeResult["status"] = "success"): ExecutionEvent {
    return {
      type: "node:exit",
      node,
      result: { status, data: {}, toolCalls: [] } as NodeResult,
    };
  }
  function workflowEnd(results: Record<string, NodeResult>): ExecutionEvent {
    return { type: "workflow:end", results };
  }

  // Drain the internal promise chain. Each chained event has multiple awaits
  // (post → res.json → conditional branch), so we need a generous queue flush.
  async function flush(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  }

  // ── Auth resolution ─────────────────────────────────────────────────────

  it("returns null when no token and no OIDC env", async () => {
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "" }),
      startedAt: Date.now(),
    });
    expect(observer).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an Observer function when cloudToken is set", async () => {
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc" }),
      startedAt: Date.now(),
    });
    expect(typeof observer).toBe("function");
  });

  // ── workflow:start → POST /api/report/stream { event: "start" } ─────────

  it("posts start event with workflow + repo metadata, captures run_id", async () => {
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc", repository: "acme/widget" }),
      startedAt: Date.now(),
    });
    observer!(startEvent("triage"));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cloud.sweny.ai/api/report/stream");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer sweny_pk_abc");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      event: "start",
      owner: "acme",
      repo: "widget",
      workflow: "triage",
    });
  });

  // ── node:enter / node:exit fire AFTER start so they have run_id ─────────

  it("serializes node events after start so run_id is set", async () => {
    let resolveStart: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((res) => {
          resolveStart = res;
        }),
    );
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc" }),
      startedAt: Date.now(),
    });

    observer!(startEvent());
    observer!(nodeEnter("gather"));
    await flush();

    // Only the start request has fired so far; node:enter is queued.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveStart(new Response(JSON.stringify({ ok: true, run_id: "run-uuid-xyz" }), { status: 201 }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      event: "node",
      run_id: "run-uuid-xyz",
      node_id: "gather",
      status: "running",
    });
  });

  it("posts node:exit with mapped final status", async () => {
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc" }),
      startedAt: Date.now(),
    });
    observer!(startEvent());
    observer!(nodeExit("gather", "success"));
    observer!(nodeExit("investigate", "failed"));
    observer!(nodeExit("notify", "skipped"));
    await flush();

    // 1 start + 3 node:exit = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const exitBodies = fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(init.body));
    expect(exitBodies[0]).toMatchObject({ event: "node", node_id: "gather", status: "success" });
    expect(exitBodies[1]).toMatchObject({ event: "node", node_id: "investigate", status: "failed" });
    expect(exitBodies[2]).toMatchObject({ event: "node", node_id: "notify", status: "skipped" });
  });

  it("ignores node events fired before workflow:start", async () => {
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc" }),
      startedAt: Date.now(),
    });
    observer!(nodeEnter("gather"));
    observer!(nodeExit("gather"));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── workflow:end → complete event ───────────────────────────────────────

  it("posts complete event with duration, findings, recommendation, pr_url, nodes", async () => {
    const startedAt = Date.now() - 1500;
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc" }),
      startedAt,
    });

    observer!(startEvent());
    observer!(nodeEnter("investigate"));
    observer!(nodeEnter("create_pr"));
    observer!(
      workflowEnd({
        investigate: {
          status: "success",
          data: { findings: [{ id: "F1" }, { id: "F2" }], recommendation: "implement" },
          toolCalls: [],
        } as NodeResult,
        create_pr: {
          status: "success",
          data: {
            prUrl: "https://github.com/acme/widget/pull/7",
            prNumber: 7,
            issueUrl: "https://github.com/acme/widget/issues/6",
            issueIdentifier: "ACME-123",
          },
          toolCalls: [],
        } as NodeResult,
      }),
    );
    await flush();

    const completeCall = fetchMock.mock.calls.find(([, init]) => {
      const body = JSON.parse(init.body);
      return body.event === "complete";
    });
    expect(completeCall).toBeDefined();
    const body = JSON.parse(completeCall![1].body);
    expect(body).toMatchObject({
      event: "complete",
      run_id: "run-uuid-123",
      status: "completed",
      issues_found: true,
      recommendation: "implement",
      pr_url: "https://github.com/acme/widget/pull/7",
      pr_number: 7,
      issue_url: "https://github.com/acme/widget/issues/6",
      issue_identifier: "ACME-123",
    });
    expect(body.duration_ms).toBeGreaterThanOrEqual(1500);
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0]).toMatchObject({ id: "investigate", name: "investigate", status: "success" });
  });

  it("emits status: failed when any node failed", async () => {
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc" }),
      startedAt: Date.now(),
    });
    observer!(startEvent());
    observer!(
      workflowEnd({
        gather: { status: "success", data: {}, toolCalls: [] } as NodeResult,
        investigate: { status: "failed", data: {}, toolCalls: [] } as NodeResult,
      }),
    );
    await flush();

    const completeCall = fetchMock.mock.calls.find(([, init]) => JSON.parse(init.body).event === "complete");
    expect(JSON.parse(completeCall![1].body)).toMatchObject({ status: "failed" });
  });

  // ── Failure isolation ───────────────────────────────────────────────────

  it("silently swallows fetch failures and keeps processing later events", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc" }),
      startedAt: Date.now(),
    });

    // First call (start) rejects — observer must not throw.
    expect(() => observer!(startEvent())).not.toThrow();
    await flush();

    // Without a run_id the next node:enter is a no-op, but the chain must
    // remain alive; any error from a queued POST must not crash the chain.
    expect(() => observer!(nodeEnter("gather"))).not.toThrow();
    await flush();
  });

  it("does NOT send GITHUB_TOKEN as Authorization", async () => {
    const observer = await createCloudStreamObserver({
      workflow: "triage",
      config: makeConfig({ cloudToken: "sweny_pk_abc", githubToken: "ghs_evil" }),
      startedAt: Date.now(),
    });
    observer!(startEvent());
    await flush();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).not.toContain("ghs_evil");
    expect(init.headers.Authorization).not.toMatch(/^token /);
  });

  // ── SWENY_CLOUD_URL override ────────────────────────────────────────────

  it("posts to SWENY_CLOUD_URL override when set", async () => {
    process.env.SWENY_CLOUD_URL = "https://cloud.test.example";
    try {
      const observer = await createCloudStreamObserver({
        workflow: "triage",
        config: makeConfig({ cloudToken: "sweny_pk_abc" }),
        startedAt: Date.now(),
      });
      observer!(startEvent());
      await flush();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://cloud.test.example/api/report/stream");
    } finally {
      delete process.env.SWENY_CLOUD_URL;
    }
  });

  // ── GitHub Actions OIDC ────────────────────────────────────────────────

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

    function routeFetch(jwt: string, mintStatus = 200) {
      fetchMock.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.startsWith("https://runner.example/oidc")) {
          return new Response(JSON.stringify({ value: jwt }), { status: mintStatus });
        }
        return new Response(JSON.stringify({ ok: true, run_id: "run-from-oidc" }), {
          status: 201,
        });
      });
    }

    it("uses OIDC JWT as Bearer when runner env vars are set", async () => {
      routeFetch("oidc-jwt-value");
      const observer = await createCloudStreamObserver({
        workflow: "triage",
        config: makeConfig({ cloudToken: "" }),
        startedAt: Date.now(),
      });
      expect(observer).not.toBeNull();
      observer!(startEvent());
      await flush();

      const reportCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/api/report/stream"));
      expect(reportCall![1].headers.Authorization).toBe("Bearer oidc-jwt-value");
    });

    it("prefers OIDC over cloudToken when both available", async () => {
      routeFetch("oidc-wins");
      const observer = await createCloudStreamObserver({
        workflow: "triage",
        config: makeConfig({ cloudToken: "sweny_pk_abc" }),
        startedAt: Date.now(),
      });
      observer!(startEvent());
      await flush();

      const reportCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/api/report/stream"));
      expect(reportCall![1].headers.Authorization).toBe("Bearer oidc-wins");
    });

    it("falls back to cloudToken when OIDC mint fails", async () => {
      routeFetch("ignored", 500);
      const observer = await createCloudStreamObserver({
        workflow: "triage",
        config: makeConfig({ cloudToken: "sweny_pk_fallback" }),
        startedAt: Date.now(),
      });
      observer!(startEvent());
      await flush();

      const reportCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/api/report/stream"));
      expect(reportCall![1].headers.Authorization).toBe("Bearer sweny_pk_fallback");
    });

    it("returns null when OIDC fails AND cloudToken empty", async () => {
      routeFetch("ignored", 500);
      const observer = await createCloudStreamObserver({
        workflow: "triage",
        config: makeConfig({ cloudToken: "" }),
        startedAt: Date.now(),
      });
      expect(observer).toBeNull();
    });
  });
});
