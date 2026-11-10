/**
 * Edge assertions found by mutation testing of node-policy.ts: `native: none`
 * (no built-in tools, no settings sources) is a ceiling either side can set,
 * and it reaches the harness policy.
 */
import { describe, expect, it } from "vitest";
import { buildNodePolicy, resolveNodePermissions } from "../../node-policy.js";

describe("native: none", () => {
  it("applies when the workflow sets it, the node sets it, or both", () => {
    const none = { native: "none" as const };
    expect(resolveNodePermissions({}, { permissions: none })).toStrictEqual({
      access: "write",
      deny: [],
      strict: false,
      native: "none",
    });
    expect(resolveNodePermissions({ permissions: none })).toStrictEqual({
      access: "write",
      deny: [],
      strict: false,
      native: "none",
    });
    expect(resolveNodePermissions({ permissions: none }, { permissions: none }).native).toBe("none");
  });

  it("a node cannot lift the workflow's none", () => {
    expect(
      resolveNodePermissions({ permissions: { access: "read" } }, { permissions: { native: "none" } }).native,
    ).toBe("none");
  });

  it("is absent when neither side sets it", () => {
    expect("native" in resolveNodePermissions({ permissions: { access: "read" } }, { permissions: "write" })).toBe(
      false,
    );
  });

  it("reaches the harness policy as nativeNone, and only then", () => {
    const base = { access: "write" as const, deny: [], strict: false };
    expect(buildNodePolicy({ permissions: { ...base, native: "none" }, dryRun: false })).toStrictEqual({
      readOnly: false,
      deny: [],
      egress: [],
      strict: false,
      nativeNone: true,
    });
    expect("nativeNone" in buildNodePolicy({ permissions: base, dryRun: false })).toBe(false);
  });
});
