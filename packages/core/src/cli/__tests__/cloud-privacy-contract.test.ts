import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeResult } from "../../types.js";
import type { CliConfig } from "../config.js";

/**
 * Privacy contract: a default install makes zero outbound requests.
 *
 * PRIVACY.md, SECURITY.md, README.md and action.yml all state that reporting
 * is inert unless the operator sets `SWENY_CLOUD_TOKEN` themselves. That is a
 * promise to users, so it is pinned here rather than left to the individual
 * unit tests of each module.
 *
 * Two layers:
 *
 *  1. Behavior — every entry point the CLI calls with a user-supplied config
 *     is exercised token-free, and `fetch` must never be reached.
 *  2. Inventory — the exported surface of both cloud modules is locked, so a
 *     newly exported function fails this suite until someone classifies it as
 *     a gated entry point or an internal primitive. Without this, layer 1
 *     silently stops being exhaustive the moment the surface grows.
 */

/** Entry points reachable from `main.ts` with the operator's own config. Each MUST self-gate. */
const GATED_ENTRY_POINTS = [
  "reportToCloud",
  "beginCloudLifecycle",
  "finishCloudLifecycle",
  "createCloudStreamObserver",
] as const;

/**
 * Primitives that issue a request unconditionally, by design. They take a
 * `CloudReportConfig` whose `cloudToken` is required, and are only reachable
 * through a gated entry point above. They are NOT part of the no-token
 * guarantee — the gate lives in their callers.
 */
const UNGATED_PRIMITIVES = ["startRun", "finishRun", "postNodeEvent"] as const;

/** Pure helpers: no I/O, safe to call with anything. */
const PURE_HELPERS = [
  "detectTriggerSource",
  "buildTriggerMetadata",
  "newRunUuid",
  "buildStartRunPayload",
  "deriveGenericMetrics",
] as const;

describe("cloud privacy contract", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    // A stray SWENY_CLOUD_URL must not be enough to trigger a request on its
    // own — only the token opts in.
    delete process.env.SWENY_CLOUD_TOKEN;
    process.env.SWENY_CLOUD_URL = "https://should-never-be-called.invalid";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SWENY_CLOUD_URL;
  });

  /** A config with no cloud token, i.e. what every default install produces. */
  function tokenlessConfig(): CliConfig {
    return { repository: "acme/widgets" } as unknown as CliConfig;
  }

  function sampleResults(): Map<string, NodeResult> {
    return new Map<string, NodeResult>([
      ["investigate", { status: "success", data: { recommendation: "ship it" }, toolCalls: [] }],
      ["create_pr", { status: "failed", data: {}, toolCalls: [] }],
    ]);
  }

  describe("no token, no network", () => {
    it("reportToCloud issues no request", async () => {
      const { reportToCloud } = await import("../cloud-report.js");

      await reportToCloud(sampleResults(), 1234, tokenlessConfig(), "triage");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("beginCloudLifecycle issues no request and yields no handle", async () => {
      const { beginCloudLifecycle } = await import("../cloud-lifecycle.js");

      const handle = await beginCloudLifecycle(tokenlessConfig(), {
        id: "triage",
        workflow_type: "generic",
      });

      expect(handle).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("finishCloudLifecycle issues no request, even when handed a live handle", async () => {
      const { finishCloudLifecycle } = await import("../cloud-lifecycle.js");

      // Deliberately pass a non-null handle: the token check must stand on its
      // own, not lean on the handle being null.
      await finishCloudLifecycle(
        tokenlessConfig(),
        { runUuid: "uuid-1", runId: "run-1" },
        sampleResults(),
        999,
        "success",
      );

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("createCloudStreamObserver returns undefined, so the engine streams nowhere", async () => {
      const { createCloudStreamObserver } = await import("../cloud-lifecycle.js");

      const observer = createCloudStreamObserver(tokenlessConfig(), {
        runUuid: "uuid-1",
        runId: "run-1",
      });

      expect(observer).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a full triage-shaped run touches the network zero times end to end", async () => {
      const { reportToCloud } = await import("../cloud-report.js");
      const { beginCloudLifecycle, finishCloudLifecycle, createCloudStreamObserver } =
        await import("../cloud-lifecycle.js");

      // Mirrors the call order in main.ts: begin -> observe -> finish -> report.
      const config = tokenlessConfig();
      const workflow = { id: "triage", workflow_type: "generic" } as const;
      const results = sampleResults();

      const handle = await beginCloudLifecycle(config, workflow);
      const observer = createCloudStreamObserver(config, handle);
      observer?.({ type: "workflow:start", workflow: "triage" } as never);
      observer?.({ type: "node:enter", node: "investigate" } as never);
      observer?.({ type: "workflow:end", results: {} } as never);
      await finishCloudLifecycle(config, handle, results, 4321, "success");
      await reportToCloud(results, 4321, config, "triage");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an empty-string token is treated as absent, not as a credential", async () => {
      const { reportToCloud } = await import("../cloud-report.js");
      const { beginCloudLifecycle } = await import("../cloud-lifecycle.js");

      const config = { ...tokenlessConfig(), cloudToken: "" } as unknown as CliConfig;

      await reportToCloud(sampleResults(), 1, config, "triage");
      const handle = await beginCloudLifecycle(config, { id: "triage", workflow_type: "generic" });

      expect(handle).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("exported surface inventory", () => {
    // Guards the completeness of the suite above. If this fails, a cloud
    // function was added or renamed: decide whether it is a gated entry point
    // (add a no-token test above, then list it in GATED_ENTRY_POINTS) or an
    // internal primitive (list it in UNGATED_PRIMITIVES).
    it("cloud-lifecycle exports nothing unclassified", async () => {
      const mod = await import("../cloud-lifecycle.js");
      const runtimeFns = Object.keys(mod)
        .filter((k) => typeof (mod as Record<string, unknown>)[k] === "function")
        .sort();

      const classified = [...GATED_ENTRY_POINTS, ...UNGATED_PRIMITIVES, ...PURE_HELPERS];

      expect(runtimeFns.filter((fn) => !classified.includes(fn as never))).toEqual([]);
    });

    it("cloud-report exports nothing unclassified", async () => {
      const mod = await import("../cloud-report.js");
      const runtimeFns = Object.keys(mod)
        .filter((k) => typeof (mod as Record<string, unknown>)[k] === "function")
        .sort();

      expect(runtimeFns.filter((fn) => !GATED_ENTRY_POINTS.includes(fn as never))).toEqual([]);
    });

    it("every gated entry point is actually exported somewhere", async () => {
      const lifecycle = await import("../cloud-lifecycle.js");
      const report = await import("../cloud-report.js");
      const available = new Set([...Object.keys(lifecycle), ...Object.keys(report)]);

      expect(GATED_ENTRY_POINTS.filter((fn) => !available.has(fn))).toEqual([]);
    });
  });
});
