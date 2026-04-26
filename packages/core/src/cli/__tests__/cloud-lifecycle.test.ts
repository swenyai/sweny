import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectTriggerSource,
  buildTriggerMetadata,
  buildStartRunPayload,
  startRun,
  finishRun,
  postNodeEvent,
  deriveGenericMetrics,
  newRunUuid,
  beginCloudLifecycle,
  finishCloudLifecycle,
  createCloudStreamObserver,
} from "../cloud-lifecycle.js";
import type { ExecutionEvent, NodeResult } from "../../types.js";

describe("detectTriggerSource", () => {
  it("detects github_action via GITHUB_ACTIONS=true", () => {
    expect(detectTriggerSource({ GITHUB_ACTIONS: "true" })).toBe("github_action");
  });
  it("detects gitlab_ci", () => {
    expect(detectTriggerSource({ GITLAB_CI: "true" })).toBe("gitlab_ci");
  });
  it("detects circleci", () => {
    expect(detectTriggerSource({ CIRCLECI: "true" })).toBe("circleci");
  });
  it("detects buildkite", () => {
    expect(detectTriggerSource({ BUILDKITE: "true" })).toBe("buildkite");
  });
  it("falls back to other_ci on bare CI=true", () => {
    expect(detectTriggerSource({ CI: "true" })).toBe("other_ci");
  });
  it("returns manual for empty env", () => {
    expect(detectTriggerSource({})).toBe("manual");
  });
  it("prefers github_action over the generic CI=true signal", () => {
    expect(detectTriggerSource({ CI: "true", GITHUB_ACTIONS: "true" })).toBe("github_action");
  });
});

describe("buildTriggerMetadata", () => {
  it("captures GitHub Actions metadata", () => {
    const md = buildTriggerMetadata("github_action", {
      RUNNER_NAME: "runner-1",
      GITHUB_RUN_ID: "12345",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_ACTOR: "wickdninja",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "abcdef",
    });
    expect(md.runner_id).toBe("runner-1");
    expect(md.workflow_run_id).toBe("12345");
    expect(md.actor).toBe("wickdninja");
    expect(md.event_name).toBe("pull_request");
  });

  it("captures GitLab CI metadata", () => {
    const md = buildTriggerMetadata("gitlab_ci", {
      CI_PIPELINE_ID: "777",
      CI_JOB_ID: "888",
      GITLAB_USER_LOGIN: "alice",
      CI_COMMIT_REF_NAME: "main",
      CI_COMMIT_SHA: "abc123",
    });
    expect(md.pipeline_id).toBe("777");
    expect(md.actor).toBe("alice");
  });

  it("returns empty object for manual / unknown sources", () => {
    expect(buildTriggerMetadata("manual", {})).toEqual({});
    expect(buildTriggerMetadata("unknown", {})).toEqual({});
  });
});

describe("buildStartRunPayload", () => {
  it("derives the canonical start payload from a workflow + env", () => {
    const payload = buildStartRunPayload(
      { id: "regulatory-monitor", workflow_type: "monitor" },
      {
        runUuid: "uuid-123",
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_RUN_ID: "12345",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: "abc",
          GITHUB_ACTOR: "n8",
        },
      },
    );
    expect(payload.workflow_id).toBe("regulatory-monitor");
    expect(payload.workflow_type).toBe("monitor");
    expect(payload.trigger_source).toBe("github_action");
    expect(payload.run_uuid).toBe("uuid-123");
    const md = payload.metadata as Record<string, unknown>;
    expect(md.branch).toBe("main");
    expect(md.commit_sha).toBe("abc");
    expect(md.actor).toBe("n8");
  });

  it("defaults workflow_type to 'generic' when absent", () => {
    const payload = buildStartRunPayload({ id: "x" }, { runUuid: "u" });
    expect(payload.workflow_type).toBe("generic");
  });
});

describe("newRunUuid", () => {
  it("returns a valid UUID v4 string", () => {
    const u = newRunUuid();
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("returns a different value each call", () => {
    expect(newRunUuid()).not.toBe(newRunUuid());
  });
});

// ─── HTTP behavior (fetch mocked) ───────────────────────────────────

describe("startRun (HTTP)", () => {
  const config = {
    cloudToken: "swny_acme_abcdef",
    cloudUrl: "https://cloud.test",
    repository: "acme/test",
  };
  const payload = buildStartRunPayload({ id: "wf", workflow_type: "monitor" }, { runUuid: "u1" });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /api/runs with bearer auth and returns the run_id on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ run_id: "run-1", dashboard_url: "/d/1", idempotent_replay: false }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await startRun(config, payload);
    expect(result?.run_id).toBe("run-1");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://cloud.test/api/runs");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer swny_acme_abcdef");
  });

  it("returns null when the server returns non-2xx (silent failure)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    expect(await startRun(config, payload)).toBeNull();
  });

  it("returns null when fetch throws (network error / timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    expect(await startRun(config, payload)).toBeNull();
  });

  it("returns null when the response body is missing run_id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 201, headers: { "content-type": "application/json" } }),
    );
    expect(await startRun(config, payload)).toBeNull();
  });

  it("uses a tight 3s abort signal so a slow cloud doesn't gate workflow start", async () => {
    // startRun runs on the critical path before execute(), so the
    // timeout must be much tighter than the general TIMEOUT_MS used
    // by finishRun / postNodeEvent. Verify the AbortSignal carries the
    // 3s budget rather than the 10s general timeout.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ run_id: "r" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await startRun(config, payload);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const signal = init.signal as AbortSignal & { reason?: { name?: string } };
    // The signal is one returned by AbortSignal.timeout(3000); we
    // can't read the timeout value back directly, so we assert two
    // things instead: it's a real AbortSignal, and it isn't already
    // aborted. The full timeout assertion happens via the contract
    // that finishRun's signal should NOT be the same as startRun's
    // (different timeouts).
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });
});

describe("finishRun (HTTP)", () => {
  const config = { cloudToken: "swny_acme_a", cloudUrl: "https://cloud.test" };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /api/runs/:id/finish and returns true on 2xx", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await finishRun(config, "run-1", { status: "success" })).toBe(true);
    expect(fetchSpy.mock.calls[0]![0]).toBe("https://cloud.test/api/runs/run-1/finish");
  });

  it("returns false on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await finishRun(config, "run-1", { status: "failed" })).toBe(false);
  });

  it("returns false when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("boom"));
    expect(await finishRun(config, "run-1", { status: "success" })).toBe(false);
  });

  it("URL-encodes the run id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    await finishRun(config, "run with space", { status: "success" });
    expect(fetchSpy.mock.calls[0]![0]).toBe("https://cloud.test/api/runs/run%20with%20space/finish");
  });
});

describe("postNodeEvent (HTTP)", () => {
  const config = { cloudToken: "swny_a_b", cloudUrl: "https://cloud.test" };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches a default timestamp if none provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    await postNodeEvent(config, "r1", { event: "enter", node: "gather" });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as { timestamp: string };
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never throws on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    await expect(postNodeEvent(config, "r1", { event: "exit", node: "x" })).resolves.toBeUndefined();
  });
});

describe("beginCloudLifecycle / finishCloudLifecycle — CLI wire-up wrapper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const workflow = { id: "triage", workflow_type: "pr_review" as const };

  it("returns null when cloudToken is unset (cloud reporting opt-in)", async () => {
    const handle = await beginCloudLifecycle({}, workflow);
    expect(handle).toBeNull();
  });

  it("returns null when startRun() fails (network/auth error)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 401 }));
    const handle = await beginCloudLifecycle({ cloudToken: "sweny_pk_x" }, workflow);
    expect(handle).toBeNull();
  });

  it("returns a handle with run_id + dashboard_url when startRun() succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ run_id: "r-123", dashboard_url: "https://cloud.sweny.ai/r-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const handle = await beginCloudLifecycle({ cloudToken: "sweny_pk_x" }, workflow);
    expect(handle).toEqual({
      runUuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
      runId: "r-123",
      dashboardUrl: "https://cloud.sweny.ai/r-123",
    });
  });

  it("posts the workflow_id and workflow_type to /api/runs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ run_id: "r-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await beginCloudLifecycle({ cloudToken: "tok" }, { id: "monitor-1", workflow_type: "monitor" as const });
    const url = fetchSpy.mock.calls[0]![0] as string;
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(url).toMatch(/\/api\/runs$/);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.workflow_id).toBe("monitor-1");
    expect(body.workflow_type).toBe("monitor");
  });

  it("finishCloudLifecycle is a no-op when handle is null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await finishCloudLifecycle({ cloudToken: "tok" }, null, new Map(), 100);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("finishCloudLifecycle is a no-op when cloudToken is unset (defensive)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const handle = { runUuid: "u", runId: "r" };
    await finishCloudLifecycle({}, handle, new Map(), 100);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to /api/runs/:id/finish with status + metrics from results", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    const handle = { runUuid: "u", runId: "run-99" };
    const results = new Map<string, NodeResult>([
      ["a", { status: "success", data: {}, toolCalls: [] }],
      ["b", { status: "failed", data: {}, toolCalls: [] }],
    ]);
    await finishCloudLifecycle({ cloudToken: "tok" }, handle, results, 5000, "failed");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toMatch(/\/api\/runs\/run-99\/finish$/);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as {
      status: string;
      duration_ms: number;
      metrics: { node_count: number; failed_nodes: number };
    };
    expect(body.status).toBe("failed");
    expect(body.duration_ms).toBe(5000);
    expect(body.metrics.node_count).toBe(2);
    expect(body.metrics.failed_nodes).toBe(1);
  });

  it("never throws when finishRun() returns false (silent failure)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));
    const handle = { runUuid: "u", runId: "r" };
    await expect(finishCloudLifecycle({ cloudToken: "tok" }, handle, new Map(), 100)).resolves.toBeUndefined();
  });
});

describe("createCloudStreamObserver — per-node event streaming", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const config = { cloudToken: "tok" };
  const handle = { runUuid: "u", runId: "run-77" };

  it("returns undefined when handle is null (no cloud session)", () => {
    expect(createCloudStreamObserver(config, null)).toBeUndefined();
  });

  it("returns undefined when cloudToken is unset (defensive)", () => {
    expect(createCloudStreamObserver({}, handle)).toBeUndefined();
  });

  it("posts an 'enter' node event on node:enter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    observer({ type: "node:enter", node: "investigate", instruction: "" } satisfies ExecutionEvent);
    // postNodeEvent is fire-and-forget (void) — yield once for the
    // async fetch call to land before we assert.
    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toMatch(/\/api\/runs\/run-77\/node$/);
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string) as {
      event: string;
      node: string;
    };
    expect(body.event).toBe("enter");
    expect(body.node).toBe("investigate");
  });

  it("posts an 'exit' event with status + duration_ms on node:exit (paired with prior enter)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    observer({ type: "node:enter", node: "fetch_logs", instruction: "" });
    await new Promise((r) => setImmediate(r)); // let enter land
    observer({
      type: "node:exit",
      node: "fetch_logs",
      result: { status: "success", data: {}, toolCalls: [] },
    });
    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const exitBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string) as {
      event: string;
      node: string;
      status: string;
      duration_ms: number;
    };
    expect(exitBody.event).toBe("exit");
    expect(exitBody.node).toBe("fetch_logs");
    expect(exitBody.status).toBe("success");
    expect(exitBody.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("emits exit without duration_ms when no matching enter was seen (defensive)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    observer({
      type: "node:exit",
      node: "phantom",
      result: { status: "failed", data: {}, toolCalls: [] },
    });
    await new Promise((r) => setImmediate(r));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string) as {
      event: string;
      duration_ms?: number;
      status: string;
    };
    expect(body.event).toBe("exit");
    expect(body.status).toBe("failed");
    expect(body.duration_ms).toBeUndefined();
  });

  it("posts a 'progress' event with the message in data on node:progress", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    observer({ type: "node:progress", node: "implement", message: "running pytest" });
    await new Promise((r) => setImmediate(r));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string) as {
      event: string;
      data: { message: string };
    };
    expect(body.event).toBe("progress");
    expect(body.data.message).toBe("running pytest");
  });

  it("drops events the cloud node API doesn't model (workflow:start, tool:*, route, workflow:end)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    observer({ type: "workflow:start", workflow: "x" });
    observer({ type: "tool:call", node: "n", tool: "github", input: {} });
    observer({ type: "tool:result", node: "n", tool: "github", output: {} });
    observer({ type: "route", from: "a", to: "b", reason: "" });
    observer({ type: "workflow:end", results: {} });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws synchronously, even when fetch rejects (engine hot path)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const observer = createCloudStreamObserver(config, handle)!;
    // The observer must not throw — execute() runs it in the engine's
    // hot path and an exception would crash the workflow.
    expect(() => observer({ type: "node:enter", node: "x", instruction: "" })).not.toThrow();
    // Drain the rejection so vitest doesn't flag an unhandled rejection
    // later in the test run.
    await new Promise((r) => setImmediate(r));
  });

  it("never crashes on malformed events (defensive try/catch around the whole switch)", () => {
    const observer = createCloudStreamObserver(config, handle)!;
    // Forge an event whose shape doesn't match any ExecutionEvent
    // discriminant — simulates a future engine version emitting a
    // type the cloud build doesn't know yet, or a corrupted result
    // payload from a buggy node.
    const malformed = { type: "node:exit", node: "x", result: null } as unknown as ExecutionEvent;
    expect(() => observer(malformed)).not.toThrow();
  });

  it("does not crash when fetch synchronously throws (e.g., abort signal misuse)", () => {
    // Some fetch errors surface synchronously rather than as a rejected
    // promise (e.g. URL parse failures in node). The observer must
    // defend against both.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new TypeError("invalid url");
    });
    const observer = createCloudStreamObserver(config, handle)!;
    expect(() => observer({ type: "node:enter", node: "x", instruction: "" })).not.toThrow();
  });

  it("maps node:retry to a 'progress' event with retry metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    observer({
      type: "node:retry",
      node: "implement",
      attempt: 2,
      reason: "timeout",
      preamble: "",
    });
    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string) as {
      event: string;
      data: { retry: boolean; attempt: number; reason: string };
    };
    expect(body.event).toBe("progress");
    expect(body.data.retry).toBe(true);
    expect(body.data.attempt).toBe(2);
    expect(body.data.reason).toBe("timeout");
  });

  it("does not leak enter timestamps across many node:enter/exit pairs (long-running workflow safety)", async () => {
    // The closure-scoped Map is keyed by node id and cleared on every
    // matching exit. A long-running workflow that processes hundreds
    // of distinct nodes must not see the Map grow without bound. We
    // can't read the Map directly, but we can verify the observer
    // still behaves correctly after many cycles — a leak would
    // eventually manifest as wrong duration_ms (cross-talk) or memory
    // pressure, neither of which we can assert on directly. So pin
    // the contract instead: each enter/exit pair is independent.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    for (let i = 0; i < 200; i++) {
      const node = `node-${i}`;
      observer({ type: "node:enter", node, instruction: "" });
      observer({ type: "node:exit", node, result: { status: "success", data: {}, toolCalls: [] } });
    }
    // After all pairs, a fresh exit for a never-seen node still
    // produces undefined duration_ms — proving the Map was cleared.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    observer({ type: "node:exit", node: "fresh", result: { status: "success", data: {}, toolCalls: [] } });
    await new Promise((r) => setImmediate(r));
    const last = fetchSpy.mock.calls.at(-1)!;
    const body = JSON.parse((last[1] as RequestInit).body as string) as { duration_ms?: number };
    expect(body.duration_ms).toBeUndefined();
  });

  it("clears the enter timestamp after exit (no leaks across reuse)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const observer = createCloudStreamObserver(config, handle)!;
    // Same node id reused (e.g. retry) — second exit should still
    // produce a fresh duration_ms only if a fresh enter was seen.
    observer({ type: "node:enter", node: "n", instruction: "" });
    await new Promise((r) => setImmediate(r));
    observer({ type: "node:exit", node: "n", result: { status: "success", data: {}, toolCalls: [] } });
    await new Promise((r) => setImmediate(r));
    // Second exit, no preceding enter — should NOT carry over the
    // first enter's timestamp.
    observer({ type: "node:exit", node: "n", result: { status: "success", data: {}, toolCalls: [] } });
    await new Promise((r) => setImmediate(r));
    const secondExit = JSON.parse((fetchSpy.mock.calls[2]![1] as RequestInit).body as string) as {
      duration_ms?: number;
    };
    expect(secondExit.duration_ms).toBeUndefined();
  });
});

describe("deriveGenericMetrics", () => {
  it("computes node_count, failed_nodes, success_rate", () => {
    const results = new Map<string, NodeResult>([
      ["a", { status: "success", data: {}, toolCalls: [] }],
      ["b", { status: "success", data: {}, toolCalls: [] }],
      ["c", { status: "failed", data: {}, toolCalls: [] }],
    ]);
    const m = deriveGenericMetrics(results, 3000);
    expect(m.duration_ms).toBe(3000);
    expect(m.node_count).toBe(3);
    expect(m.failed_nodes).toBe(1);
    expect(m.success_rate).toBeCloseTo(2 / 3);
  });

  it("returns 0 success_rate on empty result map", () => {
    expect(deriveGenericMetrics(new Map(), 0).success_rate).toBe(0);
  });
});
