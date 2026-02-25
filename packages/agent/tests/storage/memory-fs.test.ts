import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FsMemoryStore } from "../../src/storage/memory/fs.js";

describe("FsMemoryStore", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweny-mem-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("addMemory creates a new memory", async () => {
    const store = new FsMemoryStore(makeTempDir());
    const entry = await store.addEntry("user-a", "Remember this fact");

    expect(entry).toBeDefined();
    expect(entry.id).toBeTruthy();
    expect(entry.text).toBe("Remember this fact");
    expect(entry.createdAt).toBeTruthy();
  });

  it("listMemories returns all memories for a user", async () => {
    const store = new FsMemoryStore(makeTempDir());
    await store.addEntry("user-a", "Fact 1");
    await store.addEntry("user-a", "Fact 2");
    await store.addEntry("user-a", "Fact 3");

    const memory = await store.getMemories("user-a");
    expect(memory.entries).toHaveLength(3);
    expect(memory.entries.map((e) => e.text)).toEqual(["Fact 1", "Fact 2", "Fact 3"]);
  });

  it("removeMemory deletes a specific memory", async () => {
    const store = new FsMemoryStore(makeTempDir());
    const entry1 = await store.addEntry("user-a", "Keep this");
    const entry2 = await store.addEntry("user-a", "Remove this");

    const removed = await store.removeEntry("user-a", entry2.id);
    expect(removed).toBe(true);

    const memory = await store.getMemories("user-a");
    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0]!.id).toBe(entry1.id);
  });

  it("removeMemory returns false for non-existent entry", async () => {
    const store = new FsMemoryStore(makeTempDir());
    const removed = await store.removeEntry("user-a", "non-existent-id");
    expect(removed).toBe(false);
  });

  it("clearMemories removes all memories for user", async () => {
    const store = new FsMemoryStore(makeTempDir());
    await store.addEntry("user-a", "Fact 1");
    await store.addEntry("user-a", "Fact 2");

    await store.clearMemories("user-a");

    const memory = await store.getMemories("user-a");
    expect(memory.entries).toHaveLength(0);
  });

  it("different users have independent memories", async () => {
    const store = new FsMemoryStore(makeTempDir());
    await store.addEntry("alice", "Alice's memory");
    await store.addEntry("bob", "Bob's memory");

    const aliceMemory = await store.getMemories("alice");
    const bobMemory = await store.getMemories("bob");

    expect(aliceMemory.entries).toHaveLength(1);
    expect(aliceMemory.entries[0]!.text).toBe("Alice's memory");

    expect(bobMemory.entries).toHaveLength(1);
    expect(bobMemory.entries[0]!.text).toBe("Bob's memory");
  });

  it("memories persist across store instances", async () => {
    const dir = makeTempDir();

    const store1 = new FsMemoryStore(dir);
    await store1.addEntry("user-a", "Persisted fact");

    // Create a new store instance pointing to the same directory
    const store2 = new FsMemoryStore(dir);
    const memory = await store2.getMemories("user-a");

    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0]!.text).toBe("Persisted fact");
  });

  it("getMemories returns empty for unknown user", async () => {
    const store = new FsMemoryStore(makeTempDir());
    const memory = await store.getMemories("nobody");
    expect(memory.entries).toHaveLength(0);
  });
});
