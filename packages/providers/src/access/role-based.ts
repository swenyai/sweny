import type { UserIdentity } from "../auth/types.js";
import type { AccessGuard } from "./types.js";
import { AccessLevel, AccessDeniedError } from "./types.js";

export interface RoleMapping {
  admin?: string[];
  readWrite?: string[];
  readOnly?: string[];
}

class RoleBasedGuard implements AccessGuard {
  private readonly mapping: RoleMapping;

  constructor(mapping: RoleMapping) {
    this.mapping = mapping;
  }

  resolveAccessLevel(user: UserIdentity): AccessLevel {
    const userRoles = new Set(user.roles);

    if (this.mapping.admin?.some((r) => userRoles.has(r))) {
      return AccessLevel.ADMIN;
    }

    if (this.mapping.readWrite?.some((r) => userRoles.has(r))) {
      return AccessLevel.READ_WRITE;
    }

    if (this.mapping.readOnly?.some((r) => userRoles.has(r))) {
      return AccessLevel.READ_ONLY;
    }

    return AccessLevel.FORBIDDEN;
  }

  assertNotForbidden(user: UserIdentity): void {
    const level = this.resolveAccessLevel(user);
    if (level === AccessLevel.FORBIDDEN) {
      throw new AccessDeniedError(
        `User "${user.userId}" does not have any permitted role`,
      );
    }
  }

  assertCanQuery(user: UserIdentity): void {
    const level = this.resolveAccessLevel(user);
    if (level === AccessLevel.FORBIDDEN) {
      throw new AccessDeniedError(
        `User "${user.userId}" does not have read access`,
      );
    }
  }

  assertCanMutate(user: UserIdentity): void {
    const level = this.resolveAccessLevel(user);
    if (level === AccessLevel.FORBIDDEN || level === AccessLevel.READ_ONLY) {
      throw new AccessDeniedError(
        `User "${user.userId}" does not have write access`,
      );
    }
  }
}

export function roleBasedGuard(mapping: RoleMapping): AccessGuard {
  return new RoleBasedGuard(mapping);
}
