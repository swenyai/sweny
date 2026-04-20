import { describe, expect, it } from "vitest";
import { evaluateRequires } from "../requires.js";
import type { NodeRequires } from "../types.js";

describe("evaluateRequires", () => {
  it("returns null when requires is undefined", () => {
    expect(evaluateRequires(undefined, { input: {} })).toBeNull();
  });

  it("returns null when all checks pass", () => {
    const requires: NodeRequires = {
      output_required: ["input.repoUrl"],
      output_matches: [{ path: "triage.recommendation", equals: "implement" }],
    };
    const ctx = {
      input: { repoUrl: "https://x" },
      triage: { recommendation: "implement" },
    };
    expect(evaluateRequires(requires, ctx)).toBeNull();
  });

  it("reports missing input field", () => {
    const requires: NodeRequires = { output_required: ["input.repoUrl"] };
    const err = evaluateRequires(requires, { input: {} });
    expect(err).not.toBeNull();
    expect(err).toMatch(/^requires failed:/);
    expect(err).toMatch(/'input\.repoUrl'/);
  });

  it("reports missing prior node output", () => {
    const requires: NodeRequires = { output_required: ["triage.recommendation"] };
    const err = evaluateRequires(requires, { input: {} });
    expect(err).not.toBeNull();
    expect(err).toMatch(/'triage\.recommendation'/);
  });

  it("reports null upstream value as missing", () => {
    const requires: NodeRequires = { output_required: ["triage.recommendation"] };
    const err = evaluateRequires(requires, {
      input: {},
      triage: { recommendation: null },
    });
    expect(err).toMatch(/null/);
  });

  it("supports `any:` wildcard semantics on requires paths", () => {
    const requires: NodeRequires = {
      output_required: ["any:scan.findings[*].severity"],
    };
    const ctx = { input: {}, scan: { findings: [{ severity: "low" }, { severity: "high" }] } };
    expect(evaluateRequires(requires, ctx)).toBeNull();
  });

  it("reports output_matches failure with operator description", () => {
    const requires: NodeRequires = {
      output_matches: [{ path: "triage.recommendation", equals: "implement" }],
    };
    const err = evaluateRequires(requires, {
      input: {},
      triage: { recommendation: "skip" },
    });
    expect(err).toMatch(/equals "implement"/);
    expect(err).toMatch(/got \["skip"\]/);
  });

  it("aggregates multiple failures into one string", () => {
    const requires: NodeRequires = {
      output_required: ["input.a", "input.b"],
      output_matches: [{ path: "input.c", equals: 1 }],
    };
    const err = evaluateRequires(requires, { input: { c: 2 } });
    expect(err).toMatch(/'input\.a'/);
    expect(err).toMatch(/'input\.b'/);
    expect(err).toMatch(/'input\.c'/);
  });

  it("does not crash when context map is empty", () => {
    const requires: NodeRequires = { output_required: ["input.x"] };
    const err = evaluateRequires(requires, {});
    expect(err).not.toBeNull();
  });

  // ── Test 10: malformed block with no checks declared (fix B) ──

  it("returns failure when requires block has no checks declared (fix B defensive guard)", () => {
    // Post-merge fix B: evaluateRequires fails loudly when a requires block
    // exists but declares neither output_required nor output_matches.
    // Passing on_fail directly to bypass TypeScript's NodeRequires type.
    const err = evaluateRequires({ on_fail: "fail" } as any, { input: {} });
    expect(err).not.toBeNull();
    expect(err).toMatch(/^requires failed:/);
    expect(err).toMatch(/no checks declared/);
  });
});
