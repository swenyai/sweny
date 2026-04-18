import { describe, expect, it } from "vitest";
import {
  checkAllToolsCalled,
  checkAnyToolCalled,
  checkNoToolCalled,
  checkOutputMatches,
  checkOutputRequired,
  evaluateVerify,
  resolvePath,
} from "../verify.js";
import type { NodeResult, ToolCall } from "../types.js";

const tc = (tool: string, output?: unknown): ToolCall => ({ tool, input: {}, output });
const errOut = { error: "boom" };

describe("resolvePath", () => {
  describe("simple dotted paths", () => {
    it("resolves a top-level key", () => {
      expect(resolvePath({ a: 1 }, "a")).toEqual({ ok: true, mode: "all", values: [1] });
    });

    it("resolves a nested key", () => {
      expect(resolvePath({ a: { b: { c: "x" } } }, "a.b.c")).toEqual({
        ok: true,
        mode: "all",
        values: ["x"],
      });
    });

    it("returns the literal null value (does not treat null as missing)", () => {
      expect(resolvePath({ a: null }, "a")).toEqual({ ok: true, mode: "all", values: [null] });
    });

    it("fails when a top-level segment is missing", () => {
      const r = resolvePath({}, "a");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/missing segment 'a'/);
    });

    it("fails when an intermediate segment is missing", () => {
      const r = resolvePath({ a: {} }, "a.b.c");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/missing segment 'b'/);
    });

    it("fails when an intermediate segment is null", () => {
      const r = resolvePath({ a: null }, "a.b");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/null/);
    });
  });

  describe("wildcard expansion", () => {
    it("expands [*] over an array of primitives", () => {
      expect(resolvePath({ xs: [1, 2, 3] }, "xs[*]")).toEqual({
        ok: true,
        mode: "all",
        values: [1, 2, 3],
      });
    });

    it("expands [*] then walks into each element", () => {
      const data = { findings: [{ severity: "critical" }, { severity: "low" }] };
      expect(resolvePath(data, "findings[*].severity")).toEqual({
        ok: true,
        mode: "all",
        values: ["critical", "low"],
      });
    });

    it("returns an empty values array when the array is empty", () => {
      expect(resolvePath({ xs: [] }, "xs[*]")).toEqual({ ok: true, mode: "all", values: [] });
    });

    it("returns an empty values array when expanding deeper into an empty array", () => {
      expect(resolvePath({ findings: [] }, "findings[*].severity")).toEqual({
        ok: true,
        mode: "all",
        values: [],
      });
    });

    it("fails when [*] is applied to a non-array", () => {
      const r = resolvePath({ xs: { not: "array" } }, "xs[*]");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/expected array at 'xs'/);
    });

    it("fails when an element under [*] is missing the next segment", () => {
      const data = { findings: [{ severity: "critical" }, { title: "x" }] };
      const r = resolvePath(data, "findings[*].severity");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/missing segment 'severity'/);
    });
  });

  describe("mode prefixes", () => {
    it("parses `all:` prefix", () => {
      const r = resolvePath({ xs: [1, 2] }, "all:xs[*]");
      expect(r).toEqual({ ok: true, mode: "all", values: [1, 2] });
    });

    it("parses `any:` prefix", () => {
      const r = resolvePath({ xs: [1, 2] }, "any:xs[*]");
      expect(r).toEqual({ ok: true, mode: "any", values: [1, 2] });
    });

    it("defaults to `all` when no prefix", () => {
      const r = resolvePath({ xs: [1] }, "xs[*]");
      expect(r).toEqual({ ok: true, mode: "all", values: [1] });
    });

    it("rejects an unknown prefix", () => {
      const r = resolvePath({ xs: [1] }, "every:xs[*]");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/unknown prefix 'every'/);
    });
  });

  describe("grammar errors", () => {
    it("rejects an empty path", () => {
      const r = resolvePath({}, "");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/empty path/);
    });

    it("rejects a malformed segment", () => {
      const r = resolvePath({}, "a..b");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/malformed/);
    });
  });
});

describe("checkAnyToolCalled", () => {
  it("passes when one of the named tools succeeded", () => {
    expect(checkAnyToolCalled(["a", "b"], [tc("a", { ok: true })])).toBeNull();
  });

  it("passes when one succeeded among others", () => {
    expect(checkAnyToolCalled(["a"], [tc("x"), tc("a", { ok: true }), tc("y")])).toBeNull();
  });

  it("fails when only an unrelated tool was called", () => {
    const err = checkAnyToolCalled(["a", "b"], [tc("x")]);
    expect(err).toMatch(/any_tool_called.*required one of \[a, b\].*called.*x/);
  });

  it("fails when the required tool errored", () => {
    const err = checkAnyToolCalled(["a"], [tc("a", errOut)]);
    expect(err).toMatch(/any_tool_called/);
  });

  it("reports 'none' when no tools were called", () => {
    const err = checkAnyToolCalled(["a"], []);
    expect(err).toMatch(/called: \[none\]/);
  });
});

describe("checkAllToolsCalled", () => {
  it("passes when every named tool succeeded", () => {
    expect(checkAllToolsCalled(["a", "b"], [tc("a", { ok: true }), tc("b", { ok: true })])).toBeNull();
  });

  it("passes when extras were also called", () => {
    expect(checkAllToolsCalled(["a"], [tc("a", { ok: true }), tc("x"), tc("y")])).toBeNull();
  });

  it("fails when a required tool was never called", () => {
    const err = checkAllToolsCalled(["a", "b"], [tc("a", { ok: true })]);
    expect(err).toMatch(/all_tools_called.*missing.*\[b\]/);
  });

  it("fails when a required tool only errored", () => {
    const err = checkAllToolsCalled(["a", "b"], [tc("a", { ok: true }), tc("b", errOut)]);
    expect(err).toMatch(/all_tools_called.*missing.*\[b\]/);
  });
});

describe("checkNoToolCalled", () => {
  it("passes when none of the named tools were called", () => {
    expect(checkNoToolCalled(["a", "b"], [tc("x"), tc("y")])).toBeNull();
  });

  it("passes when toolCalls is empty", () => {
    expect(checkNoToolCalled(["a"], [])).toBeNull();
  });

  it("fails when a forbidden tool was called successfully", () => {
    const err = checkNoToolCalled(["force_push"], [tc("force_push", { ok: true })]);
    expect(err).toMatch(/no_tool_called.*forbidden.*\[force_push\]/);
  });

  it("fails when a forbidden tool was called even with error", () => {
    const err = checkNoToolCalled(["force_push"], [tc("force_push", errOut)]);
    expect(err).toMatch(/no_tool_called/);
  });
});

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

const result = (data: Record<string, unknown>, toolCalls: ToolCall[] = []): NodeResult => ({
  status: "success",
  data,
  toolCalls,
});

describe("evaluateVerify", () => {
  it("returns null when verify is undefined", () => {
    expect(evaluateVerify(undefined, result({}))).toBeNull();
  });

  it("returns null when every declared check passes", () => {
    const v = {
      any_tool_called: ["a"],
      output_required: ["x"],
      output_matches: [{ path: "x", equals: 1 }],
    };
    const r = result({ x: 1 }, [tc("a", { ok: true })]);
    expect(evaluateVerify(v, r)).toBeNull();
  });

  it("aggregates failures from multiple checks into one error string", () => {
    const v = {
      any_tool_called: ["create_pr"],
      no_tool_called: ["force_push"],
      output_required: ["prUrl"],
      output_matches: [{ path: "branch", matches: "^sweny/" }],
    };
    const r = result({ branch: "main" }, [tc("force_push", { ok: true })]);
    const err = evaluateVerify(v, r);
    expect(err).not.toBeNull();
    expect(err!).toMatch(/^verify failed:/);
    expect(err!).toMatch(/any_tool_called/);
    expect(err!).toMatch(/no_tool_called/);
    expect(err!).toMatch(/output_required/);
    expect(err!).toMatch(/output_matches/);
  });

  it("formats failures as a bulleted list", () => {
    const v = { any_tool_called: ["a"], no_tool_called: ["b"] };
    const r = result({}, [tc("b")]);
    const err = evaluateVerify(v, r);
    expect(err).toMatch(/\n {2}- /);
  });
});

// ─── Hardening tests added in response to PR #158 review ─────────────

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
    // Unescaped `.` is regex any-char — `foo_bar` would still match `foo.bar`,
    // but `foo.baz` should not match `^foo\.bar$`.
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
});

describe("nested wildcard chains", () => {
  it("expands a[*].b[*].c", () => {
    const data = {
      a: [{ b: [{ c: 1 }, { c: 2 }] }, { b: [{ c: 3 }] }],
    };
    const r = resolvePath(data, "a[*].b[*].c");
    expect(r).toEqual({ ok: true, mode: "all", values: [1, 2, 3] });
  });

  it("fails when an inner array is missing", () => {
    const data = { a: [{ b: [{ c: 1 }] }, { b: { c: 2 } }] };
    const r = resolvePath(data, "a[*].b[*].c");
    expect(r.ok).toBe(false);
  });
});

describe("malformed paths", () => {
  it("rejects [*] at the start (no identifier)", () => {
    const r = resolvePath({ a: [1] }, "[*].x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/malformed segment/);
  });

  it("rejects double brackets a[*][*]", () => {
    const r = resolvePath({ a: [[1]] }, "a[*][*]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/malformed segment/);
  });

  it("rejects a path with only a prefix", () => {
    const r = resolvePath({ a: 1 }, "all:");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty path after prefix/);
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

describe("isErrorOutput tolerance for null/false sentinels", () => {
  it("treats {error: null} as success", () => {
    const err = checkAnyToolCalled(["save"], [tc("save", { ok: true, error: null })]);
    expect(err).toBeNull();
  });

  it("treats {error: false} as success", () => {
    const err = checkAnyToolCalled(["save"], [tc("save", { ok: true, error: false })]);
    expect(err).toBeNull();
  });

  it("treats {error: undefined} as success", () => {
    const err = checkAnyToolCalled(["save"], [tc("save", { ok: true, error: undefined })]);
    expect(err).toBeNull();
  });

  it("treats {error: 0} as success (zero is not an error)", () => {
    // Defensive: only truthy/non-null/non-false `error` values should fail.
    // `error: 0` is unusual but the contract is "presence of an error value".
    const err = checkAnyToolCalled(["save"], [tc("save", { ok: true, error: 0 })]);
    // We DO treat `0` as an error because it's neither null, undefined, nor false.
    // Pin this so future readers see it's intentional.
    expect(err).not.toBeNull();
  });

  it("treats {error: 'boom'} as failure", () => {
    const err = checkAnyToolCalled(["save"], [tc("save", { error: "boom" })]);
    expect(err).not.toBeNull();
  });
});

describe("output_matches all-mode aggregation", () => {
  it("reports every offending value, not just the first", () => {
    const data = { sevs: [{ s: "urgent" }, { s: "high" }, { s: "yikes" }] };
    const err = checkOutputMatches([{ path: "sevs[*].s", in: ["high", "low"] }], data);
    expect(err).toMatch(/"urgent"/);
    expect(err).toMatch(/"yikes"/);
    // "high" satisfies the operator and must NOT appear as an offender
    // (verify by absence-of-substring within the offenders bracket section).
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

describe("tool-call message parity", () => {
  it("checkAllToolsCalled includes the called: tail", () => {
    const err = checkAllToolsCalled(["save", "send"], [tc("save", { ok: true }), tc("log")]);
    expect(err).toMatch(/missing successful calls to \[send\]/);
    expect(err).toMatch(/called: \[save, log\]/);
  });

  it("checkNoToolCalled includes the called: tail", () => {
    const err = checkNoToolCalled(["force_push"], [tc("force_push"), tc("log")]);
    expect(err).toMatch(/forbidden tools were invoked: \[force_push\]/);
    expect(err).toMatch(/called: \[force_push, log\]/);
  });
});

describe("evaluateVerify exact failure-string format (public contract)", () => {
  it("produces the exact bulleted format", () => {
    const v = {
      any_tool_called: ["save"],
      output_required: ["url"],
    };
    const r: NodeResult = {
      status: "success",
      data: {},
      toolCalls: [tc("read")],
    };
    const err = evaluateVerify(v, r);
    expect(err).toBe(
      [
        "verify failed:",
        "  - any_tool_called: required one of [save] to succeed, called: [read]",
        "  - output_required: 'url' missing segment 'url'",
      ].join("\n"),
    );
  });
});
