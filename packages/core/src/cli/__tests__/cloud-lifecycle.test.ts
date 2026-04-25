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
} from "../cloud-lifecycle.js";
import type { NodeResult } from "../../types.js";

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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
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
