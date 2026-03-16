import { describe, it, expect } from "vitest";
import { validateWorkflow } from "./validate.js";
import type { WorkflowDefinition } from "./types.js";

function def(overrides: Partial<WorkflowDefinition> & { steps: WorkflowDefinition["steps"] }): WorkflowDefinition {
  return { id: "t", version: "1.0.0", name: "test", initial: "a", ...overrides };
}

describe("validateWorkflow — structural checks", () => {
  it("returns no errors for a valid single-step workflow", () => {
    const errors = validateWorkflow(def({ steps: { a: { phase: "learn" } } }));
    expect(errors).toHaveLength(0);
  });

  it("MISSING_INITIAL when initial step does not exist", () => {
    const errors = validateWorkflow(def({ initial: "missing", steps: { a: { phase: "learn" } } }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("MISSING_INITIAL");
    expect(errors[0].message).toContain('"missing"');
  });

  it("UNKNOWN_TARGET for invalid next", () => {
    const errors = validateWorkflow(def({ steps: { a: { phase: "learn", next: "ghost" } } }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("UNKNOWN_TARGET");
    expect(errors[0].stateId).toBe("a");
    expect(errors[0].targetId).toBe("ghost");
  });

  it("UNKNOWN_TARGET for invalid on target", () => {
    const errors = validateWorkflow(def({ steps: { a: { phase: "learn", on: { success: "nope" } } } }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("UNKNOWN_TARGET");
    expect(errors[0].stateId).toBe("a");
    expect(errors[0].targetId).toBe("nope");
  });

  it("accepts 'end' as a valid next target", () => {
    const errors = validateWorkflow(def({ steps: { a: { phase: "learn", next: "end" } } }));
    expect(errors).toHaveLength(0);
  });

  it("accepts 'end' as a valid on target", () => {
    const errors = validateWorkflow(def({ steps: { a: { phase: "learn", on: { done: "end" } } } }));
    expect(errors).toHaveLength(0);
  });
});

describe("validateWorkflow — reachability", () => {
  it("no error when all steps are reachable via next", () => {
    const errors = validateWorkflow(
      def({
        steps: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "end" },
        },
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it("no error when all steps reachable via on: map only", () => {
    const errors = validateWorkflow(
      def({
        steps: {
          a: { phase: "learn", on: { pass: "b", fail: "end" } },
          b: { phase: "act" },
        },
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it("UNREACHABLE_STEP for a step with no path from initial", () => {
    const errors = validateWorkflow(
      def({
        steps: {
          a: { phase: "learn", next: "end" },
          orphan: { phase: "act" },
        },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("UNREACHABLE_STEP");
    expect(errors[0].stateId).toBe("orphan");
    expect(errors[0].message).toContain('"orphan"');
    expect(errors[0].message).toContain('"a"');
  });

  it("reports all unreachable steps when multiple exist", () => {
    const errors = validateWorkflow(
      def({
        steps: {
          a: { phase: "learn" },
          x: { phase: "act" },
          y: { phase: "act" },
        },
      }),
    );
    const codes = errors.map((e) => e.code);
    expect(codes.every((c) => c === "UNREACHABLE_STEP")).toBe(true);
    expect(errors).toHaveLength(2);
    const ids = errors.map((e) => e.stateId).sort();
    expect(ids).toEqual(["x", "y"]);
  });

  it("does NOT report UNREACHABLE_STEP when UNKNOWN_TARGET errors exist", () => {
    // bad target "ghost" would make "b" appear unreachable — but we suppress reachability
    const errors = validateWorkflow(
      def({
        steps: {
          a: { phase: "learn", next: "ghost" },
          b: { phase: "act" },
        },
      }),
    );
    const codes = errors.map((e) => e.code);
    expect(codes).not.toContain("UNREACHABLE_STEP");
    expect(codes).toContain("UNKNOWN_TARGET");
  });

  it("handles diamond-shaped reachable graph correctly", () => {
    const errors = validateWorkflow(
      def({
        initial: "start",
        steps: {
          start: { phase: "learn", on: { a: "left", b: "right" } },
          left: { phase: "act", next: "merge" },
          right: { phase: "act", next: "merge" },
          merge: { phase: "report" },
        },
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it("handles cycles without infinite looping", () => {
    // a → b → a is a cycle; neither is unreachable from initial
    const errors = validateWorkflow(
      def({
        steps: {
          a: { phase: "learn", next: "b" },
          b: { phase: "act", next: "a" },
        },
      }),
    );
    expect(errors).toHaveLength(0);
  });
});
