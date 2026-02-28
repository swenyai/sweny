import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FsMemoryStore } from "../../src/storage/memory/fs.js";

describe("FsMemoryStore", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweny-memory-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("getMemories returns empty UserMemory for new user", async () => {
    const store = new FsMemoryStore(makeTempDir());
    const result = await store.getMemories("user-new");

    expect(result).toEqual({ entries: [] });
  });

  it("addEntry appends a memory entry", async () => {
    const store = new FsMemoryStore(makeTempDir());
    const entry = await store.addEntry("user-a", "Remember my timezone is PST");

    expect(entry.id).toEqual(expect.any(String));
    expect(entry.text).toBe("Remember my timezone is PST");
    expect(entry.createdAt).toEqual(expect.any(String));

    const memory = await store.getMemories("user-a");
    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0]!.text).toBe("Remember my timezone is PST");
  });

  it("addEntry multiple entries accumulate", async () => {
    const store = new FsMemoryStore(makeTempDir());

    await store.addEntry("user-a", "First note");
    await store.addEntry("user-a", "Second note");
    await store.addEntry("user-a", "Third note");

    const memory = await store.getMemories("user-a");
    expect(memory.entries).toHaveLength(3);
    expect(memory.entries.map((e) => e.text)).toEqual(["First note", "Second note", "Third note"]);
  });

  it("removeEntry filters by entry id", async () => {
    const store = new FsMemoryStore(makeTempDir());

    const e1 = await store.addEntry("user-a", "Keep this");
    const e2 = await store.addEntry("user-a", "Remove this");

    const removed = await store.removeEntry("user-a", e2.id);
    expect(removed).toBe(true);

    const memory = await store.getMemories("user-a");
    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0]!.id).toBe(e1.id);
    expect(memory.entries[0]!.text).toBe("Keep this");
  });

  it("removeEntry returns false for non-existent id", async () => {
    const store = new FsMemoryStore(makeTempDir());
    await store.addEntry("user-a", "Some note");

    const removed = await store.removeEntry("user-a", "nonexistent-id");
    expect(removed).toBe(false);
  });

  it("clearMemories removes all entries for user", async () => {
    const store = new FsMemoryStore(makeTempDir());

    await store.addEntry("user-a", "Note 1");
    await store.addEntry("user-a", "Note 2");

    await store.clearMemories("user-a");

    const memory = await store.getMemories("user-a");
    expect(memory.entries).toEqual([]);
  });

  it("getMemories reads from cache on second call", async () => {
    const dir = makeTempDir();
    const store = new FsMemoryStore(dir);

    await store.addEntry("user-a", "Cached note");

    // First call populates cache (already cached via addEntry)
    const mem1 = await store.getMemories("user-a");
    expect(mem1.entries).toHaveLength(1);

    // Tamper with the file on disk to verify we get cached data
    const filePath = join(dir, "users", "user-a", "memory.json");
    const onDisk = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(onDisk.entries).toHaveLength(1); // sanity check

    // Second call should return from cache (same reference)
    const mem2 = await store.getMemories("user-a");
    expect(mem2).toBe(mem1); // same object reference = cache hit
  });

  it("memories persist across store instances", async () => {
    const dir = makeTempDir();
    const store1 = new FsMemoryStore(dir);

    await store1.addEntry("user-a", "Persistent note");

    const store2 = new FsMemoryStore(dir);
    const memory = await store2.getMemories("user-a");

    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0]!.text).toBe("Persistent note");
  });

  it("different users have separate memories", async () => {
    const store = new FsMemoryStore(makeTempDir());

    await store.addEntry("user-a", "A's note");
    await store.addEntry("user-b", "B's note");

    const memA = await store.getMemories("user-a");
    const memB = await store.getMemories("user-b");

    expect(memA.entries).toHaveLength(1);
    expect(memA.entries[0]!.text).toBe("A's note");
    expect(memB.entries).toHaveLength(1);
    expect(memB.entries[0]!.text).toBe("B's note");
  });
});
