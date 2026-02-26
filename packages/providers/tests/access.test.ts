import { describe, it, expect } from "vitest";
import { allowAllGuard, roleBasedGuard, AccessLevel, AccessDeniedError } from "../src/access/index.js";
import type { UserIdentity } from "../src/auth/types.js";

function makeUser(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    userId: "test-user",
    displayName: "Test User",
    roles: [],
    metadata: {},
    ...overrides,
  };
}

describe("AllowAllGuard", () => {
  const guard = allowAllGuard();

  it("resolveAccessLevel always returns READ_WRITE", () => {
    expect(guard.resolveAccessLevel(makeUser())).toBe(AccessLevel.READ_WRITE);
    expect(guard.resolveAccessLevel(makeUser({ roles: ["admin"] }))).toBe(AccessLevel.READ_WRITE);
  });

  it("assertNotForbidden never throws", () => {
    expect(() => guard.assertNotForbidden(makeUser())).not.toThrow();
  });

  it("assertCanQuery never throws", () => {
    expect(() => guard.assertCanQuery(makeUser())).not.toThrow();
  });

  it("assertCanMutate never throws", () => {
    expect(() => guard.assertCanMutate(makeUser())).not.toThrow();
  });
});

describe("RoleBasedGuard", () => {
  const guard = roleBasedGuard({
    admin: ["admin", "super-admin"],
    readWrite: ["editor", "developer"],
    readOnly: ["viewer"],
  });

  it("admin role gets ADMIN level", () => {
    expect(guard.resolveAccessLevel(makeUser({ roles: ["admin"] }))).toBe(AccessLevel.ADMIN);
    expect(guard.resolveAccessLevel(makeUser({ roles: ["super-admin"] }))).toBe(AccessLevel.ADMIN);
  });

  it("readWrite role gets READ_WRITE level", () => {
    expect(guard.resolveAccessLevel(makeUser({ roles: ["editor"] }))).toBe(AccessLevel.READ_WRITE);
  });

  it("readOnly role gets READ_ONLY level", () => {
    expect(guard.resolveAccessLevel(makeUser({ roles: ["viewer"] }))).toBe(AccessLevel.READ_ONLY);
  });

  it("unknown role gets FORBIDDEN level", () => {
    expect(guard.resolveAccessLevel(makeUser({ roles: ["guest"] }))).toBe(AccessLevel.FORBIDDEN);
    expect(guard.resolveAccessLevel(makeUser({ roles: [] }))).toBe(AccessLevel.FORBIDDEN);
  });

  it("highest matching role wins", () => {
    expect(guard.resolveAccessLevel(makeUser({ roles: ["viewer", "admin"] }))).toBe(AccessLevel.ADMIN);
  });

  it("assertCanQuery throws for FORBIDDEN users", () => {
    expect(() => guard.assertCanQuery(makeUser({ roles: ["unknown"] }))).toThrow(AccessDeniedError);
  });

  it("assertCanQuery passes for READ_ONLY users", () => {
    expect(() => guard.assertCanQuery(makeUser({ roles: ["viewer"] }))).not.toThrow();
  });

  it("assertCanMutate throws for FORBIDDEN users", () => {
    expect(() => guard.assertCanMutate(makeUser({ roles: [] }))).toThrow(AccessDeniedError);
  });

  it("assertCanMutate throws for READ_ONLY users", () => {
    expect(() => guard.assertCanMutate(makeUser({ roles: ["viewer"] }))).toThrow(AccessDeniedError);
  });

  it("assertCanMutate passes for READ_WRITE users", () => {
    expect(() => guard.assertCanMutate(makeUser({ roles: ["editor"] }))).not.toThrow();
  });

  it("assertCanMutate passes for ADMIN users", () => {
    expect(() => guard.assertCanMutate(makeUser({ roles: ["admin"] }))).not.toThrow();
  });
});
