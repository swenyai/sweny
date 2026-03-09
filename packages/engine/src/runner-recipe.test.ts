import { describe, it, expect, vi } from "vitest";
import { runRecipe, createRecipe, validateDefinition } from "./runner-recipe.js";
import { createProviderRegistry } from "./runner-recipe.js";
import type { StepResult, WorkflowContext } from "./types.js";
import type { ExecutionEvent, RunObserver } from "./types.js";
import { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";

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
        a: async () => {
          order.push("a");
          return { status: "success" };
        },
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
        c: async () => {
          order.push("c");
          return { status: "success" };
        },
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
        "node-a": async () => {
          order.push("a");
          return { status: "success" };
        },
        "node-b": async () => {
          order.push("b");
          return { status: "success" };
        },
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
        "node-a": async () => {
          order.push("a");
          return { status: "success" };
        },
        "node-b": async () => {
          order.push("b");
          return { status: "success" };
        },
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
        next: async () => {
          order.push("next");
          return { status: "success" };
        },
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
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
        c: async () => {
          order.push("c");
          return { status: "success" };
        },
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
        b: async () => {
          throw new Error("boom");
        },
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
        a: async () => {
          throw new Error("critical fail");
        },
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
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
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
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
        a: async () => {
          throw new Error("fail");
        },
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
      createRecipe({ id: "bad", version: "1.0.0", name: "bad", initial: "nonexistent", states: {} }, {}),
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
      createRecipe({ id: "my-recipe-id", version: "1.0.0", name: "bad", initial: "nope", states: {} }, {}),
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
        a: async () => {
          ran.push("a");
          return { status: "success" };
        },
        b: async () => {
          ran.push("b");
          return { status: "success" };
        },
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
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
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
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// validateDefinition — comprehensive
// ---------------------------------------------------------------------------

describe("validateDefinition — happy paths", () => {
  it("returns [] for a valid definition", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: {
        a: { phase: "learn", next: "b" },
        b: { phase: "act", on: { success: "c" } },
        c: { phase: "report" },
      },
    });
    expect(errors).toHaveLength(0);
  });

  it("returns [] when states have no on or next (terminal states only)", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "only",
      states: { only: { phase: "act" } },
    });
    expect(errors).toHaveLength(0);
  });

  it("does NOT error when on target is 'end'", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: { a: { phase: "act", on: { success: "end", failed: "end" } } },
    });
    expect(errors).toHaveLength(0);
  });

  it("does NOT error when next is 'end'", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: { a: { phase: "act", next: "end" } },
    });
    expect(errors).toHaveLength(0);
  });

  it("returns [] for a definition with wildcard '*' transitions", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: {
        a: { phase: "act", on: { "*": "b" } },
        b: { phase: "act" },
      },
    });
    expect(errors).toHaveLength(0);
  });

  it("returns [] for a definition mixing on and next", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: {
        a: { phase: "act", on: { failed: "b" }, next: "c" },
        b: { phase: "act" },
        c: { phase: "act" },
      },
    });
    expect(errors).toHaveLength(0);
  });
});

describe("validateDefinition — MISSING_INITIAL", () => {
  it("errors when initial does not exist in states", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "missing",
      states: { a: { phase: "act" } },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("MISSING_INITIAL");
  });

  it("errors when states is empty and initial is set", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "anything",
      states: {},
    });
    expect(errors.some((e) => e.code === "MISSING_INITIAL")).toBe(true);
  });
});

describe("validateDefinition — UNKNOWN_TARGET from on", () => {
  it("errors when on target does not exist in states", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: { a: { phase: "act", on: { success: "ghost" } } },
    });
    expect(errors.some((e) => e.code === "UNKNOWN_TARGET" && e.targetId === "ghost")).toBe(true);
  });

  it("returns multiple errors for multiple invalid on targets", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: { a: { phase: "act", on: { success: "x", failed: "y" } } },
    });
    const unknowns = errors.filter((e) => e.code === "UNKNOWN_TARGET");
    expect(unknowns.length).toBeGreaterThanOrEqual(2);
    expect(unknowns.some((e) => e.targetId === "x")).toBe(true);
    expect(unknowns.some((e) => e.targetId === "y")).toBe(true);
  });
});

describe("validateDefinition — UNKNOWN_TARGET from next", () => {
  it("errors when next does not exist in states", () => {
    const errors = validateDefinition({
      id: "r",
      version: "1.0.0",
      name: "r",
      initial: "a",
      states: { a: { phase: "act", next: "ghost" } },
    });
    expect(errors.some((e) => e.code === "UNKNOWN_TARGET" && e.targetId === "ghost")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createRecipe — comprehensive
// ---------------------------------------------------------------------------

describe("createRecipe — comprehensive", () => {
  it("returns a Recipe when definition and implementations are valid", () => {
    const recipe = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      { a: async () => ({ status: "success" }) },
    );
    expect(recipe.definition.id).toBe("r");
    expect(typeof recipe.implementations["a"]).toBe("function");
  });

  it("throws with MISSING_INITIAL message when initial is invalid", () => {
    expect(() => createRecipe({ id: "r", version: "1.0.0", name: "r", initial: "nope", states: {} }, {})).toThrow(
      /MISSING_INITIAL/,
    );
  });

  it("throws with UNKNOWN_TARGET message when on target is invalid", () => {
    expect(() =>
      createRecipe(
        {
          id: "r",
          version: "1.0.0",
          name: "r",
          initial: "a",
          states: { a: { phase: "act", on: { success: "ghost" } } },
        },
        { a: async () => ({ status: "success" }) },
      ),
    ).toThrow(/UNKNOWN_TARGET/);
  });

  it("throws when an implementation is missing for a state", () => {
    expect(() =>
      createRecipe(
        {
          id: "r",
          version: "1.0.0",
          name: "r",
          initial: "a",
          states: { a: { phase: "act" }, b: { phase: "act" } },
        },
        { a: async () => ({ status: "success" }) },
      ),
    ).toThrow(/MISSING_IMPLEMENTATION/);
  });

  it("throws listing ALL missing implementations at once", () => {
    let thrown: string | undefined;
    try {
      createRecipe(
        {
          id: "r",
          version: "1.0.0",
          name: "r",
          initial: "a",
          states: { a: { phase: "act" }, b: { phase: "act" }, c: { phase: "act" } },
        },
        {},
      );
    } catch (e) {
      thrown = (e as Error).message;
    }
    expect(thrown).toMatch(/a/);
    expect(thrown).toMatch(/b/);
    expect(thrown).toMatch(/c/);
  });

  it("throws listing ALL definition errors at once", () => {
    let thrown: string | undefined;
    try {
      createRecipe(
        {
          id: "r",
          version: "1.0.0",
          name: "r",
          initial: "missing",
          states: { a: { phase: "act", on: { success: "ghost" } } },
        },
        { a: async () => ({ status: "success" }) },
      );
    } catch (e) {
      thrown = (e as Error).message;
    }
    // Both MISSING_INITIAL and UNKNOWN_TARGET must appear
    expect(thrown).toMatch(/MISSING_INITIAL/);
    expect(thrown).toMatch(/UNKNOWN_TARGET/);
  });

  it("error message includes the recipe id", () => {
    expect(() =>
      createRecipe({ id: "my-unique-recipe-id", version: "1.0.0", name: "r", initial: "nope", states: {} }, {}),
    ).toThrow(/my-unique-recipe-id/);
  });
});

// ---------------------------------------------------------------------------
// runRecipe — routing (comprehensive)
// ---------------------------------------------------------------------------

describe("runRecipe routing — linear chain", () => {
  it("follows next chain: a → b → c", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => {
          order.push("a");
          return { status: "success" };
        },
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
        c: async () => {
          order.push("c");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("stops at a terminal state with no next or on", async () => {
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "only", states: { only: { phase: "act" } } },
      { only: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps).toHaveLength(1);
    expect(result.status).toBe("completed");
  });
});

describe("runRecipe routing — on: status keys", () => {
  it("routes via on['success']", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { success: "b" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("routes via on['failed'] (non-critical)", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { failed: "b" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "failed", reason: "intentional" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("routes via on['skipped']", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { skipped: "b" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "skipped", reason: "nothing to do" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });
});

describe("runRecipe routing — on: outcome keys", () => {
  it("routes via on[data.outcome] when outcome is set", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { "outcome-x": "b", success: "c" } },
          b: { phase: "act" },
          c: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success", data: { outcome: "outcome-x" } }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
        c: async () => {
          order.push("c");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("data.outcome takes priority over status when both match", async () => {
    // "success" is both the status AND an outcome key — outcome wins
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { success: "b" } },
          b: { phase: "act" },
        },
      },
      {
        // outcome is "success", status is "success" — should match outcome first (same target "b")
        a: async () => ({ status: "success", data: { outcome: "success" } }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("falls through to status when outcome key is missing from on", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { success: "b" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success", data: { outcome: "no-such-outcome" } }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });
});

describe("runRecipe routing — wildcard", () => {
  it("routes via on['*'] when no specific key matches", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { "*": "b" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "skipped" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("on['*'] is lower priority than explicit outcome and status keys", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { success: "b", "*": "c" } },
          b: { phase: "act" },
          c: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
        c: async () => {
          order.push("c");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    // status "success" matches before wildcard
    expect(order).toEqual(["b"]);
  });
});

describe("runRecipe routing — next as fallback", () => {
  it("uses next when on has no matching key (success)", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { failed: "end" }, next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("uses next when on has no matching key (skipped)", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { failed: "end" }, next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "skipped" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("does NOT use next on failed (failed stops unless on['failed'] is set)", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "failed", reason: "oops" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual([]);
  });
});

describe("runRecipe routing — end keyword", () => {
  it("stops successfully when on target is 'end'", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { success: "end" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(order).toEqual([]);
    expect(result.status).toBe("completed");
  });

  it("stops successfully when next is 'end'", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", next: "end" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(order).toEqual([]);
    expect(result.status).toBe("completed");
  });
});

describe("runRecipe routing — stop conditions", () => {
  it("stops when a non-critical node fails with no on['failed']", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "failed", reason: "oops" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual([]);
  });

  it("stops when there is no next and no on match", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: { a: { phase: "act" } },
      },
      { a: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// runRecipe — critical nodes & abort
// ---------------------------------------------------------------------------

describe("runRecipe critical nodes", () => {
  it("aborts recipe and returns status:'failed' when critical node fails", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", critical: true, next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "failed", reason: "critical fail" }),
        b: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("failed");
  });

  it("does not execute any states after a critical failure", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", critical: true, next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => {
          throw new Error("critical boom");
        },
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
        c: async () => {
          order.push("c");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual([]);
  });

  it("non-critical failure sets status:'partial' not 'failed'", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: { a: { phase: "act" } },
      },
      { a: async () => ({ status: "failed", reason: "non-critical" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("partial");
  });

  it("multiple non-critical failures still produce status:'partial'", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { failed: "b" } },
          b: { phase: "act", on: { failed: "c" } },
          c: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "failed", reason: "fail 1" }),
        b: async () => ({ status: "failed", reason: "fail 2" }),
        c: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("partial");
  });

  it("all success produces status:'completed'", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
        c: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// runRecipe — cycle detection (comprehensive)
// ---------------------------------------------------------------------------

describe("runRecipe cycle detection", () => {
  it("detects and aborts on a direct self-loop (a → a)", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: { a: { phase: "act", on: { success: "a" } } },
      },
      { a: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("failed");
  });

  it("detects and aborts on an indirect cycle (a → b → a)", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
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
  });

  it("logs an error message including the cycle node id", async () => {
    const localLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "loop",
        states: { loop: { phase: "act", on: { success: "loop" } } },
      },
      { loop: async () => ({ status: "success" }) },
    );
    await runRecipe(r, {}, providers, { logger: localLogger });
    expect(localLogger.error).toHaveBeenCalledWith(expect.stringContaining("loop"));
  });

  it("returns status:'failed' on cycle detection", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", next: "b" },
          b: { phase: "act", next: "a" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// runRecipe — unknown node guard
// ---------------------------------------------------------------------------

describe("runRecipe unknown node", () => {
  it("aborts and returns status:'failed' when routing leads to unknown state id", async () => {
    // Bypass createRecipe by constructing a malformed Recipe directly
    const malformed = {
      definition: {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: { a: { phase: "act" as const, on: { success: "nonexistent" } } },
      },
      implementations: { a: async () => ({ status: "success" as const }) },
    };
    const result = await runRecipe(malformed, {}, providers, opts);
    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// runRecipe — hooks (comprehensive)
// ---------------------------------------------------------------------------

describe("runRecipe hooks — comprehensive", () => {
  it("calls beforeStep before each state", async () => {
    const beforeIds: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
        c: async () => ({ status: "success" }),
      },
    );
    await runRecipe(r, {}, providers, {
      ...opts,
      beforeStep: async (step) => {
        beforeIds.push(step.id);
      },
    });
    expect(beforeIds).toEqual(["a", "b", "c"]);
  });

  it("skips a state when beforeStep returns false", async () => {
    const ran: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => {
          ran.push("a");
          return { status: "success" };
        },
        b: async () => {
          ran.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, {
      ...opts,
      beforeStep: async (step) => (step.id === "a" ? false : undefined),
    });
    // a was skipped, b ran
    expect(ran).not.toContain("a");
    expect(ran).toContain("b");
  });

  it("skipped state still routes normally via on/next", async () => {
    const ran: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          ran.push("b");
          return { status: "success" };
        },
      },
    );
    // Skip a — routing should still continue to b
    await runRecipe(r, {}, providers, {
      ...opts,
      beforeStep: async (step) => (step.id === "a" ? false : undefined),
    });
    expect(ran).toContain("b");
  });

  it("calls afterStep after each state (including skipped)", async () => {
    const afterIds: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
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
      beforeStep: async (step) => (step.id === "a" ? false : undefined),
      afterStep: async (step) => {
        afterIds.push(step.id);
      },
    });
    // afterStep called for both (a was skipped by beforeStep but still gets afterStep)
    expect(afterIds).toContain("a");
    expect(afterIds).toContain("b");
  });

  it("afterStep receives the correct StepResult", async () => {
    const afterResults: Array<{ id: string; result: { status: string } }> = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: { a: { phase: "act" } },
      },
      { a: async () => ({ status: "success", data: { foo: "bar" } }) },
    );
    await runRecipe(r, {}, providers, {
      ...opts,
      afterStep: async (step, result) => {
        afterResults.push({ id: step.id, result });
      },
    });
    expect(afterResults[0].id).toBe("a");
    expect(afterResults[0].result.status).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// runRecipe — cache
// ---------------------------------------------------------------------------

describe("runRecipe cache", () => {
  it("replays a cached result instead of calling the implementation", async () => {
    const impl = vi.fn().mockResolvedValue({ status: "success" });
    const cache = {
      get: vi.fn().mockResolvedValue({ result: { status: "success", data: { x: 42 } }, createdAt: Date.now() }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      { a: impl },
    );
    await runRecipe(r, {}, providers, { ...opts, cache });
    expect(impl).not.toHaveBeenCalled();
  });

  it("cached result has cached:true on the StepResult", async () => {
    const cache = {
      get: vi.fn().mockResolvedValue({ result: { status: "success" }, createdAt: Date.now() }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      { a: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, { ...opts, cache });
    expect(result.steps[0].result.cached).toBe(true);
  });

  it("stores successful results to cache", async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      { a: async () => ({ status: "success" }) },
    );
    await runRecipe(r, {}, providers, { ...opts, cache });
    expect(cache.set).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ result: expect.objectContaining({ status: "success" }) }),
    );
  });

  it("does not cache failed results", async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      { a: async () => ({ status: "failed", reason: "oops" }) },
    );
    await runRecipe(r, {}, providers, { ...opts, cache });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("does not cache skipped results", async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      { a: async () => ({ status: "skipped" }) },
    );
    await runRecipe(r, {}, providers, { ...opts, cache });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("cache failure is non-fatal (cache.set rejection does not abort recipe)", async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockRejectedValue(new Error("cache exploded")),
    };
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: { a: { phase: "act", next: "b" }, b: { phase: "act" } },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, { ...opts, cache });
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// runRecipe — result recording
// ---------------------------------------------------------------------------

describe("runRecipe result recording", () => {
  it("records every executed state in WorkflowResult.steps in execution order", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
        c: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("records name (stateId) and phase on each step", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: { a: { phase: "learn" } },
      },
      { a: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps[0].name).toBe("a");
    expect(result.steps[0].phase).toBe("learn");
  });

  it("makes results available in ctx.results for downstream states", async () => {
    let downstream: StepResult | undefined;
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "first",
        states: {
          first: { phase: "learn", next: "second" },
          second: { phase: "act" },
        },
      },
      {
        first: async () => ({ status: "success", data: { magic: 99 } }),
        second: async (ctx) => {
          downstream = ctx.results.get("first");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(downstream?.data?.magic).toBe(99);
  });

  it("includes duration in WorkflowResult", async () => {
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      { a: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(typeof result.duration).toBe("number");
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// runRecipe — exception handling
// ---------------------------------------------------------------------------

describe("runRecipe exception handling", () => {
  it("catches thrown Error and records status:'failed' with the error message as reason", async () => {
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      {
        a: async () => {
          throw new Error("something broke");
        },
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps[0].result.status).toBe("failed");
    expect(result.steps[0].result.reason).toBe("something broke");
  });

  it("catches thrown non-Error (string) and records it as reason", async () => {
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "a", states: { a: { phase: "act" } } },
      {
        a: async () => {
          throw "raw string error";
        },
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps[0].result.status).toBe("failed");
    expect(result.steps[0].result.reason).toBe("raw string error");
  });

  it("a throwing state follows on['failed'] routing if set", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { failed: "b" } },
          b: { phase: "act" },
        },
      },
      {
        a: async () => {
          throw new Error("intentional");
        },
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });

  it("a throwing critical state aborts the recipe", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", critical: true, next: "b" },
          b: { phase: "act" },
        },
      },
      {
        a: async () => {
          throw new Error("critical throw");
        },
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(order).toEqual([]);
    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("works with a single-state recipe (no next, no on) — terminal immediately", async () => {
    const r = createRecipe<Cfg>(
      { id: "r", version: "1.0.0", name: "r", initial: "solo", states: { solo: { phase: "act" } } },
      { solo: async () => ({ status: "success" }) },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps).toHaveLength(1);
    expect(result.status).toBe("completed");
  });

  it("works with 20+ states without performance issues", async () => {
    const states: Record<string, { phase: "act"; next?: string }> = {};
    const impls: Record<string, () => Promise<StepResult>> = {};
    for (let i = 0; i < 22; i++) {
      const id = `s${i}`;
      const nextId = i < 21 ? `s${i + 1}` : undefined;
      states[id] = nextId ? { phase: "act", next: nextId } : { phase: "act" };
      impls[id] = async () => ({ status: "success" });
    }
    const r = createRecipe<Cfg>({ id: "r", version: "1.0.0", name: "r", initial: "s0", states }, impls);
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps).toHaveLength(22);
    expect(result.status).toBe("completed");
  });

  it("state with both on and next — on takes priority for matching outcomes", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", on: { success: "b" }, next: "c" },
          b: { phase: "act" },
          c: { phase: "act" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
        c: async () => {
          order.push("c");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    // on["success"] → b should win over next → c
    expect(order).toEqual(["b"]);
  });

  it("phase is recorded correctly in steps (learn/act/report)", async () => {
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "c" },
          c: { phase: "report" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => ({ status: "success" }),
        c: async () => ({ status: "success" }),
      },
    );
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.steps[0].phase).toBe("learn");
    expect(result.steps[1].phase).toBe("act");
    expect(result.steps[2].phase).toBe("report");
  });

  it("description field on StateDefinition does not affect routing", async () => {
    const order: string[] = [];
    const r = createRecipe<Cfg>(
      {
        id: "r",
        version: "1.0.0",
        name: "r",
        initial: "a",
        states: {
          a: { phase: "act", description: "this is a description", next: "b" },
          b: { phase: "act", description: "another description" },
        },
      },
      {
        a: async () => ({ status: "success" }),
        b: async () => {
          order.push("b");
          return { status: "success" };
        },
      },
    );
    await runRecipe(r, {}, providers, opts);
    expect(order).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// RunObserver
// ---------------------------------------------------------------------------

describe("RunObserver", () => {
  it("receives recipe:start and recipe:end events", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } }, { a: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    expect(obs.events[0]?.type).toBe("recipe:start");
    expect(obs.events.at(-1)?.type).toBe("recipe:end");
  });

  it("receives state:enter and state:exit for each executed state", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn", next: "b" }, b: { phase: "act" } } },
      { a: async () => ({ status: "success" }), b: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    const types = obs.events.map((e) => e.type);
    expect(types).toEqual(["recipe:start", "state:enter", "state:exit", "state:enter", "state:exit", "recipe:end"]);
  });

  it("state:exit includes the StepResult", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success", data: { outcome: "done" } }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    const exit = obs.stateResults[0];
    expect(exit?.result.status).toBe("success");
    expect(exit?.result.data?.outcome).toBe("done");
  });

  it("observer errors do not abort the recipe", async () => {
    const obs: RunObserver = { onEvent: () => { throw new Error("observer boom"); } };
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success" }) });
    const result = await runRecipe(r, {}, providers, { ...opts, observer: obs });
    expect(result.status).toBe("completed"); // recipe continues despite observer error
  });

  it("recipe:end status matches the WorkflowResult status", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn", critical: true } } },
      { a: async () => ({ status: "failed", reason: "bad" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    const end = obs.events.find((e) => e.type === "recipe:end") as Extract<ExecutionEvent, { type: "recipe:end" }>;
    expect(end.status).toBe("failed");
  });

  it("CollectingObserver.stateResults filters to state:exit events only", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });
    expect(obs.stateResults).toHaveLength(1);
    expect(obs.stateResults[0]?.type).toBe("state:exit");
  });

  it("composeObservers delivers events to all observers", async () => {
    const obs1 = new CollectingObserver();
    const obs2 = new CollectingObserver();
    const composed = composeObservers(obs1, obs2);
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: composed });
    expect(obs1.events).toHaveLength(obs2.events.length);
  });
});
