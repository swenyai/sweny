# Tests: CSI Storage + AWS Secrets Manager Providers

Add unit tests for CSI storage factory and AWS Secrets Manager credential vault.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Pattern: Storage tests (from tests/storage/factories.test.ts)

```ts
import { describe, it, expect } from "vitest";
import { fsStorage } from "../../src/storage/fs.js";
import { FsSessionStore } from "../../src/storage/session/fs.js";
import { FsMemoryStore } from "../../src/storage/memory/fs.js";
import { FsWorkspaceStore } from "../../src/storage/workspace/fs.js";

describe("fsStorage factory", () => {
  it("returns a StorageProvider", () => {
    const storage = fsStorage({ baseDir: "/tmp/test" });
    expect(typeof storage.createSessionStore).toBe("function");
    expect(typeof storage.createMemoryStore).toBe("function");
    expect(typeof storage.createWorkspaceStore).toBe("function");
  });
  it("createSessionStore returns FsSessionStore", () => {
    const store = fsStorage({ baseDir: "/tmp/test" }).createSessionStore();
    expect(store).toBeInstanceOf(FsSessionStore);
  });
});
```

## Pattern: Credential vault tests (from tests/credential-vault.test.ts)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envVault } from "../src/credential-vault/env-vault.js";

describe("envVault", () => {
  it("reads tenant-scoped env var", async () => {
    const vault = envVault();
    const value = await vault.getSecret("tenant1", "DD_API_KEY");
    expect(value).toBe("tenant-key-123");
  });
  it("setSecret throws (read-only)", async () => {
    await expect(vault.setSecret("t1", "key", "val")).rejects.toThrow("read-only");
  });
});
```

## Task

### Part 1: CSI Storage Tests

Create `tests/storage/csi.test.ts`.

Import: `import { csiStorage } from "../../src/storage/csi.js";`

The CSI provider (`src/storage/csi.ts`):
- Takes `mountPath`, optional `volumeName`, optional `namespace`
- Validates mount path exists using `existsSync`
- Delegates to FsSessionStore, FsMemoryStore, FsWorkspaceStore

Tests:
- Factory returns StorageProvider with 3 create methods
- `createSessionStore()` returns FsSessionStore instance
- `createMemoryStore()` returns FsMemoryStore instance
- `createWorkspaceStore()` returns FsWorkspaceStore instance
- Throws when mountPath doesn't exist (use a non-existent path like "/nonexistent/mount/path")
- Uses mountPath as base directory (create temp dir, pass it, verify stores work)

### Part 2: AWS Secrets Manager Tests

Create `tests/aws-secrets-manager.test.ts`.

Import: `import { awsSecretsManager } from "../src/credential-vault/aws-secrets-manager.js";`

The AWS SM provider uses lazy-loaded `@aws-sdk/client-secrets-manager`. Mock the SDK:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class { send = mockSend; },
  GetSecretValueCommand: class { constructor(public input: any) {} },
  CreateSecretCommand: class { constructor(public input: any) {} },
  PutSecretValueCommand: class { constructor(public input: any) {} },
  DeleteSecretCommand: class { constructor(public input: any) {} },
  ListSecretsCommand: class { constructor(public input: any) {} },
}));
```

Tests:
- Factory returns CredentialVaultProvider with all 4 methods
- `getSecret()`: returns SecretString from GetSecretValueCommand
- `getSecret()`: returns null when ResourceNotFoundException
- `getSecret()`: uses correct secret name format: `{prefix}/{tenantId}/{key}`
- `setSecret()`: calls CreateSecretCommand first
- `setSecret()`: falls back to PutSecretValueCommand on ResourceExistsException
- `deleteSecret()`: calls DeleteSecretCommand with ForceDeleteWithoutRecovery
- `listKeys()`: returns key names extracted from secret names
- `listKeys()`: handles pagination (NextToken)
- Default config: region="us-east-1", prefix="sweny"
- Custom prefix changes secret name format

## Completion

1. Run `npx vitest run tests/storage/csi.test.ts tests/aws-secrets-manager.test.ts`
2. Run `npx vitest run`
3. Rename: `mv packages/providers/18-test-storage-vault.todo.md packages/providers/18-test-storage-vault.done.md`
4. Commit:
```
test: add unit tests for CSI storage and AWS Secrets Manager providers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
