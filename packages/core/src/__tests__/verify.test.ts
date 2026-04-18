import { describe, expect, it } from "vitest";
import { checkAllToolsCalled, checkAnyToolCalled, checkNoToolCalled, resolvePath } from "../verify.js";
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
