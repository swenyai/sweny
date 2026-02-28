import type { CredentialVaultProvider } from "./types.js";

/**
 * Reads secrets from environment variables.
 *
 * Key lookup: `{PREFIX}_{TENANT_ID}_{KEY}` (uppercased, hyphens → underscores).
 * Falls back to `{PREFIX}_{KEY}` if the tenant-scoped var is not set.
 *
 * This is useful for local development and the open-source GitHub Action
 * where secrets come from env vars rather than a database.
 */
export interface EnvVaultConfig {
  prefix?: string;
}

export function envVault(config?: EnvVaultConfig): CredentialVaultProvider {
  const prefix = config?.prefix ?? "SWENY";

  function envKey(tenantId: string, key: string): string {
    const normalized = `${prefix}_${tenantId}_${key}`.toUpperCase().replace(/-/g, "_");
    return normalized;
  }

  function fallbackKey(key: string): string {
    return `${prefix}_${key}`.toUpperCase().replace(/-/g, "_");
  }

  return {
    async getSecret(tenantId: string, key: string): Promise<string | null> {
      return process.env[envKey(tenantId, key)] ?? process.env[fallbackKey(key)] ?? null;
    },

    async setSecret(_tenantId: string, _key: string, _value: string): Promise<void> {
      throw new Error("envVault is read-only. Use a database-backed vault for writes.");
    },

    async deleteSecret(_tenantId: string, _key: string): Promise<void> {
      throw new Error("envVault is read-only. Use a database-backed vault for deletes.");
    },

    async listKeys(_tenantId: string): Promise<string[]> {
      throw new Error("envVault does not support listing keys. Use a database-backed vault.");
    },
  };
}
