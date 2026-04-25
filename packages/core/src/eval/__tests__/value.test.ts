import { describe, expect, it } from "vitest";
import { checkOutputMatches, checkOutputRequired, evaluateValueRule } from "../value.js";

describe("checkOutputRequired", () => {
  it("passes when all paths resolve to non-null values", () => {
    expect(checkOutputRequired(["a", "b.c"], { a: 1, b: { c: "x" } })).toBeNull();
  });

  it("fails when a path is missing", () => {
    const err = checkOutputRequired(["a", "missing"], { a: 1 });
    expect(err).toMatch(/output_required.*'missing'.*missing segment/);
  });

  it("fails when a path resolves to null", () => {
    const err = checkOutputRequired(["a"], { a: null });
    expect(err).toMatch(/output_required.*'a'.*null/);
  });

  it("with default (all) wildcard, requires every element to have non-null path", () => {
    const data = { findings: [{ severity: "critical" }, { severity: null }] };
    const err = checkOutputRequired(["findings[*].severity"], data);
    expect(err).toMatch(/output_required/);
  });

  it("with default (all) wildcard, passes when every element has non-null path", () => {
    const data = { findings: [{ severity: "critical" }, { severity: "low" }] };
    expect(checkOutputRequired(["findings[*].severity"], data)).toBeNull();
  });

  it("with default (all) wildcard over empty array, vacuously passes", () => {
    expect(checkOutputRequired(["findings[*].severity"], { findings: [] })).toBeNull();
  });

  it("with `any` wildcard, passes when at least one element has non-null path", () => {
    const data = { findings: [{ severity: null }, { severity: "low" }] };
    expect(checkOutputRequired(["any:findings[*].severity"], data)).toBeNull();
  });

  it("with `any` wildcard over empty array, fails", () => {
    const err = checkOutputRequired(["any:findings[*].severity"], { findings: [] });
    expect(err).toMatch(/output_required.*no elements/);
  });

  it("aggregates multiple required-path failures into one message", () => {
    const err = checkOutputRequired(["a", "b"], {});
    expect(err).toMatch(/'a'/);
    expect(err).toMatch(/'b'/);
  });
});

describe("checkOutputMatches", () => {
  it("passes equals on a single value", () => {
    expect(checkOutputMatches([{ path: "a", equals: 1 }], { a: 1 })).toBeNull();
  });

  it("fails equals on a mismatched value", () => {
    const err = checkOutputMatches([{ path: "a", equals: 1 }], { a: 2 });
    expect(err).toMatch(/output_matches.*'a'.*equals.*1.*got.*2/);
  });

  it("passes `in` when the value is in the set", () => {
    expect(checkOutputMatches([{ path: "sev", in: ["high", "low"] }], { sev: "low" })).toBeNull();
  });

  it("fails `in` when the value is not in the set", () => {
    const err = checkOutputMatches([{ path: "sev", in: ["high", "low"] }], { sev: "urgent" });
    expect(err).toMatch(/output_matches.*'sev'.*in \["high", "low"\].*got \["urgent"\]/);
  });

  it("passes `matches` when the regex matches the coerced string", () => {
    expect(checkOutputMatches([{ path: "url", matches: "^https://" }], { url: "https://x" })).toBeNull();
  });

  it("fails `matches` when the regex does not match", () => {
    const err = checkOutputMatches([{ path: "url", matches: "^https://" }], { url: "ftp://x" });
    expect(err).toMatch(/output_matches.*'url'.*matches.*ftp/);
  });

  it("with default (all) wildcard, requires every element to satisfy operator", () => {
    const data = { sevs: [{ s: "high" }, { s: "urgent" }] };
    const err = checkOutputMatches([{ path: "sevs[*].s", in: ["high", "low"] }], data);
    expect(err).toMatch(/output_matches/);
  });

  it("with default (all) wildcard, passes when every element satisfies operator", () => {
    const data = { sevs: [{ s: "high" }, { s: "low" }] };
    expect(checkOutputMatches([{ path: "sevs[*].s", in: ["high", "low"] }], data)).toBeNull();
  });

  it("with default (all) wildcard over empty array, vacuously passes", () => {
    expect(checkOutputMatches([{ path: "sevs[*].s", in: ["high"] }], { sevs: [] })).toBeNull();
  });

  it("with `any` wildcard, passes when at least one element satisfies operator", () => {
    const data = { sevs: [{ s: "low" }, { s: "critical" }] };
    expect(checkOutputMatches([{ path: "any:sevs[*].s", equals: "critical" }], data)).toBeNull();
  });

  it("with `any` wildcard, fails when no element satisfies operator", () => {
    const data = { sevs: [{ s: "low" }, { s: "high" }] };
    const err = checkOutputMatches([{ path: "any:sevs[*].s", equals: "critical" }], data);
    expect(err).toMatch(/output_matches.*no element satisfies/);
  });

  it("with `any` wildcard over empty array, fails", () => {
    const err = checkOutputMatches([{ path: "any:sevs[*].s", equals: "x" }], { sevs: [] });
    expect(err).toMatch(/output_matches/);
  });

  it("fails when the path itself does not resolve", () => {
    const err = checkOutputMatches([{ path: "missing", equals: 1 }], {});
    expect(err).toMatch(/output_matches.*'missing'.*missing segment/);
  });

  it("aggregates multiple match failures into one message", () => {
    const err = checkOutputMatches(
      [
        { path: "a", equals: 1 },
        { path: "b", equals: 2 },
      ],
      { a: 999, b: 999 },
    );
    expect(err).toMatch(/'a'/);
    expect(err).toMatch(/'b'/);
  });
});

describe("deepEqual semantics (via output_matches equals)", () => {
  it("treats objects with different key insertion order as equal", () => {
    expect(checkOutputMatches([{ path: "x", equals: { a: 1, b: 2 } }], { x: { b: 2, a: 1 } })).toBeNull();
  });

  it("differentiates objects with different keys", () => {
    expect(checkOutputMatches([{ path: "x", equals: { a: 1, b: 2 } }], { x: { a: 1, c: 2 } })).not.toBeNull();
  });

  it("handles arrays element-wise (order-sensitive)", () => {
    expect(checkOutputMatches([{ path: "x", equals: [1, 2, 3] }], { x: [1, 2, 3] })).toBeNull();
    expect(checkOutputMatches([{ path: "x", equals: [1, 2, 3] }], { x: [3, 2, 1] })).not.toBeNull();
  });

  it("handles nested object/array equality", () => {
    const eq = { items: [{ id: 1 }, { id: 2 }] };
    expect(checkOutputMatches([{ path: "x", equals: eq }], { x: { items: [{ id: 1 }, { id: 2 }] } })).toBeNull();
    expect(checkOutputMatches([{ path: "x", equals: eq }], { x: { items: [{ id: 1 }, { id: 3 }] } })).not.toBeNull();
  });

  it("treats NaN as equal to NaN (Object.is)", () => {
    expect(checkOutputMatches([{ path: "x", equals: NaN }], { x: NaN })).toBeNull();
  });

  it("treats null as equal to null", () => {
    expect(checkOutputMatches([{ path: "x", equals: null }], { x: null })).toBeNull();
    expect(checkOutputMatches([{ path: "x", equals: null }], { x: 0 })).not.toBeNull();
  });

  it("differentiates {a: undefined} from {} (presence of key matters)", () => {
    expect(checkOutputMatches([{ path: "x", equals: { a: undefined } }], { x: { a: undefined } })).toBeNull();
    expect(checkOutputMatches([{ path: "x", equals: { a: undefined } }], { x: {} })).not.toBeNull();
  });

  it("differentiates an array from an object even when both have same length-ish shape", () => {
    expect(
      checkOutputMatches([{ path: "x", equals: { 0: "a", 1: "b", length: 2 } }], { x: ["a", "b"] }),
    ).not.toBeNull();
  });
});

describe("regex / matches edge cases", () => {
  it("respects regex special characters when matching strings", () => {
    expect(checkOutputMatches([{ path: "v", matches: "^foo\\.bar$" }], { v: "foo.bar" })).toBeNull();
    expect(checkOutputMatches([{ path: "v", matches: "^foo\\.bar$" }], { v: "foo.baz" })).not.toBeNull();
  });

  it("coerces numbers to their JSON string form for matching", () => {
    expect(checkOutputMatches([{ path: "v", matches: "^123$" }], { v: 123 })).toBeNull();
  });

  it("coerces objects to their JSON string form for matching", () => {
    expect(checkOutputMatches([{ path: "v", matches: '"x":"abc"' }], { v: { x: "abc" } })).toBeNull();
  });

  it("reports a clear failure when the regex source is invalid", () => {
    const err = checkOutputMatches([{ path: "v", matches: "(unclosed" }], { v: "x" });
    expect(err).toMatch(/output_matches.*invalid regex/);
  });

  it("rejects regex source longer than the safety cap (ReDoS guard)", () => {
    const longPattern = "a".repeat(1001);
    const err = checkOutputMatches([{ path: "v", matches: longPattern }], { v: "x" });
    expect(err).toMatch(/output_matches.*1000 characters/);
  });

  it("accepts regex sources just under the safety cap", () => {
    const pattern = "a".repeat(999) + "b";
    const value = "a".repeat(999) + "b";
    expect(checkOutputMatches([{ path: "v", matches: pattern }], { v: value })).toBeNull();
  });
});

describe("non-object node data", () => {
  it("checkOutputRequired against null data fails cleanly", () => {
    const err = checkOutputRequired(["x"], null);
    expect(err).toMatch(/output_required.*'x'/);
  });

  it("checkOutputMatches against null data fails cleanly", () => {
    const err = checkOutputMatches([{ path: "x", equals: 1 }], null);
    expect(err).toMatch(/output_matches.*'x'/);
  });

  it("checkOutputRequired against a primitive fails cleanly", () => {
    const err = checkOutputRequired(["x"], "string");
    expect(err).toMatch(/output_required.*'x'/);
  });
});

describe("output_matches all-mode aggregation", () => {
  it("reports every offending value, not just the first", () => {
    const data = { sevs: [{ s: "urgent" }, { s: "high" }, { s: "yikes" }] };
    const err = checkOutputMatches([{ path: "sevs[*].s", in: ["high", "low"] }], data);
    expect(err).toMatch(/"urgent"/);
    expect(err).toMatch(/"yikes"/);
    const m = err!.match(/got \[(.*)\]$/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('"high"');
  });
});

describe("path-resolution failures inside output_matches", () => {
  it("missing path produces a clean message naming the missing segment", () => {
    const err = checkOutputMatches([{ path: "missing.x", equals: 1 }], { other: 1 });
    expect(err).toMatch(/output_matches.*'missing\.x'.*missing segment 'missing'/);
  });

  it("[*] against a non-array fails cleanly", () => {
    const err = checkOutputMatches([{ path: "x[*].y", equals: 1 }], { x: { not: "an array" } });
    expect(err).toMatch(/output_matches.*expected array at 'x'/);
  });
});

describe("output_matches matches operator with mixed pass/fail values", () => {
  it("aggregates only the offending values under all-mode matches", () => {
    const data = { urls: ["https://a", "ftp://b", "https://c", "ssh://d"] };
    const err = checkOutputMatches([{ path: "urls[*]", matches: "^https://" }], data);
    expect(err).toMatch(/"ftp:\/\/b"/);
    expect(err).toMatch(/"ssh:\/\/d"/);
    const offenders = err!.match(/got \[(.*)\]$/)![1]!;
    expect(offenders).not.toContain("https://a");
    expect(offenders).not.toContain("https://c");
  });
});

describe("applyOperator defensive fallthrough", () => {
  it("returns a clean error when no operator is declared (zod-bypass guard)", () => {
    const bogus = { path: "x" } as unknown as Parameters<typeof checkOutputMatches>[0][0];
    const err = checkOutputMatches([bogus], { x: 1 });
    expect(err).toMatch(/output_matches.*'x'.*no operator/);
  });
});

describe("evaluateValueRule", () => {
  it("returns pass:true when an empty rule has no checks to fail", () => {
    expect(evaluateValueRule({}, {})).toEqual({ pass: true });
  });

  it("returns pass:true when every check passes", () => {
    const verdict = evaluateValueRule({ output_required: ["a"], output_matches: [{ path: "a", equals: 1 }] }, { a: 1 });
    expect(verdict).toEqual({ pass: true });
  });

  it("returns pass:false with combined reasoning when both checks fail", () => {
    const verdict = evaluateValueRule(
      {
        output_required: ["missing"],
        output_matches: [{ path: "x", equals: 1 }],
      },
      { x: 999 },
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reasoning).toMatch(/output_required/);
    expect(verdict.reasoning).toMatch(/output_matches/);
  });

  it("ignores function-rule fields if they leak into a value rule (silent)", () => {
    // Permissive shape: function fields are not checked under value dispatch.
    const verdict = evaluateValueRule(
      { output_required: ["a"], any_tool_called: ["should_be_ignored"] } as Parameters<typeof evaluateValueRule>[0],
      { a: 1 },
    );
    expect(verdict.pass).toBe(true);
  });
});
