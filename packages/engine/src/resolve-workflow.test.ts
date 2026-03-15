import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { builtinStepRegistry, registerStepType, resolveWorkflow } from "./step-registry.js";
import { createProviderRegistry, runWorkflow } from "./runner-recipe.js";
import type { WorkflowContext, StepResult } from "./types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

describe("resolveWorkflow", () => {
  // Snapshot registry state before each test and restore after to avoid cross-test pollution
  let registrySnapshot: Map<string, unknown>;

  beforeEach(() => {
    registrySnapshot = new Map(builtinStepRegistry);
  });

  afterEach(() => {
    builtinStepRegistry.clear();
    for (const [k, v] of registrySnapshot) {
      builtinStepRegistry.set(k, v as ReturnType<typeof builtinStepRegistry.get>);
    }
  });

  it("resolves a definition with registered step types into a runnable workflow", async () => {
    registerStepType({
      type: "test/step-a",
      description: "Step A",
      impl: async (_ctx: WorkflowContext<unknown>): Promise<StepResult> => ({ status: "success" }),
    });

    const wf = resolveWorkflow({
      id: "r",
      version: "1.0.0",
      name: "resolve-test",
      initial: "a",
      steps: {
        a: { phase: "learn", type: "test/step-a" },
      },
    });

    const registry = createProviderRegistry();
    const result = await runWorkflow(wf, {}, registry, { logger: silentLogger });
    expect(result.status).toBe("completed");
  });

  it("throws clear error when step has no type field", () => {
    expect(() =>
      resolveWorkflow({
        id: "r",
        version: "1.0.0",
        name: "no-type",
        initial: "a",
        steps: {
          a: { phase: "learn" }, // no type
        },
      }),
    ).toThrow(/Step "a" has no type/);
  });

  it("throws clear error for unknown step type", () => {
    expect(() =>
      resolveWorkflow({
        id: "r",
        version: "1.0.0",
        name: "unknown-type",
        initial: "a",
        steps: {
          a: { phase: "learn", type: "sweny/does-not-exist" },
        },
      }),
    ).toThrow(/Unknown step type "sweny\/does-not-exist"/);
  });

  it("lists available types in error message for unknown type", () => {
    registerStepType({
      type: "test/known",
      description: "Known step",
      impl: async (): Promise<StepResult> => ({ status: "success" }),
    });

    let msg = "";
    try {
      resolveWorkflow({
        id: "r",
        version: "1.0.0",
        name: "list-types",
        initial: "a",
        steps: { a: { phase: "learn", type: "test/unknown" } },
      });
    } catch (err) {
      msg = String(err);
    }
    expect(msg).toContain("test/known");
  });

  it("wires up multiple steps from registry", async () => {
    const order: string[] = [];

    registerStepType({
      type: "test/first",
      description: "First",
      impl: async (): Promise<StepResult> => {
        order.push("first");
        return { status: "success" };
      },
    });
    registerStepType({
      type: "test/second",
      description: "Second",
      impl: async (): Promise<StepResult> => {
        order.push("second");
        return { status: "success" };
      },
    });

    const wf = resolveWorkflow({
      id: "r",
      version: "1.0.0",
      name: "multi-step",
      initial: "first",
      steps: {
        first: { phase: "learn", type: "test/first", next: "second" },
        second: { phase: "act", type: "test/second" },
      },
    });

    const registry = createProviderRegistry();
    await runWorkflow(wf, {}, registry, { logger: silentLogger });
    expect(order).toEqual(["first", "second"]);
  });
});
