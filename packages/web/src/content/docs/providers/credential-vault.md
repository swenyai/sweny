---
title: Credential Vault
description: Store and retrieve secrets scoped to tenants.
---

```typescript
import { envVault } from "@sweny/providers/credential-vault";
```

## Interface

```typescript
interface CredentialVaultProvider {
  getSecret(tenantId: string, key: string): Promise<string | null>;
  setSecret(tenantId: string, key: string, value: string): Promise<void>;
  deleteSecret(tenantId: string, key: string): Promise<void>;
  listKeys(tenantId: string): Promise<string[]>;
}
```

## Env Vault

Reads secrets from environment variables. Useful for local development and the open-source GitHub Action where secrets come from env vars rather than a database:

```typescript
const vault = envVault({
  prefix: "SWENY", // optional, default "SWENY"
});
```

Key lookup follows a tenant-scoped pattern: `{PREFIX}_{TENANT_ID}_{KEY}` (uppercased, hyphens replaced with underscores). Falls back to `{PREFIX}_{KEY}` if the tenant-scoped var is not set.

For example, `vault.getSecret("acme", "api-key")` checks `SWENY_ACME_API_KEY` first, then `SWENY_API_KEY`.

The env vault is **read-only** -- `setSecret`, `deleteSecret`, and `listKeys` throw errors. Use a database-backed vault for write operations.
