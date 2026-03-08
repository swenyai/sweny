import { describe, it, expect, vi } from "vitest";
import { runRecipe } from "./runner-recipe.js";
import { createProviderRegistry } from "./runner.js";
import type { Recipe, RecipeStep, StepResult, WorkflowContext } from "./types.js";

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

function node(
  id: string,
  phase: RecipeStep["phase"],
  fn?: (ctx: WorkflowContext) => Promise<StepResult>,
  opts?: Partial<Pick<RecipeStep, "on" | "critical">>,
): RecipeStep<Cfg> {
  return {
    id,
    phase,
    run: fn ?? (() => Promise.resolve({ status: "success" })),
    ...opts,
  };
}

function recipe(name: string, nodes: RecipeStep<Cfg>[], start?: string): Recipe<Cfg> {
  return { name, start: start ?? nodes[0]?.id ?? "start", nodes };
}

const providers = createProviderRegistry();
const opts = { logger: silentLogger };

// ---------------------------------------------------------------------------
// Basic execution
// ---------------------------------------------------------------------------

describe("runRecipe — basic execution", () => {
  it("executes all nodes in declaration order when no on: transitions", async () => {
    const order: string[] = [];
    const r = recipe("test", [
      node("a", "learn", async () => {
        order.push("a");
        return { status: "success" };
      }),
      node("b", "act", async () => {
        order.push("b");
        return { status: "success" };
      }),
      node("c", "report", async () => {
        order.push("c");
        return { status: "success" };
      }),
    ]);

    const result = await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["a", "b", "c"]);
    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
  });

  it("returns completed status when all steps succeed", async () => {
    const r = recipe("test", [node("a", "learn"), node("b", "act")]);
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("completed");
  });

  it("includes duration in result", async () => {
    const r = recipe("test", [node("a", "learn")]);
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("accumulates step results in WorkflowContext.results", async () => {
    let seenResults: Map<string, StepResult> | undefined;
    const r = recipe("test", [
      node("first", "learn", async () => ({ status: "success", data: { x: 1 } })),
      node("second", "act", async (ctx) => {
        seenResults = new Map(ctx.results);
        return { status: "success" };
      }),
    ]);

    await runRecipe(r, {}, providers, opts);

    expect(seenResults?.get("first")?.data).toEqual({ x: 1 });
  });

  it("passes config to each step via ctx.config", async () => {
    const config = { myKey: "myValue" };
    let receivedConfig: unknown;
    const r = recipe("test", [
      node("a", "learn", async (ctx) => {
        receivedConfig = ctx.config;
        return { status: "success" };
      }),
    ]);

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
    const r = recipe("test", [
      node("gate", "act", async () => ({ status: "success", data: { outcome: "branch-b" } }), {
        on: { "branch-a": "node-a", "branch-b": "node-b" },
      }),
      node("node-a", "act", async () => {
        order.push("a");
        return { status: "success" };
      }),
      node("node-b", "act", async () => {
        order.push("b");
        return { status: "success" };
      }),
    ]);

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });

  it("falls back to status when data.outcome has no matching on: key", async () => {
    const order: string[] = [];
    const r = recipe("test", [
      node("gate", "act", async () => ({ status: "success", data: { outcome: "unknown-outcome" } }), {
        on: { success: "node-b" },
      }),
      node("node-a", "act", async () => {
        order.push("a");
        return { status: "success" };
      }),
      node("node-b", "act", async () => {
        order.push("b");
        return { status: "success" };
      }),
    ]);

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });

  it("stops when on: transition resolves to 'end'", async () => {
    const order: string[] = [];
    const r = recipe("test", [
      node("gate", "act", async () => ({ status: "success", data: { outcome: "skip" } }), {
        on: { skip: "end", implement: "next" },
      }),
      node("next", "act", async () => {
        order.push("next");
        return { status: "success" };
      }),
    ]);

    const result = await runRecipe(r, {}, providers, opts);

    expect(order).toEqual([]);
    expect(result.status).toBe("completed");
  });

  it("skips intervening nodes when jumping via on:", async () => {
    const order: string[] = [];
    const r = recipe("test", [
      node("a", "learn", async () => ({ status: "success", data: { outcome: "skip" } }), {
        on: { skip: "c", proceed: "b" },
      }),
      node("b", "act", async () => {
        order.push("b");
        return { status: "success" };
      }),
      node("c", "report", async () => {
        order.push("c");
        return { status: "success" };
      }),
    ]);

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["c"]);
  });
});

// ---------------------------------------------------------------------------
// Failure semantics
// ---------------------------------------------------------------------------

describe("runRecipe — failure semantics", () => {
  it("marks result as partial when a non-critical node throws", async () => {
    const r = recipe("test", [
      node("a", "learn"),
      node("b", "act", async () => {
        throw new Error("boom");
      }),
      node("c", "report"),
    ]);

    const result = await runRecipe(r, {}, providers, opts);

    expect(result.status).toBe("partial");
  });

  it("aborts immediately when a critical node throws", async () => {
    const order: string[] = [];
    const r = recipe("test", [
      node(
        "a",
        "learn",
        async () => {
          throw new Error("critical fail");
        },
        { critical: true },
      ),
      node("b", "act", async () => {
        order.push("b");
        return { status: "success" };
      }),
    ]);

    const result = await runRecipe(r, {}, providers, opts);

    expect(order).toEqual([]);
    expect(result.status).toBe("failed");
  });

  it("stops default sequencing when a non-critical node returns status=failed", async () => {
    const order: string[] = [];
    const r = recipe("test", [
      node("a", "act", async () => ({ status: "failed", reason: "no-op" })),
      node("b", "act", async () => {
        order.push("b");
        return { status: "success" };
      }),
    ]);

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual([]);
  });

  it("records failed step in steps array", async () => {
    const r = recipe("test", [
      node("a", "act", async () => {
        throw new Error("fail");
      }),
    ]);

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
    const r: Recipe<Cfg> = {
      name: "cyclic",
      start: "a",
      nodes: [
        { id: "a", phase: "act", run: async () => ({ status: "success" }), on: { success: "b" } },
        { id: "b", phase: "act", run: async () => ({ status: "success" }), on: { success: "a" } },
      ],
    };

    const result = await runRecipe(r, {}, providers, opts);

    expect(result.status).toBe("failed");
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining("Cycle detected"));
  });
});

// ---------------------------------------------------------------------------
// Unknown node id
// ---------------------------------------------------------------------------

describe("runRecipe — unknown node id", () => {
  it("aborts when start node does not exist", async () => {
    const r: Recipe<Cfg> = { name: "bad", start: "nonexistent", nodes: [] };

    const result = await runRecipe(r, {}, providers, opts);

    expect(result.status).toBe("failed");
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('"nonexistent"'));
  });

  it("aborts when on: transition points to a nonexistent node id", async () => {
    const r = recipe("test", [node("a", "act", async () => ({ status: "success" }), { on: { success: "ghost" } })]);

    const result = await runRecipe(r, {}, providers, opts);

    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// beforeStep / afterStep hooks
// ---------------------------------------------------------------------------

describe("runRecipe — hooks", () => {
  it("calls beforeStep before each node executes", async () => {
    const beforeIds: string[] = [];
    const r = recipe("test", [node("a", "learn"), node("b", "act")]);

    await runRecipe(r, {}, providers, {
      ...opts,
      beforeStep: async (step) => {
        beforeIds.push(step.name);
      },
    });

    expect(beforeIds).toEqual(["a", "b"]);
  });

  it("skips node execution when beforeStep returns false", async () => {
    const ran: string[] = [];
    const r = recipe("test", [
      node("a", "learn", async () => {
        ran.push("a");
        return { status: "success" };
      }),
      node("b", "act", async () => {
        ran.push("b");
        return { status: "success" };
      }),
    ]);

    await runRecipe(r, {}, providers, {
      ...opts,
      beforeStep: async (step) => (step.name === "a" ? false : undefined),
    });

    expect(ran).toEqual(["b"]);
  });

  it("calls afterStep after each node completes", async () => {
    const afterIds: string[] = [];
    const r = recipe("test", [node("a", "learn"), node("b", "act")]);

    await runRecipe(r, {}, providers, {
      ...opts,
      afterStep: async (step) => {
        afterIds.push(step.name);
      },
    });

    expect(afterIds).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// resolveNext — edge cases
// ---------------------------------------------------------------------------

describe("runRecipe — resolveNext edge cases", () => {
  it("continues to next node in order when skipped (no on)", async () => {
    const order: string[] = [];
    const r = recipe("test", [
      node("a", "act", async () => ({ status: "skipped", reason: "nothing to do" })),
      node("b", "act", async () => {
        order.push("b");
        return { status: "success" };
      }),
    ]);

    await runRecipe(r, {}, providers, opts);

    expect(order).toEqual(["b"]);
  });

  it("stops after the last node with no next node", async () => {
    const r = recipe("test", [node("only", "act")]);
    const result = await runRecipe(r, {}, providers, opts);
    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
  });
});
