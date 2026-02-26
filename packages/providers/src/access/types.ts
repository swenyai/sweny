import type { UserIdentity } from "../auth/types.js";

export enum AccessLevel {
  FORBIDDEN = "forbidden",
  READ_ONLY = "read_only",
  READ_WRITE = "read_write",
  ADMIN = "admin",
}

export interface AccessGuard {
  resolveAccessLevel(user: UserIdentity): AccessLevel;
  assertNotForbidden(user: UserIdentity): void;
  assertCanQuery(user: UserIdentity): void;
  assertCanMutate(user: UserIdentity): void;
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
