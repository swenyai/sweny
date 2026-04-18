import { describe, expect, it } from "vitest";
import {
  checkAllToolsCalled,
  checkAnyToolCalled,
  checkNoToolCalled,
  checkOutputMatches,
  checkOutputRequired,
  resolvePath,
} from "../verify.js";
import type { ToolCall } from "../types.js";

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
    expect(err).toMatch(/output_matches.*'sev'.*in.*\[high, low\].*got.*urgent/);
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
    expect(err).toMatch(/output_matches.*no element.*satisfied/);
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
