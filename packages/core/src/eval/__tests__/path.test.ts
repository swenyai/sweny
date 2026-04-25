import { describe, expect, it } from "vitest";
import { resolvePath } from "../path.js";

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
});
