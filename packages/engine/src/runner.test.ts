import { describe, it, expect, vi } from "vitest";
import { runWorkflow, createProviderRegistry } from "./runner.js";
import type { Workflow, WorkflowStep, StepResult, WorkflowContext, RunOptions } from "./types.js";
import type { CacheEntry, StepCache } from "./cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function step(
  name: string,
  phase: WorkflowStep["phase"],
  fn?: (ctx: WorkflowContext) => Promise<StepResult>,
): WorkflowStep {
  return {
    name,
    phase,
    run: fn ?? (() => Promise.resolve({ status: "success" })),
  };
}

function workflow(name: string, steps: WorkflowStep[]): Workflow {
  return { name, steps };
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

describe("createProviderRegistry", () => {
  it("stores and retrieves providers", () => {
    const reg = createProviderRegistry();
    const obs = { verifyAccess: vi.fn() };
    reg.set("observability", obs);

    expect(reg.has("observability")).toBe(true);
    expect(reg.get("observability")).toBe(obs);
  });

  it("throws on missing provider", () => {
    const reg = createProviderRegistry();
    expect(() => reg.get("missing")).toThrow('Provider "missing" is not registered');
  });

  it("reports has() correctly", () => {
    const reg = createProviderRegistry();
    expect(reg.has("x")).toBe(false);
    reg.set("x", 1);
    expect(reg.has("x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runner — Phase Ordering
// ---------------------------------------------------------------------------

describe("runWorkflow", () => {
  it("executes steps in phase order: learn → act → report", async () => {
    const order: string[] = [];

    const wf = workflow("test", [
      step("report-1", "report", async () => {
        order.push("report-1");
        return { status: "success" };
      }),
      step("act-1", "act", async () => {
        order.push("act-1");
        return { status: "success" };
      }),
      step("learn-1", "learn", async () => {
        order.push("learn-1");
        return { status: "success" };
      }),
    ]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });

    expect(result.status).toBe("completed");
    expect(order).toEqual(["learn-1", "act-1", "report-1"]);
  });

  it("preserves step order within a phase", async () => {
    const order: string[] = [];

    const wf = workflow("test", [
      step("learn-a", "learn", async () => {
        order.push("learn-a");
        return { status: "success" };
      }),
      step("learn-b", "learn", async () => {
        order.push("learn-b");
        return { status: "success" };
      }),
      step("act-a", "act", async () => {
        order.push("act-a");
        return { status: "success" };
      }),
      step("act-b", "act", async () => {
        order.push("act-b");
        return { status: "success" };
      }),
    ]);

    await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });
    expect(order).toEqual(["learn-a", "learn-b", "act-a", "act-b"]);
  });

  // ---------------------------------------------------------------------------
  // Result passing between steps
  // ---------------------------------------------------------------------------

  it("passes results between steps via context", async () => {
    let receivedData: unknown;

    const wf = workflow("test", [
      step("producer", "learn", async () => ({
        status: "success",
        data: { answer: 42 },
      })),
      step("consumer", "act", async (ctx) => {
        receivedData = ctx.results.get("producer")?.data;
        return { status: "success" };
      }),
    ]);

    await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });
    expect(receivedData).toEqual({ answer: 42 });
  });

  // ---------------------------------------------------------------------------
  // Failure handling
  // ---------------------------------------------------------------------------

  it("aborts on learn step failure (status: failed)", async () => {
    const actRun = vi.fn(async () => ({ status: "success" as const }));

    const wf = workflow("test", [
      step("learn-ok", "learn", async () => ({ status: "success" })),
      step("learn-fail", "learn", async () => {
        throw new Error("connection refused");
      }),
      step("act-1", "act", { run: actRun } as unknown as WorkflowStep),
    ]);

    // Fix: pass the step with the fn directly
    const wf2 = workflow("test", [
      step("learn-ok", "learn"),
      step("learn-fail", "learn", async () => {
        throw new Error("connection refused");
      }),
      step("act-1", "act", async () => {
        actRun();
        return { status: "success" };
      }),
    ]);

    const result = await runWorkflow(wf2, {}, createProviderRegistry(), { logger: silentLogger });

    expect(result.status).toBe("failed");
    expect(actRun).not.toHaveBeenCalled();

    const failedStep = result.steps.find((s) => s.name === "learn-fail");
    expect(failedStep?.result.status).toBe("failed");
    expect(failedStep?.result.reason).toBe("connection refused");
  });

  it("continues on act step failure (status: partial)", async () => {
    const reportRun = vi.fn();

    const wf = workflow("test", [
      step("learn-1", "learn"),
      step("act-fail", "act", async () => {
        throw new Error("issue tracker down");
      }),
      step("report-1", "report", async () => {
        reportRun();
        return { status: "success" };
      }),
    ]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });

    expect(result.status).toBe("partial");
    expect(reportRun).toHaveBeenCalled();
  });

  it("continues on report step failure (status: partial)", async () => {
    const wf = workflow("test", [
      step("learn-1", "learn"),
      step("report-fail", "report", async () => {
        throw new Error("slack down");
      }),
    ]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });

    expect(result.status).toBe("partial");
  });

  // ---------------------------------------------------------------------------
  // skipPhase
  // ---------------------------------------------------------------------------

  it("skips remaining steps when skipPhase is called", async () => {
    const actRun = vi.fn();

    const wf = workflow("test", [
      step("gate", "learn", async (ctx) => {
        ctx.skipPhase("act", "nothing to do");
        return { status: "success" };
      }),
      step("act-1", "act", async () => {
        actRun();
        return { status: "success" };
      }),
      step("act-2", "act", async () => {
        actRun();
        return { status: "success" };
      }),
      step("report-1", "report"),
    ]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });

    expect(result.status).toBe("completed");
    expect(actRun).not.toHaveBeenCalled();

    const act1 = result.steps.find((s) => s.name === "act-1");
    expect(act1?.result.status).toBe("skipped");
    expect(act1?.result.reason).toBe("nothing to do");

    // Report phase still runs
    const report1 = result.steps.find((s) => s.name === "report-1");
    expect(report1?.result.status).toBe("success");
  });

  it("isPhaseSkipped reflects skip state", async () => {
    let wasSkipped: boolean | undefined;

    const wf = workflow("test", [
      step("gate", "learn", async (ctx) => {
        ctx.skipPhase("act", "skip it");
        return { status: "success" };
      }),
      step("checker", "report", async (ctx) => {
        wasSkipped = ctx.isPhaseSkipped("act");
        return { status: "success" };
      }),
    ]);

    await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });
    expect(wasSkipped).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  it("calls beforeStep and afterStep hooks", async () => {
    const beforeCalls: string[] = [];
    const afterCalls: string[] = [];

    const options: RunOptions = {
      logger: silentLogger,
      beforeStep: async (s) => {
        beforeCalls.push(s.name);
      },
      afterStep: async (s, r) => {
        afterCalls.push(`${s.name}:${r.status}`);
      },
    };

    const wf = workflow("test", [step("learn-1", "learn"), step("act-1", "act")]);

    await runWorkflow(wf, {}, createProviderRegistry(), options);

    expect(beforeCalls).toEqual(["learn-1", "act-1"]);
    expect(afterCalls).toEqual(["learn-1:success", "act-1:success"]);
  });

  it("skips step when beforeStep returns false", async () => {
    const stepRun = vi.fn();

    const options: RunOptions = {
      logger: silentLogger,
      beforeStep: async (s) => {
        if (s.name === "skip-me") return false;
      },
    };

    const wf = workflow("test", [
      step("skip-me", "learn", async () => {
        stepRun();
        return { status: "success" };
      }),
      step("run-me", "learn"),
    ]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), options);

    expect(stepRun).not.toHaveBeenCalled();
    const skipped = result.steps.find((s) => s.name === "skip-me");
    expect(skipped?.result.status).toBe("skipped");
  });

  // ---------------------------------------------------------------------------
  // Config and providers access
  // ---------------------------------------------------------------------------

  it("provides config to steps", async () => {
    let receivedConfig: unknown;

    const wf: Workflow<{ env: string }> = {
      name: "test",
      steps: [
        {
          name: "check-config",
          phase: "learn",
          async run(ctx) {
            receivedConfig = ctx.config;
            return { status: "success" };
          },
        },
      ],
    };

    await runWorkflow(wf, { env: "production" }, createProviderRegistry(), { logger: silentLogger });
    expect(receivedConfig).toEqual({ env: "production" });
  });

  it("provides providers to steps", async () => {
    const fakeObs = { query: vi.fn() };
    const reg = createProviderRegistry();
    reg.set("observability", fakeObs);

    let receivedProvider: unknown;

    const wf = workflow("test", [
      step("use-provider", "learn", async (ctx) => {
        receivedProvider = ctx.providers.get("observability");
        return { status: "success" };
      }),
    ]);

    await runWorkflow(wf, {}, reg, { logger: silentLogger });
    expect(receivedProvider).toBe(fakeObs);
  });

  // ---------------------------------------------------------------------------
  // Timing and metadata
  // ---------------------------------------------------------------------------

  it("records duration", async () => {
    const wf = workflow("test", [step("fast", "learn")]);
    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("handles empty workflow", async () => {
    const wf = workflow("empty", []);
    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger });
    expect(result.status).toBe("completed");
    expect(result.steps).toEqual([]);
  });

  it("uses console logger when none provided", async () => {
    const wf = workflow("test", [step("s1", "learn")]);
    // Should not throw — falls back to consoleLogger
    const result = await runWorkflow(wf, {}, createProviderRegistry());
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe("cache", () => {
  function makeCache(entries: Record<string, CacheEntry> = {}): StepCache & { set: ReturnType<typeof vi.fn> } {
    const store = new Map(Object.entries(entries));
    return {
      get: vi.fn(async (name: string) => store.get(name)),
      set: vi.fn(async (name: string, entry: CacheEntry) => {
        store.set(name, entry);
      }),
    };
  }

  it("replays a cached step result without calling step.run", async () => {
    const run = vi.fn(async () => ({ status: "success" as const, data: { fresh: true } }));
    const cached: CacheEntry = {
      result: { status: "success", data: { fromCache: true } },
      skippedPhases: [],
      createdAt: Date.now(),
    };
    const cache = makeCache({ "step-a": cached });

    const wf = workflow("test", [step("step-a", "learn", run)]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(run).not.toHaveBeenCalled();
    const stepResult = result.steps.find((s) => s.name === "step-a")?.result;
    expect(stepResult?.status).toBe("success");
    expect(stepResult?.cached).toBe(true);
    expect(stepResult?.data).toEqual({ fromCache: true });
  });

  it("runs step normally on cache miss and stores result", async () => {
    const cache = makeCache();

    const wf = workflow("test", [step("step-b", "learn", async () => ({ status: "success", data: { x: 1 } }))]);

    await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(cache.set).toHaveBeenCalledWith(
      "step-b",
      expect.objectContaining({
        result: expect.objectContaining({ status: "success", data: { x: 1 } }),
        skippedPhases: [],
        createdAt: expect.any(Number),
      }),
    );
  });

  it("does not cache failed step results", async () => {
    const cache = makeCache();

    const wf = workflow("test", [
      step("fail-step", "learn", async () => {
        throw new Error("oops");
      }),
    ]);

    await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(cache.set).not.toHaveBeenCalled();
  });

  it("replays skipPhase side effects from cached entry", async () => {
    const actRun = vi.fn(async () => ({ status: "success" as const }));
    const cached: CacheEntry = {
      result: { status: "success" },
      skippedPhases: [{ phase: "act", reason: "nothing to do" }],
      createdAt: Date.now(),
    };
    const cache = makeCache({ gate: cached });

    const wf = workflow("test", [step("gate", "learn"), step("act-1", "act", actRun), step("report-1", "report")]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(actRun).not.toHaveBeenCalled();
    const actStep = result.steps.find((s) => s.name === "act-1");
    expect(actStep?.result.status).toBe("skipped");
    expect(actStep?.result.reason).toBe("nothing to do");
  });

  it("stores skipPhase calls made during a successful step", async () => {
    const cache = makeCache();

    const wf = workflow("test", [
      step("gate", "learn", async (ctx) => {
        ctx.skipPhase("act", "dry run");
        return { status: "success" };
      }),
      step("act-1", "act"),
    ]);

    await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(cache.set).toHaveBeenCalledWith(
      "gate",
      expect.objectContaining({
        skippedPhases: [{ phase: "act", reason: "dry run" }],
      }),
    );
  });

  it("cached result is passed to afterStep hook", async () => {
    const afterStep = vi.fn();
    const cached: CacheEntry = {
      result: { status: "success", data: { v: 42 } },
      skippedPhases: [],
      createdAt: Date.now(),
    };
    const cache = makeCache({ "step-x": cached });

    const wf = workflow("test", [step("step-x", "learn")]);

    await runWorkflow(wf, {}, createProviderRegistry(), {
      logger: silentLogger,
      cache,
      afterStep,
    });

    expect(afterStep).toHaveBeenCalledWith(
      expect.objectContaining({ name: "step-x" }),
      expect.objectContaining({ status: "success", cached: true }),
      expect.anything(),
    );
  });

  it("non-fatal: cache.set error does not fail the workflow", async () => {
    const cache: StepCache = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {
        throw new Error("disk full");
      }),
    };

    const wf = workflow("test", [step("step-y", "learn")]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(result.status).toBe("completed");
  });

  it("cached result is available to downstream steps via ctx.results", async () => {
    let downstream: unknown;
    const cached: CacheEntry = {
      result: { status: "success", data: { answer: 99 } },
      skippedPhases: [],
      createdAt: Date.now(),
    };
    const cache = makeCache({ producer: cached });

    const wf = workflow("test", [
      step("producer", "learn"),
      step("consumer", "act", async (ctx) => {
        downstream = ctx.results.get("producer")?.data;
        return { status: "success" };
      }),
    ]);

    await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(downstream).toEqual({ answer: 99 });
  });
});
