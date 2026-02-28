import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mockSend;
  },
  GetSecretValueCommand: class {
    constructor(public input: any) {}
  },
  CreateSecretCommand: class {
    constructor(public input: any) {}
  },
  PutSecretValueCommand: class {
    constructor(public input: any) {}
  },
  DeleteSecretCommand: class {
    constructor(public input: any) {}
  },
  ListSecretsCommand: class {
    constructor(public input: any) {}
  },
}));

import { awsSecretsManager } from "../src/credential-vault/aws-secrets-manager.js";

describe("awsSecretsManager", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("returns a CredentialVaultProvider with all 4 methods", () => {
    const vault = awsSecretsManager();
    expect(typeof vault.getSecret).toBe("function");
    expect(typeof vault.setSecret).toBe("function");
    expect(typeof vault.deleteSecret).toBe("function");
    expect(typeof vault.listKeys).toBe("function");
  });

  describe("getSecret", () => {
    it("returns SecretString from GetSecretValueCommand", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: "my-secret-value" });

      const vault = awsSecretsManager();
      const value = await vault.getSecret("tenant1", "API_KEY");

      expect(value).toBe("my-secret-value");
      expect(mockSend).toHaveBeenCalledOnce();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input).toEqual({ SecretId: "sweny/tenant1/API_KEY" });
    });

    it("returns null when ResourceNotFoundException", async () => {
      const err = new Error("not found");
      err.name = "ResourceNotFoundException";
      mockSend.mockRejectedValueOnce(err);

      const vault = awsSecretsManager();
      const value = await vault.getSecret("tenant1", "MISSING_KEY");

      expect(value).toBeNull();
    });

    it("uses correct secret name format: {prefix}/{tenantId}/{key}", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: "val" });

      const vault = awsSecretsManager({ prefix: "myapp" });
      await vault.getSecret("org-42", "DB_PASSWORD");

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input).toEqual({ SecretId: "myapp/org-42/DB_PASSWORD" });
    });
  });

  describe("setSecret", () => {
    it("calls CreateSecretCommand first", async () => {
      mockSend.mockResolvedValueOnce({});

      const vault = awsSecretsManager();
      await vault.setSecret("tenant1", "API_KEY", "new-value");

      expect(mockSend).toHaveBeenCalledOnce();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input).toEqual({
        Name: "sweny/tenant1/API_KEY",
        SecretString: "new-value",
      });
    });

    it("falls back to PutSecretValueCommand on ResourceExistsException", async () => {
      const err = new Error("already exists");
      err.name = "ResourceExistsException";
      mockSend.mockRejectedValueOnce(err);
      mockSend.mockResolvedValueOnce({});

      const vault = awsSecretsManager();
      await vault.setSecret("tenant1", "API_KEY", "updated-value");

      expect(mockSend).toHaveBeenCalledTimes(2);
      const putCmd = mockSend.mock.calls[1][0];
      expect(putCmd.input).toEqual({
        SecretId: "sweny/tenant1/API_KEY",
        SecretString: "updated-value",
      });
    });
  });

  describe("deleteSecret", () => {
    it("calls DeleteSecretCommand with ForceDeleteWithoutRecovery", async () => {
      mockSend.mockResolvedValueOnce({});

      const vault = awsSecretsManager();
      await vault.deleteSecret("tenant1", "API_KEY");

      expect(mockSend).toHaveBeenCalledOnce();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input).toEqual({
        SecretId: "sweny/tenant1/API_KEY",
        ForceDeleteWithoutRecovery: true,
      });
    });
  });

  describe("listKeys", () => {
    it("returns key names extracted from secret names", async () => {
      mockSend.mockResolvedValueOnce({
        SecretList: [{ Name: "sweny/tenant1/API_KEY" }, { Name: "sweny/tenant1/DB_PASSWORD" }],
        NextToken: undefined,
      });

      const vault = awsSecretsManager();
      const keys = await vault.listKeys("tenant1");

      expect(keys).toEqual(["API_KEY", "DB_PASSWORD"]);
    });

    it("handles pagination (NextToken)", async () => {
      mockSend.mockResolvedValueOnce({
        SecretList: [{ Name: "sweny/tenant1/KEY_A" }],
        NextToken: "page2-token",
      });
      mockSend.mockResolvedValueOnce({
        SecretList: [{ Name: "sweny/tenant1/KEY_B" }],
        NextToken: undefined,
      });

      const vault = awsSecretsManager();
      const keys = await vault.listKeys("tenant1");

      expect(keys).toEqual(["KEY_A", "KEY_B"]);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("config defaults", () => {
    it("uses region=us-east-1 and prefix=sweny by default", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: "val" });

      const vault = awsSecretsManager();
      await vault.getSecret("t1", "k1");

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input).toEqual({ SecretId: "sweny/t1/k1" });
    });

    it("custom prefix changes secret name format", async () => {
      mockSend.mockResolvedValueOnce({ SecretString: "val" });

      const vault = awsSecretsManager({ prefix: "custom" });
      await vault.getSecret("t1", "k1");

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input).toEqual({ SecretId: "custom/t1/k1" });
    });
  });
});
