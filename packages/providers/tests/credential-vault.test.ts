import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envVault } from "../src/credential-vault/env-vault.js";

describe("envVault", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SWENY_TENANT1_DD_API_KEY = "tenant-key-123";
    process.env.SWENY_DD_API_KEY = "fallback-key-456";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads tenant-scoped env var", async () => {
    const vault = envVault();
    const value = await vault.getSecret("tenant1", "DD_API_KEY");
    expect(value).toBe("tenant-key-123");
  });

  it("falls back to unscoped env var", async () => {
    const vault = envVault();
    const value = await vault.getSecret("unknown-tenant", "DD_API_KEY");
    expect(value).toBe("fallback-key-456");
  });

  it("returns null when no env var exists", async () => {
    const vault = envVault();
    const value = await vault.getSecret("tenant1", "NONEXISTENT");
    expect(value).toBeNull();
  });

  it("supports custom prefix", async () => {
    process.env.MYAPP_TENANT1_SECRET = "custom-value";
    const vault = envVault({ prefix: "MYAPP" });
    const value = await vault.getSecret("tenant1", "SECRET");
    expect(value).toBe("custom-value");
  });

  it("normalizes hyphens to underscores", async () => {
    process.env.SWENY_MY_TENANT_MY_KEY = "hyphen-value";
    const vault = envVault();
    const value = await vault.getSecret("my-tenant", "my-key");
    expect(value).toBe("hyphen-value");
  });

  it("setSecret throws (read-only)", async () => {
    const vault = envVault();
    await expect(vault.setSecret("t1", "key", "val")).rejects.toThrow("read-only");
  });

  it("deleteSecret throws (read-only)", async () => {
    const vault = envVault();
    await expect(vault.deleteSecret("t1", "key")).rejects.toThrow("read-only");
  });

  it("listKeys throws (not supported)", async () => {
    const vault = envVault();
    await expect(vault.listKeys("t1")).rejects.toThrow("does not support");
  });
});
