---
title: Access Control
description: Control what users can do based on roles.
---

```typescript
import { allowAllGuard, roleBasedGuard, AccessLevel } from "@sweny/providers/access";
```

## Interface

```typescript
interface AccessGuard {
  resolveAccessLevel(user: UserIdentity): AccessLevel;
  assertNotForbidden(user: UserIdentity): void;
  assertCanQuery(user: UserIdentity): void;
  assertCanMutate(user: UserIdentity): void;
}

enum AccessLevel {
  FORBIDDEN = "forbidden",
  READ_ONLY = "read_only",
  READ_WRITE = "read_write",
  ADMIN = "admin",
}
```

## Allow All

Grants `READ_WRITE` to every user:

```typescript
const guard = allowAllGuard();
```

## Role-Based

Maps user roles to access levels:

```typescript
const guard = roleBasedGuard({
  admin: ["platform-admin", "superuser"],
  readWrite: ["engineer", "developer"],
  readOnly: ["viewer", "support"],
});
```

Users with no matching roles are `FORBIDDEN`. Throws `AccessDeniedError` on assertion failures.
