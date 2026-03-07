# Task: Tests for engine step-level cache

## Why

`packages/engine/src/runner.ts` has a full cache path: hit replay, miss fallthrough,
`skipPhase` side-effect replay, `cached: true` flag, and non-fatal `cache.set` errors.
None of this is exercised by the existing `runner.test.ts` tests.

The `StepCache` interface is in `packages/engine/src/cache.ts`. The runner accepts it
via `RunOptions.cache`.

---

## File to extend

**`packages/engine/src/runner.test.ts`** — add a new `describe("cache", ...)` block
at the bottom of the file.

---

## Tests to write

```typescript
// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe("cache", () => {
  function makeCache(entries: Record<string, CacheEntry> = {}): StepCache {
    const store = new Map(Object.entries(entries));
    return {
      get: vi.fn(async (name) => store.get(name)),
      set: vi.fn(async (name, entry) => { store.set(name, entry); }),
    };
  }

  it("replays a cached step result without calling step.run", async () => {
    const run = vi.fn(async () => ({ status: "success" as const, data: { fresh: true } }));
    const cached: CacheEntry = {
      result: { status: "success", data: { cached: true } },
      skippedPhases: [],
      createdAt: Date.now(),
    };
    const cache = makeCache({ "step-a": cached });

    const wf = workflow("test", [
      step("step-a", "learn", run),
    ]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), {
      logger: silentLogger,
      cache,
    });

    expect(run).not.toHaveBeenCalled();
    const stepResult = result.steps.find((s) => s.name === "step-a")?.result;
    expect(stepResult?.status).toBe("success");
    expect(stepResult?.cached).toBe(true);
    expect(stepResult?.data).toEqual({ cached: true });
  });

  it("runs step normally on cache miss and stores result", async () => {
    const cache = makeCache(); // empty
    const wf = workflow("test", [
      step("step-b", "learn", async () => ({ status: "success", data: { x: 1 } })),
    ]);

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
      step("fail-step", "learn", async () => { throw new Error("oops"); }),
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
    const cache = makeCache({ "gate": cached });

    const wf = workflow("test", [
      step("gate", "learn"),
      step("act-1", "act", actRun),
      step("report-1", "report"),
    ]);

    const result = await runWorkflow(wf, {}, createProviderRegistry(), { logger: silentLogger, cache });

    expect(actRun).not.toHaveBeenCalled();
    const actStep = result.steps.find((s) => s.name === "act-1");
    expect(actStep?.result.status).toBe("skipped");
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
      set: vi.fn(async () => { throw new Error("disk full"); }),
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
    const cache = makeCache({ "producer": cached });

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
```

---

## Imports to add

Add `CacheEntry` and `StepCache` to the import line at the top of `runner.test.ts`:

```typescript
import type { Workflow, WorkflowStep, StepResult, WorkflowContext, RunOptions, CacheEntry, StepCache } from "./types.js";
```

Wait — `CacheEntry` and `StepCache` are exported from `cache.ts`, not `types.ts`.
Import them separately:

```typescript
import type { CacheEntry, StepCache } from "./cache.js";
```

---

## How to run

```bash
cd packages/engine
npm test
```

Target: 8 new cache tests, all 22 existing tests still pass.
