import { describe, it, expect } from "vitest";
import { allowAllGuard } from "../../src/access/allow-all.js";
import { roleBasedGuard } from "../../src/access/role-based.js";
import { AccessLevel, AccessDeniedError } from "../../src/access/types.js";
import type { UserIdentity } from "../../src/auth/types.js";

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
    expect(guard.resolveAccessLevel(makeUser({ roles: [] }))).toBe(AccessLevel.READ_WRITE);
  });

  it("assertCanQuery never throws", () => {
    expect(() => guard.assertCanQuery(makeUser())).not.toThrow();
  });

  it("assertCanMutate never throws", () => {
    expect(() => guard.assertCanMutate(makeUser())).not.toThrow();
  });

  it("assertNotForbidden never throws", () => {
    expect(() => guard.assertNotForbidden(makeUser())).not.toThrow();
  });
});

describe("RoleBasedGuard", () => {
  const guard = roleBasedGuard({
    admin: ["admin", "super-admin"],
    readWrite: ["editor", "developer"],
    readOnly: ["viewer"],
  });

  describe("resolveAccessLevel", () => {
    it("admin role gets ADMIN level", () => {
      expect(guard.resolveAccessLevel(makeUser({ roles: ["admin"] }))).toBe(AccessLevel.ADMIN);
      expect(guard.resolveAccessLevel(makeUser({ roles: ["super-admin"] }))).toBe(AccessLevel.ADMIN);
    });

    it("readWrite role gets READ_WRITE level", () => {
      expect(guard.resolveAccessLevel(makeUser({ roles: ["editor"] }))).toBe(AccessLevel.READ_WRITE);
      expect(guard.resolveAccessLevel(makeUser({ roles: ["developer"] }))).toBe(AccessLevel.READ_WRITE);
    });

    it("readOnly role gets READ_ONLY level", () => {
      expect(guard.resolveAccessLevel(makeUser({ roles: ["viewer"] }))).toBe(AccessLevel.READ_ONLY);
    });

    it("unknown role gets FORBIDDEN level", () => {
      expect(guard.resolveAccessLevel(makeUser({ roles: ["guest"] }))).toBe(AccessLevel.FORBIDDEN);
      expect(guard.resolveAccessLevel(makeUser({ roles: [] }))).toBe(AccessLevel.FORBIDDEN);
    });

    it("highest matching role wins (admin over readWrite)", () => {
      expect(guard.resolveAccessLevel(makeUser({ roles: ["viewer", "admin"] }))).toBe(AccessLevel.ADMIN);
    });
  });

  describe("assertCanQuery", () => {
    it("throws AccessDeniedError for FORBIDDEN users", () => {
      const user = makeUser({ roles: ["unknown-role"] });
      expect(() => guard.assertCanQuery(user)).toThrow(AccessDeniedError);
    });

    it("does not throw for READ_ONLY users", () => {
      const user = makeUser({ roles: ["viewer"] });
      expect(() => guard.assertCanQuery(user)).not.toThrow();
    });

    it("does not throw for READ_WRITE users", () => {
      const user = makeUser({ roles: ["editor"] });
      expect(() => guard.assertCanQuery(user)).not.toThrow();
    });

    it("does not throw for ADMIN users", () => {
      const user = makeUser({ roles: ["admin"] });
      expect(() => guard.assertCanQuery(user)).not.toThrow();
    });
  });

  describe("assertCanMutate", () => {
    it("throws AccessDeniedError for FORBIDDEN users", () => {
      const user = makeUser({ roles: [] });
      expect(() => guard.assertCanMutate(user)).toThrow(AccessDeniedError);
    });

    it("throws AccessDeniedError for READ_ONLY users", () => {
      const user = makeUser({ roles: ["viewer"] });
      expect(() => guard.assertCanMutate(user)).toThrow(AccessDeniedError);
    });

    it("passes for READ_WRITE users", () => {
      const user = makeUser({ roles: ["editor"] });
      expect(() => guard.assertCanMutate(user)).not.toThrow();
    });

    it("passes for ADMIN users", () => {
      const user = makeUser({ roles: ["admin"] });
      expect(() => guard.assertCanMutate(user)).not.toThrow();
    });
  });
});
