---
title: Auth
description: Authenticate users for the SWEny agent.
---

```typescript
import { noAuth, apiKeyAuth } from "@sweny-ai/providers/auth";
```

## Interface

```typescript
interface AuthProvider {
  readonly displayName: string;
  readonly loginFields?: LoginField[];
  authenticate(userId: string): Promise<UserIdentity | null>;
  login?(userId: string, credentials: Record<string, string>): Promise<UserIdentity>;
  hasValidSession(userId: string): boolean;
  clearSession(userId: string): void;
}

interface UserIdentity {
  userId: string;
  displayName: string;
  email?: string;
  roles: string[];
  metadata: Record<string, unknown>;
}
```

## No Auth

Allows all users without authentication. Every user gets the `admin` role:

```typescript
const auth = noAuth();
```

Useful for local development and single-user deployments.

## API Key Auth

Validates users against a custom function:

```typescript
const auth = apiKeyAuth({
  validate: async (apiKey) => {
    // Look up the key in your database
    const user = await db.findByApiKey(apiKey);
    if (!user) return null;
    return {
      userId: user.id,
      displayName: user.name,
      email: user.email,
      roles: user.roles,
      metadata: {},
    };
  },
});
```

Sessions are stored in memory and lost on restart.
