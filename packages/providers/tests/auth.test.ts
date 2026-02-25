import { describe, it, expect } from "vitest";
import { noAuth } from "../src/auth/no-auth.js";
import { apiKeyAuth } from "../src/auth/api-key.js";
import type { UserIdentity } from "../src/auth/types.js";

describe("noAuth", () => {
  it("always authenticates as local admin", async () => {
    const provider = noAuth();
    const user = await provider.authenticate("anyone");
    expect(user).not.toBeNull();
    expect(user!.userId).toBe("local");
    expect(user!.roles).toContain("admin");
  });

  it("always has valid session", () => {
    const provider = noAuth();
    expect(provider.hasValidSession("anyone")).toBe(true);
  });

  it("clearSession is a no-op", () => {
    const provider = noAuth();
    expect(() => provider.clearSession("anyone")).not.toThrow();
  });

  it("has displayName", () => {
    const provider = noAuth();
    expect(provider.displayName).toBe("No Auth");
  });
});

describe("apiKeyAuth", () => {
  const validUser: UserIdentity = {
    userId: "u1",
    displayName: "Test User",
    roles: ["user"],
    metadata: {},
  };

  const provider = apiKeyAuth({
    validate: async (key) => (key === "valid-key" ? validUser : null),
  });

  it("has displayName", () => {
    expect(provider.displayName).toBe("API Key");
  });

  it("has loginFields", () => {
    expect(provider.loginFields).toBeDefined();
    expect(provider.loginFields!.length).toBe(1);
    expect(provider.loginFields![0].key).toBe("apiKey");
  });

  it("authenticate returns null for unknown user", async () => {
    const result = await provider.authenticate("nobody");
    expect(result).toBeNull();
  });

  it("login succeeds with valid key", async () => {
    const user = await provider.login!("u1", { apiKey: "valid-key" });
    expect(user.userId).toBe("u1");
    expect(user.displayName).toBe("Test User");
  });

  it("authenticate returns identity after login", async () => {
    await provider.login!("u1", { apiKey: "valid-key" });
    const user = await provider.authenticate("u1");
    expect(user).not.toBeNull();
    expect(user!.userId).toBe("u1");
  });

  it("hasValidSession is true after login", async () => {
    await provider.login!("u1", { apiKey: "valid-key" });
    expect(provider.hasValidSession("u1")).toBe(true);
  });

  it("login throws on invalid key", async () => {
    await expect(
      provider.login!("u2", { apiKey: "bad-key" }),
    ).rejects.toThrow("Invalid API key");
  });

  it("login throws on missing key", async () => {
    await expect(provider.login!("u2", {})).rejects.toThrow(
      "API key is required",
    );
  });

  it("clearSession removes the session", async () => {
    await provider.login!("u1", { apiKey: "valid-key" });
    expect(provider.hasValidSession("u1")).toBe(true);
    provider.clearSession("u1");
    expect(provider.hasValidSession("u1")).toBe(false);
  });
});
