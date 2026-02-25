import type { UserIdentity } from "../auth/types.js";
import type { AccessGuard } from "./types.js";
import { AccessLevel } from "./types.js";

class AllowAllGuard implements AccessGuard {
  resolveAccessLevel(_user: UserIdentity): AccessLevel {
    return AccessLevel.READ_WRITE;
  }

  assertNotForbidden(_user: UserIdentity): void {
    // all users are allowed
  }

  assertCanQuery(_user: UserIdentity): void {
    // all users can query
  }

  assertCanMutate(_user: UserIdentity): void {
    // all users can mutate
  }
}

export function allowAllGuard(): AccessGuard {
  return new AllowAllGuard();
}
