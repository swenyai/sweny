import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FsWorkspaceStore } from "../../src/storage/workspace/fs.js";
import { WORKSPACE_LIMITS } from "../../src/storage/types.js";

describe("FsWorkspaceStore", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweny-workspace-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  // -----------------------------------------------------------------------
  // getManifest
  // -----------------------------------------------------------------------

  it("getManifest returns empty manifest for new user", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const manifest = await store.getManifest("user-a");

    expect(manifest.userId).toBe("user-a");
    expect(manifest.totalBytes).toBe(0);
    expect(manifest.files).toEqual([]);
    expect(manifest.createdAt).toBeTruthy();
    expect(manifest.updatedAt).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // writeFile
  // -----------------------------------------------------------------------

  it("writeFile creates blob and updates manifest", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const file = await store.writeFile("user-a", "notes.txt", "hello world");

    expect(file.path).toBe("notes.txt");
    expect(file.size).toBe(Buffer.byteLength("hello world", "utf-8"));
    expect(file.mimeType).toBe("text/plain");
    expect(file.blobId).toBeTruthy();
    expect(file.createdAt).toBeTruthy();

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.totalBytes).toBe(file.size);
  });

  it("writeFile with metadata sets mimeType and description", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const file = await store.writeFile("user-a", "data.json", '{"key":"value"}', "sample config");

    expect(file.mimeType).toBe("application/json");
    expect(file.description).toBe("sample config");
  });

  it("writeFile guesses mime type from extension", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    const md = await store.writeFile("user-a", "readme.md", "# Hello");
    expect(md.mimeType).toBe("text/markdown");

    const csv = await store.writeFile("user-a", "data.csv", "a,b,c");
    expect(csv.mimeType).toBe("text/csv");

    const ts = await store.writeFile("user-a", "index.ts", "const x = 1;");
    expect(ts.mimeType).toBe("text/typescript");
  });

  it("writeFile overwrites existing file at same path", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    const file1 = await store.writeFile("user-a", "notes.txt", "version 1");
    const file2 = await store.writeFile("user-a", "notes.txt", "version 2 longer");

    expect(file2.blobId).not.toBe(file1.blobId);

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.totalBytes).toBe(Buffer.byteLength("version 2 longer", "utf-8"));

    const content = await store.readFile("user-a", "notes.txt");
    expect(content).toBe("version 2 longer");
  });

  // -----------------------------------------------------------------------
  // listFiles (via manifest)
  // -----------------------------------------------------------------------

  it("getManifest lists all files after multiple writes", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    await store.writeFile("user-a", "a.txt", "aaa");
    await store.writeFile("user-a", "b.txt", "bbb");
    await store.writeFile("user-a", "c.json", '{"c":true}');

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(3);
    expect(manifest.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt", "c.json"]);
  });

  // -----------------------------------------------------------------------
  // readFile
  // -----------------------------------------------------------------------

  it("readFile returns file content", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    await store.writeFile("user-a", "notes.txt", "hello world");

    const content = await store.readFile("user-a", "notes.txt");
    expect(content).toBe("hello world");
  });

  it("readFile throws for missing file", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    await expect(store.readFile("user-a", "missing.txt")).rejects.toThrow("File not found in workspace");
  });

  // -----------------------------------------------------------------------
  // deleteFile
  // -----------------------------------------------------------------------

  it("deleteFile removes blob and updates manifest", async () => {
    const dir = makeTempDir();
    const store = new FsWorkspaceStore(dir);

    const file = await store.writeFile("user-a", "notes.txt", "hello world");

    const deleted = await store.deleteFile("user-a", "notes.txt");
    expect(deleted).toBe(true);

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(0);
    expect(manifest.totalBytes).toBe(0);

    // Blob file should be gone
    const blobPath = join(dir, "users", "user-a", "workspace", "blobs", file.blobId);
    expect(existsSync(blobPath)).toBe(false);
  });

  it("deleteFile returns false for non-existent file", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const result = await store.deleteFile("user-a", "nope.txt");
    expect(result).toBe(false);
  });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------

  it("reset clears all files and resets manifest", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    await store.writeFile("user-a", "a.txt", "aaa");
    await store.writeFile("user-a", "b.txt", "bbb");
    await store.reset("user-a");

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(0);
    expect(manifest.totalBytes).toBe(0);
  });

  // -----------------------------------------------------------------------
  // getDownloadUrl
  // -----------------------------------------------------------------------

  it("getDownloadUrl returns file:// URL for existing file", async () => {
    const dir = makeTempDir();
    const store = new FsWorkspaceStore(dir);

    const file = await store.writeFile("user-a", "notes.txt", "hello");
    const url = await store.getDownloadUrl("user-a", "notes.txt");

    expect(url).toMatch(/^file:\/\//);
    expect(url).toContain(file.blobId);
  });

  it("getDownloadUrl throws for missing file", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    await expect(store.getDownloadUrl("user-a", "missing.txt")).rejects.toThrow("File not found in workspace");
  });

  // -----------------------------------------------------------------------
  // Persistence across instances
  // -----------------------------------------------------------------------

  it("data persists across store instances", async () => {
    const dir = makeTempDir();
    const store1 = new FsWorkspaceStore(dir);

    await store1.writeFile("user-a", "notes.txt", "persisted content");

    const store2 = new FsWorkspaceStore(dir);
    const content = await store2.readFile("user-a", "notes.txt");
    expect(content).toBe("persisted content");
  });

  // -----------------------------------------------------------------------
  // Quota enforcement: maxFileBytes
  // -----------------------------------------------------------------------

  it("rejects file exceeding maxFileBytes", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const oversized = "x".repeat(WORKSPACE_LIMITS.maxFileBytes + 1);

    await expect(store.writeFile("user-a", "huge.txt", oversized)).rejects.toThrow(/File too large/);
  });

  it("accepts file exactly at maxFileBytes", async () => {
    const store = new FsWorkspaceStore(makeTempDir());
    const content = "x".repeat(WORKSPACE_LIMITS.maxFileBytes);

    const file = await store.writeFile("user-a", "max.txt", content);
    expect(file.size).toBe(WORKSPACE_LIMITS.maxFileBytes);
  });

  // -----------------------------------------------------------------------
  // Quota enforcement: maxTotalBytes
  // -----------------------------------------------------------------------

  it("rejects write when total would exceed maxTotalBytes", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    // Write a small file, then inflate totalBytes in the cached manifest
    await store.writeFile("user-a", "seed.txt", "seed");
    const manifest = await store.getManifest("user-a");
    manifest.totalBytes = WORKSPACE_LIMITS.maxTotalBytes - 5;

    // Writing 6 more bytes pushes past the limit
    await expect(store.writeFile("user-a", "extra.txt", "abcdef")).rejects.toThrow(/Workspace full/);
  });

  it("allows overwrite that stays within maxTotalBytes", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    // Write a file, then inflate totalBytes close to the limit
    await store.writeFile("user-a", "big.txt", "original");
    const originalSize = Buffer.byteLength("original", "utf-8");
    const manifest = await store.getManifest("user-a");
    manifest.totalBytes = WORKSPACE_LIMITS.maxTotalBytes - originalSize;

    // Overwriting the same file reclaims old size, so the total stays under the limit
    const file = await store.writeFile("user-a", "big.txt", "replaced");
    expect(file.path).toBe("big.txt");
  });

  // -----------------------------------------------------------------------
  // Quota enforcement: maxFiles
  // -----------------------------------------------------------------------

  it("rejects write when file count would exceed maxFiles", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    // Manually seed the manifest with maxFiles entries so we don't
    // actually create 500 real files (that would be slow).
    // We write one real file, then manipulate the manifest.
    await store.writeFile("user-a", "seed.txt", "seed");

    // Retrieve the manifest and inflate the file count
    const manifest = await store.getManifest("user-a");
    for (let i = 1; i < WORKSPACE_LIMITS.maxFiles; i++) {
      manifest.files.push({
        path: `fake-${i}.txt`,
        blobId: `blob-${i}`,
        size: 1,
        mimeType: "text/plain",
        createdAt: new Date().toISOString(),
      });
    }
    manifest.totalBytes = WORKSPACE_LIMITS.maxFiles; // small total

    // The cache already holds this mutated manifest, so the next write sees 500 files
    await expect(store.writeFile("user-a", "one-too-many.txt", "boom")).rejects.toThrow(/Too many files/);
  });

  it("allows overwrite when at maxFiles (no new file added)", async () => {
    const store = new FsWorkspaceStore(makeTempDir());

    // Write an initial file
    await store.writeFile("user-a", "seed.txt", "seed");

    // Inflate the manifest to maxFiles entries (including seed.txt)
    const manifest = await store.getManifest("user-a");
    for (let i = manifest.files.length; i < WORKSPACE_LIMITS.maxFiles; i++) {
      manifest.files.push({
        path: `fake-${i}.txt`,
        blobId: `blob-${i}`,
        size: 1,
        mimeType: "text/plain",
        createdAt: new Date().toISOString(),
      });
    }
    manifest.totalBytes = WORKSPACE_LIMITS.maxFiles;

    // Overwriting existing seed.txt should succeed (no new file slot needed)
    const file = await store.writeFile("user-a", "seed.txt", "updated seed");
    expect(file.path).toBe("seed.txt");
  });
});
