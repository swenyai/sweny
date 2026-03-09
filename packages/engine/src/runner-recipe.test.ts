import { describe, it, expect, vi } from "vitest";
import { runRecipe, createRecipe, validateDefinition } from "./runner-recipe.js";
import { createProviderRegistry } from "./runner-recipe.js";
import type { StepResult, WorkflowContext } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

type Cfg = Record<string, unknown>;

const providers = createProviderRegistry();
const opts = { logger: silentLogger };

// ---------------------------------------------------------------------------
// Basic execution
// ---------------------------------------------------------------------------

describe("runRecipe — basic execution", () => {
  it("executes all nodes in declaration order when no on: transitions", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => { order.push("a"); return { status: "success" }; },
        b: async () => { order.push("b"); return { status: "success" }; },
        c: async () => { order.push("c"); return { status: "success" }; },
      },
    );

    const result = await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["a", "b", "c"]);
    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
  });

  it("returns completed status when all steps succeed", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("completed");
  });

  it("includes duration in result", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: { a: { phase: "learn" } },
      },
      { a: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("accumulates step results in WorkflowContext.results", async () => {
    let seenResults: Map<string, StepResult> | undefined;
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "first",
        states: {
          first: { phase: "learn", next: "second" },
          second: { phase: "act" },
        },
      },
      {
        first: async () => ({ status: "success", data: { x: 1 } }),
        second: async (ctx) => {
          seenResults = new Map(ctx.results);
          return { status: "success" };
        },
      },
    );

    await runRecipe(r, {}, providers, opts);

    expect(seenResults?.get("first")?.data).toEqual({ x: 1 });
  });

  it("passes config to each step via ctx.config", async () => {
    const config = { myKey: "myValue" };
    let receivedConfig: unknown;
    const r = createRecipe<typeof config>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: { a: { phase: "learn" } },
      },
      {
        a: async (ctx) => {
          receivedConfig = ctx.config;
          return { status: "success" };
        },
      },
    );

    await runRecipe(r, config, providers, opts);

    expect(receivedConfig).toBe(config);
  });
});

// ---------------------------------------------------------------------------
// on: transition routing
// ---------------------------------------------------------------------------

describe("runRecipe — on: transition routing", () => {
  it("follows on: transition when result.data.outcome matches", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "gate",
        states: {
          gate: { phase: "act", on: { "branch-a": "node-a", "branch-b": "node-b" } },
          "node-a": { phase: "act" },
          "node-b": { phase: "act" },
        },
      },
      {
        gate: async () => ({ status: "success", data: { outcome: "branch-b" } }),
        "node-a": async () => { order.push("a"); return { status: "success" }; },
        "node-b": async () => { order.push("b"); return { status: "success" }; },
      },
    );

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });

  it("falls back to status when data.outcome has no matching on: key", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "gate",
        states: {
          gate: { phase: "act", on: { success: "node-b" } },
          "node-a": { phase: "act" },
          "node-b": { phase: "act" },
        },
      },
      {
        gate: async () => ({ status: "success", data: { outcome: "unknown-outcome" } }),
        "node-a": async () => { order.push("a"); return { status: "success" }; },
        "node-b": async () => { order.push("b"); return { status: "success" }; },
      },
    );

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });

  it("stops when on: transition resolves to 'end'", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "gate",
        states: {
          gate: { phase: "act", on: { skip: "end", implement: "next" } },
          next: { phase: "act" },
        },
      },
      {
        gate: async () => ({ status: "success", data: { outcome: "skip" } }),
        next: async () => { order.push("next"); return { status: "success" }; },
      },
    );

    const result = await runRecipe(r, {}, providers, opts);

    expect(order).toEqual([]);
    expect(result.status).toBe("completed");
  });

  it("skips intervening nodes when jumping via on:", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", on: { skip: "c", proceed: "b" } },
          b: { phase: "act" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => ({ status: "success", data: { outcome: "skip" } }),
        b: async () => { order.push("b"); return { status: "success" }; },
        c: async () => { order.push("c"); return { status: "success" }; },
      },
    );

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["c"]);
  });
});

// ---------------------------------------------------------------------------
// Failure semantics
// ---------------------------------------------------------------------------

describe("runRecipe — failure semantics", () => {
  it("marks result as partial when a non-critical node throws", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => { throw new Error("boom"); },
        c: async () => ({ status: "success" }),
      },
    );

    const result = await runRecipe(r, {}, providers, opts);

    expect(result.status).toBe("partial");
  });

  it("aborts immediately when a critical node throws", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", critical: true, next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => { throw new Error("critical fail"); },
        b: async () => { order.push("b"); return { status: "success" }; },
      },
    );

    const result = await runRecipe(r, {}, providers, opts);

    expect(order).toEqual([]);
    expect(result.status).toBe("failed");
  });

  it("stops default sequencing when a non-critical node returns status=failed", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "act", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "failed", reason: "no-op" }),
        b: async () => { order.push("b"); return { status: "success" }; },
      },
    );

    const result = await runRecipe(r, {}, providers, opts);

    expect(order).toEqual([]);
    expect(result.status).toBe("partial");
  });

  it("records failed step in steps array", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: { a: { phase: "act" } },
      },
      {
        a: async () => { throw new Error("fail"); },
      },
    );

    const result = await runRecipe(r, {}, providers, opts);

    const stepA = result.steps.find((s) => s.name === "a");
    expect(stepA?.result.status).toBe("failed");
    expect(stepA?.result.reason).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe("runRecipe — cycle detection", () => {
  it("aborts and logs an error when a transition creates a cycle", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "cyclic",
        version: "1.0.0",
        name: "cyclic",
        initial: "a",
        states: {
          a: { phase: "act", on: { success: "b" } },
          b: { phase: "act", on: { success: "a" } },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
      },
    );

    const result = await runRecipe(r, {}, providers, opts);

    expect(result.status).toBe("failed");
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining("Cycle detected"));
  });
});

// ---------------------------------------------------------------------------
// validateDefinition and createRecipe errors
// ---------------------------------------------------------------------------

describe("validateDefinition", () => {
  it("returns empty array for a valid definition", () => {
    const errors = validateDefinition({
      id: "test",
      version: "1.0.0",
      name: "test",
      initial: "a",
      states: { a: { phase: "learn", next: "b" }, b: { phase: "act" } },
    });
    expect(errors).toHaveLength(0);
  });

  it("returns MISSING_INITIAL when initial does not exist in states", () => {
    const errors = validateDefinition({
      id: "test",
      version: "1.0.0",
      name: "test",
      initial: "nonexistent",
      states: {},
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("MISSING_INITIAL");
  });

  it("returns UNKNOWN_TARGET when next target does not exist", () => {
    const errors = validateDefinition({
      id: "test",
      version: "1.0.0",
      name: "test",
      initial: "a",
      states: { a: { phase: "learn", next: "ghost" } },
    });
    expect(errors.some((e) => e.code === "UNKNOWN_TARGET" && e.targetId === "ghost")).toBe(true);
  });

  it("returns UNKNOWN_TARGET when on: target does not exist", () => {
    const errors = validateDefinition({
      id: "test",
      version: "1.0.0",
      name: "test",
      initial: "a",
      states: { a: { phase: "learn", on: { success: "ghost" } } },
    });
    expect(errors.some((e) => e.code === "UNKNOWN_TARGET" && e.targetId === "ghost")).toBe(true);
  });

  it("allows 'end' as a valid target in on: and next", () => {
    const errors = validateDefinition({
      id: "test",
      version: "1.0.0",
      name: "test",
      initial: "a",
      states: { a: { phase: "learn", on: { success: "end" }, next: "end" } },
    });
    expect(errors).toHaveLength(0);
  });
});

describe("createRecipe", () => {
  it("throws when initial state does not exist", () => {
    expect(() =>
      createRecipe(
        { id: "bad", version: "1.0.0", name: "bad", initial: "nonexistent", states: {} },
        {},
      ),
    ).toThrow(/MISSING_INITIAL/);
  });

  it("throws when a state has no implementation", () => {
    expect(() =>
      createRecipe(
        {
          id: "bad",
          version: "1.0.0",
          name: "bad",
          initial: "a",
          states: { a: { phase: "learn" } },
        },
        {},
      ),
    ).toThrow(/MISSING_IMPLEMENTATION/);
  });

  it("throws with recipe id in the error message", () => {
    expect(() =>
      createRecipe(
        { id: "my-recipe-id", version: "1.0.0", name: "bad", initial: "nope", states: {} },
        {},
      ),
    ).toThrow(/my-recipe-id/);
  });
});

// ---------------------------------------------------------------------------
// beforeStep / afterStep hooks
// ---------------------------------------------------------------------------

describe("runRecipe — hooks", () => {
  it("calls beforeStep before each node executes", async () => {
    const beforeIds: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
      },
    );

    await runRecipe(r, {}, providers, {
      ...opts,
      beforeStep: async (step) => {
        beforeIds.push(step.id);
      },
    });

    expect(beforeIds).toEqual(["a", "b"]);
  });

  it("skips node execution when beforeStep returns false", async () => {
    const ran: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => { ran.push("a"); return { status: "success" }; },
        b: async () => { ran.push("b"); return { status: "success" }; },
      },
    );

    await runRecipe(r, {}, providers, {
      ...opts,
      beforeStep: async (step) => (step.id === "a" ? false : undefined),
    });

    expect(ran).toEqual(["b"]);
  });

  it("calls afterStep after each node completes", async () => {
    const afterIds: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
      },
    );

    await runRecipe(r, {}, providers, {
      ...opts,
      afterStep: async (step) => {
        afterIds.push(step.id);
      },
    });

    expect(afterIds).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// resolveNext — edge cases
// ---------------------------------------------------------------------------

describe("runRecipe — resolveNext edge cases", () => {
  it("continues to next node when skipped (via next:)", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "act", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "skipped", reason: "nothing to do" }),
        b: async () => { order.push("b"); return { status: "success" }; },
      },
    );

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });

  it("stops after the last node with no next node", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "only",
        states: { only: { phase: "act" } },
      },
      { only: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
  });

  it("uses wildcard on['*'] when no specific key matches", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "test",
        version: "1.0.0",
        name: "test",
        initial: "a",
        states: {
          a: { phase: "act", on: { "*": "b" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => { order.push("b"); return { status: "success" }; },
      },
    );

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });
});
