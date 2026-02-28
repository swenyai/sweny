import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FsWorkspaceStore } from "../../src/storage/workspace/fs.js";
import { WORKSPACE_LIMITS } from "../../src/storage/workspace/types.js";

describe("FsWorkspaceStore", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweny-ws-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("writeFile creates a file", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const file = await store.writeFile("user-a", "notes.txt", "Hello World");

    expect(file).toBeDefined();
    expect(file.path).toBe("notes.txt");
    expect(file.size).toBe(Buffer.byteLength("Hello World", "utf-8"));
    expect(file.mimeType).toBe("text/plain");
  });

  it("readFile returns the content", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await store.writeFile("user-a", "notes.txt", "Hello World");

    const content = await store.readFile("user-a", "notes.txt");
    expect(content).toBe("Hello World");
  });

  it("readFile throws for non-existent file", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await expect(store.readFile("user-a", "missing.txt")).rejects.toThrow("File not found");
  });

  it("listFiles returns workspace manifest", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await store.writeFile("user-a", "a.txt", "aaa");
    await store.writeFile("user-a", "b.json", '{"key":"val"}');

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.json"]);
    expect(manifest.userId).toBe("user-a");
    expect(manifest.totalBytes).toBeGreaterThan(0);
  });

  it("deleteFile removes a file", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await store.writeFile("user-a", "notes.txt", "Hello");

    const deleted = await store.deleteFile("user-a", "notes.txt");
    expect(deleted).toBe(true);

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(0);
    expect(manifest.totalBytes).toBe(0);
  });

  it("deleteFile returns false for non-existent file", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const deleted = await store.deleteFile("user-a", "missing.txt");
    expect(deleted).toBe(false);
  });

  it("resetWorkspace clears everything", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await store.writeFile("user-a", "a.txt", "aaa");
    await store.writeFile("user-a", "b.txt", "bbb");

    await store.reset("user-a");

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(0);
    expect(manifest.totalBytes).toBe(0);
  });

  it("enforces single-file size limit", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const oversized = "x".repeat(WORKSPACE_LIMITS.maxFileBytes + 1);

    await expect(store.writeFile("user-a", "big.txt", oversized)).rejects.toThrow("File too large");
  });

  it("enforces file count limit", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    // Write up to the limit
    for (let i = 0; i < WORKSPACE_LIMITS.maxFiles; i++) {
      await store.writeFile("user-a", `file-${i}.txt`, "x");
    }

    // One more should fail
    await expect(store.writeFile("user-a", "one-too-many.txt", "x")).rejects.toThrow("Too many files");
  });

  it("enforces total workspace size limit", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    // Fill the workspace with multiple files just under the per-file limit
    const fileSize = WORKSPACE_LIMITS.maxFileBytes - 1; // just under 5MB
    const chunk = "x".repeat(fileSize);
    const filesNeeded = Math.floor(WORKSPACE_LIMITS.maxTotalBytes / fileSize); // 10

    for (let i = 0; i < filesNeeded; i++) {
      await store.writeFile("user-a", `chunk-${i}.txt`, chunk);
    }

    // One more file should push over the total limit
    await expect(store.writeFile("user-a", "overflow.txt", chunk)).rejects.toThrow("Workspace full");
  });

  it("overwriting a file does not double-count size", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await store.writeFile("user-a", "notes.txt", "short");
    await store.writeFile("user-a", "notes.txt", "replaced content");

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.totalBytes).toBe(Buffer.byteLength("replaced content", "utf-8"));
  });

  it("overwriting a file does not increase file count", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await store.writeFile("user-a", "notes.txt", "v1");
    await store.writeFile("user-a", "notes.txt", "v2");

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(1);
  });
});
