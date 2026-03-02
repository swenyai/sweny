---
title: Credential Vault
description: Store and retrieve secrets scoped to tenants.
---

The credential vault provides tenant-scoped secret storage. In multi-tenant deployments (like a SaaS version of SWEny), each tenant has their own Datadog keys, Linear tokens, etc. The vault interface abstracts where those secrets live — environment variables in open source, a database in production.

If you're running SWEny as a single-tenant GitHub Action, you probably don't need this directly. It's used internally by the action to resolve provider credentials.

```typescript
import { envVault, awsSecretsManager } from "@sweny-ai/providers/credential-vault";
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

Reads secrets from environment variables. This is the default for the open-source GitHub Action, where secrets come from GitHub Actions secrets via env vars:

```typescript
const vault = envVault({
  prefix: "SWENY", // optional, default "SWENY"
});

const ddKey = await vault.getSecret("acme", "api-key");
// Checks SWENY_ACME_API_KEY first, falls back to SWENY_API_KEY
```

### Lookup pattern

Key lookup follows a tenant-scoped convention: `{PREFIX}_{TENANT_ID}_{KEY}` (uppercased, hyphens replaced with underscores). If the tenant-scoped var isn't set, it falls back to `{PREFIX}_{KEY}`.

| Call | Checks (in order) |
|------|-------------------|
| `getSecret("acme", "api-key")` | `SWENY_ACME_API_KEY` → `SWENY_API_KEY` |
| `getSecret("acme", "dd-app-key")` | `SWENY_ACME_DD_APP_KEY` → `SWENY_DD_APP_KEY` |

### Limitations

The env vault is **read-only** — `setSecret`, `deleteSecret`, and `listKeys` throw errors. This is by design: environment variables are immutable at runtime.

## AWS Secrets Manager

For production multi-tenant deployments with full read/write support:

```typescript
const vault = awsSecretsManager({
  region: "us-east-1",  // optional, defaults to "us-east-1"
  prefix: "sweny",      // optional, defaults to "sweny"
});

const ddKey = await vault.getSecret("acme", "api-key");
// Reads the secret named: sweny/acme/api-key
```

### Secret naming

Secrets are stored as `{prefix}/{tenantId}/{key}`:

| Call | Secret name |
|------|-------------|
| `getSecret("acme", "api-key")` | `sweny/acme/api-key` |
| `setSecret("acme", "dd-app-key", "...")` | `sweny/acme/dd-app-key` |

Requires `@aws-sdk/client-secrets-manager` as a peer dependency. Uses lazy loading — the SDK is only imported on first use.
