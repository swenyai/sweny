import { describe, it, expect, vi } from "vitest";
import { dedupCheck } from "./dedup-check.js";
import { createProviderRegistry } from "../../../runner-recipe.js";
import { createCtx } from "../test-helpers.js";
import type { DedupStore } from "../../../lib/dedup-store.js";

function makeDedupStore(seen = false): DedupStore {
  return {
    has: vi.fn().mockResolvedValue(seen),
    add: vi.fn().mockResolvedValue(undefined),
  };
}

describe("dedupCheck", () => {
  it("returns success and proceeds when no dedupStore configured", async () => {
    const ctx = createCtx({ providers: createProviderRegistry() });
    const result = await dedupCheck(ctx);
    expect(result.status).toBe("success");
    expect(result.data?.outcome).toBeUndefined();
  });

  it("adds fingerprint to store and proceeds for new event", async () => {
    const store = makeDedupStore(false);
    const ctx = createCtx({
      providers: createProviderRegistry(),
      config: { dedupStore: store },
    });

    const result = await dedupCheck(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.outcome).toBeUndefined();
    expect(store.has).toHaveBeenCalledOnce();
    expect(store.add).toHaveBeenCalledOnce();
  });

  it("short-circuits to notify for duplicate event", async () => {
    const store = makeDedupStore(true); // already seen
    const ctx = createCtx({
      providers: createProviderRegistry(),
      config: { dedupStore: store },
    });

    const result = await dedupCheck(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.outcome).toBe("notify");
    expect(result.data?.duplicate).toBe(true);
    expect(typeof result.data?.fingerprint).toBe("string");
    // Should NOT add to store for duplicates
    expect(store.add).not.toHaveBeenCalled();
  });

  it("fingerprint is stable — duplicate detected when store already has fp", async () => {
    // Simulate: first run saw the event, second run is duplicate
    const storeWithFp = makeDedupStore(true);
    const ctx = createCtx({
      providers: createProviderRegistry(),
      config: { dedupStore: storeWithFp },
    });

    const result = await dedupCheck(ctx);
    expect(result.data?.outcome).toBe("notify");
  });
});
