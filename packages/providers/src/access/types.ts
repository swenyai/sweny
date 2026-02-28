import type { UserIdentity } from "../auth/types.js";

/** Permission levels ordered from least to most privileged. */
export enum AccessLevel {
  /** User is not allowed any access. */
  FORBIDDEN = "forbidden",
  /** User may only read / query data. */
  READ_ONLY = "read_only",
  /** User may read and write / mutate data. */
  READ_WRITE = "read_write",
  /** User has full administrative access. */
  ADMIN = "admin",
}

/** Guard that resolves and enforces access levels for authenticated users. */
export interface AccessGuard {
  /**
   * Determine the access level for a user.
   * @param user - The authenticated user identity.
   * @returns The resolved access level.
   */
  resolveAccessLevel(user: UserIdentity): AccessLevel;

  /**
   * Assert that the user is not forbidden. Throws AccessDeniedError if forbidden.
   * @param user - The authenticated user identity.
   */
  assertNotForbidden(user: UserIdentity): void;

  /**
   * Assert that the user has at least read-only access. Throws AccessDeniedError otherwise.
   * @param user - The authenticated user identity.
   */
  assertCanQuery(user: UserIdentity): void;

  /**
   * Assert that the user has read-write or admin access. Throws AccessDeniedError otherwise.
   * @param user - The authenticated user identity.
   */
  assertCanMutate(user: UserIdentity): void;
}

/** Error thrown when a user's access level is insufficient for an operation. */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
