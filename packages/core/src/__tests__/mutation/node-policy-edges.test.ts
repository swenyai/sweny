/**
 * node-policy.ts had no direct spec: permission resolution decides whether an
 * agent may write, so each branch is pinned here.
 */
import { describe, expect, it } from "vitest";
import { buildNodePolicy, exceedsPermissionCeiling, resolveNodePermissions } from "../../node-policy.js";

describe("resolveNodePermissions: access", () => {
  it("defaults to write with no permissions and no outputs", () => {
    expect(resolveNodePermissions({})).toStrictEqual({ access: "write", deny: [], strict: false });
    expect(resolveNodePermissions({ outputs: [] }).access).toBe("write");
  });

  it("defaults to read when the node declares outputs", () => {
    expect(resolveNodePermissions({ outputs: ["summary"] as never }).access).toBe("read");
  });

  it("a node's own access beats the outputs default", () => {
    expect(resolveNodePermissions({ outputs: ["summary"] as never, permissions: "write" }).access).toBe("write");
    expect(resolveNodePermissions({ outputs: ["summary"] as never, permissions: { access: "write" } }).access).toBe(
      "write",
    );
  });

  it("inherits the workflow access when the node says nothing", () => {
    expect(resolveNodePermissions({}, { permissions: "read" }).access).toBe("read");
    expect(resolveNodePermissions({}, { permissions: { access: "write" } }).access).toBe("write");
    expect(resolveNodePermissions({}, { permissions: { deny: ["net"] } }).access).toBe("write");
  });

  it("a node can narrow write to read under a write workflow", () => {
    expect(resolveNodePermissions({ permissions: "read" }, { permissions: "write" }).access).toBe("read");
  });

  it("a workflow read ceiling wins over a node write", () => {
    expect(resolveNodePermissions({ permissions: "write" }, { permissions: "read" }).access).toBe("read");
    expect(
      resolveNodePermissions({ permissions: { access: "write" } }, { permissions: { access: "read" } }).access,
    ).toBe("read");
  });
});

describe("resolveNodePermissions: deny and strict", () => {
  it("unions deny lists without duplicates", () => {
    const r = resolveNodePermissions(
      { permissions: { deny: ["net", "shell"] } },
      { permissions: { deny: ["shell", "write"] } },
    );
    expect([...r.deny].sort()).toStrictEqual(["net", "shell", "write"]);
  });

  it("strict is on when either side asks for it", () => {
    expect(resolveNodePermissions({ permissions: { strict: true } }).strict).toBe(true);
    expect(resolveNodePermissions({}, { permissions: { strict: true } }).strict).toBe(true);
    expect(resolveNodePermissions({ permissions: { strict: false } }, { permissions: { strict: false } }).strict).toBe(
      false,
    );
  });
});

describe("exceedsPermissionCeiling", () => {
  it("is true only for a node write under a workflow read", () => {
    expect(exceedsPermissionCeiling({ permissions: "write" }, { permissions: "read" })).toBe(true);
    expect(exceedsPermissionCeiling({ permissions: { access: "write" } }, { permissions: { access: "read" } })).toBe(
      true,
    );
  });

  it("is false for every other combination", () => {
    expect(exceedsPermissionCeiling({ permissions: "read" }, { permissions: "read" })).toBe(false);
    expect(exceedsPermissionCeiling({ permissions: "write" }, { permissions: "write" })).toBe(false);
    expect(exceedsPermissionCeiling({ permissions: "write" }, {})).toBe(false);
    expect(exceedsPermissionCeiling({}, { permissions: "read" })).toBe(false);
    expect(exceedsPermissionCeiling({}, {})).toBe(false);
  });
});

describe("buildNodePolicy", () => {
  const write = { access: "write" as const, deny: [], strict: false };

  it("is read-only for dry runs and for read access, writable otherwise", () => {
    expect(buildNodePolicy({ permissions: write, dryRun: false }).readOnly).toBe(false);
    expect(buildNodePolicy({ permissions: write, dryRun: true }).readOnly).toBe(true);
    expect(buildNodePolicy({ permissions: { ...write, access: "read" }, dryRun: false }).readOnly).toBe(true);
  });

  it("emits a minimal policy: no nativeDeny, no exclusiveMcp, empty egress", () => {
    expect(buildNodePolicy({ permissions: write, dryRun: false })).toStrictEqual({
      readOnly: false,
      deny: [],
      egress: [],
      strict: false,
    });
  });

  it("passes deny, egress and non-empty disallowedTools through", () => {
    expect(
      buildNodePolicy({
        permissions: { access: "write", deny: ["net"], strict: false },
        dryRun: false,
        disallowedTools: ["Bash(rm:*)"],
        egress: ["api.example.com"],
      }),
    ).toStrictEqual({
      readOnly: false,
      deny: ["net"],
      nativeDeny: ["Bash(rm:*)"],
      egress: ["api.example.com"],
      strict: false,
    });
  });

  it("omits nativeDeny for an empty list", () => {
    expect("nativeDeny" in buildNodePolicy({ permissions: write, dryRun: false, disallowedTools: [] })).toBe(false);
  });

  it("strict adds exclusiveMcp", () => {
    expect(buildNodePolicy({ permissions: { ...write, strict: true }, dryRun: false })).toStrictEqual({
      readOnly: false,
      deny: [],
      egress: [],
      strict: true,
      exclusiveMcp: true,
    });
  });
});
