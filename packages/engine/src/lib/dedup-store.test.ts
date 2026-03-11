import { describe, it, expect, vi, afterEach } from "vitest";
import { inMemoryDedupStore } from "./dedup-store.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("inMemoryDedupStore", () => {
  it("has() returns false for an unknown fingerprint", async () => {
    const store = inMemoryDedupStore();
    expect(await store.has("abc")).toBe(false);
  });

  it("has() returns true after add()", async () => {
    const store = inMemoryDedupStore();
    await store.add("abc");
    expect(await store.has("abc")).toBe(true);
  });

  it("has() returns false for a different fingerprint", async () => {
    const store = inMemoryDedupStore();
    await store.add("abc");
    expect(await store.has("xyz")).toBe(false);
  });

  it("has() returns false after TTL expires", async () => {
    vi.useFakeTimers();
    const store = inMemoryDedupStore();

    await store.add("abc", 1000); // 1 second TTL
    expect(await store.has("abc")).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(await store.has("abc")).toBe(false);
  });

  it("each store instance is independent", async () => {
    const store1 = inMemoryDedupStore();
    const store2 = inMemoryDedupStore();
    await store1.add("abc");
    expect(await store2.has("abc")).toBe(false);
  });

  it("add() can be called multiple times without error", async () => {
    const store = inMemoryDedupStore();
    await store.add("abc");
    await store.add("abc"); // re-adding resets TTL
    expect(await store.has("abc")).toBe(true);
  });
});
