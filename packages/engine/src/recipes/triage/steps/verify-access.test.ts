import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProviderRegistry } from "../../../runner-recipe.js";
import { verifyAccess } from "./verify-access.js";
import { createCtx, silentLogger } from "../test-helpers.js";

describe("verifyAccess", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds when both providers verify", async () => {
    const registry = createProviderRegistry();
    registry.set("observability", { verifyAccess: vi.fn().mockResolvedValue(undefined) });
    registry.set("issueTracker", { verifyAccess: vi.fn().mockResolvedValue(undefined) });
    const ctx = createCtx({ providers: registry });

    const result = await verifyAccess(ctx);

    expect(result.status).toBe("success");
    expect(silentLogger.info).toHaveBeenCalledWith("Observability provider access verified");
    expect(silentLogger.info).toHaveBeenCalledWith("Issue tracker access verified");
  });

  it("throws when observability provider fails", async () => {
    const registry = createProviderRegistry();
    registry.set("observability", { verifyAccess: vi.fn().mockRejectedValue(new Error("bad API key")) });
    registry.set("issueTracker", { verifyAccess: vi.fn().mockResolvedValue(undefined) });
    const ctx = createCtx({ providers: registry });

    await expect(verifyAccess(ctx)).rejects.toThrow("bad API key");
  });

  it("throws when issue tracker fails", async () => {
    const registry = createProviderRegistry();
    registry.set("observability", { verifyAccess: vi.fn().mockResolvedValue(undefined) });
    registry.set("issueTracker", { verifyAccess: vi.fn().mockRejectedValue(new Error("unauthorized")) });
    const ctx = createCtx({ providers: registry });

    await expect(verifyAccess(ctx)).rejects.toThrow("unauthorized");
  });
});
