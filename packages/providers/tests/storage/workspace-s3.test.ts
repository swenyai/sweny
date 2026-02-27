import { describe, it, expect, vi, beforeEach } from "vitest";
import { WORKSPACE_LIMITS } from "../../src/storage/types.js";

// ---------------------------------------------------------------------------
// Mock AWS SDK modules before importing the store
// ---------------------------------------------------------------------------

// In-memory S3 storage keyed by "bucket/key"
let s3Objects: Map<string, string>;

vi.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    input: { Bucket: string; Key: string };
    constructor(input: { Bucket: string; Key: string }) {
      this.input = input;
    }
  }
  class PutObjectCommand {
    input: { Bucket: string; Key: string; Body: string; ContentType?: string };
    constructor(input: { Bucket: string; Key: string; Body: string; ContentType?: string }) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: { Bucket: string; Key: string };
    constructor(input: { Bucket: string; Key: string }) {
      this.input = input;
    }
  }
  class S3Client {
    async send(cmd: GetObjectCommand | PutObjectCommand | DeleteObjectCommand): Promise<unknown> {
      if (cmd instanceof PutObjectCommand) {
        s3Objects.set(`${cmd.input.Bucket}/${cmd.input.Key}`, cmd.input.Body);
        return {};
      }
      if (cmd instanceof DeleteObjectCommand) {
        s3Objects.delete(`${cmd.input.Bucket}/${cmd.input.Key}`);
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        const data = s3Objects.get(`${cmd.input.Bucket}/${cmd.input.Key}`);
        if (data === undefined) {
          const err = new Error("NoSuchKey");
          (err as unknown as { name: string }).name = "NoSuchKey";
          throw err;
        }
        return {
          Body: {
            transformToString: async () => data,
          },
        };
      }
      return {};
    }
  }

  return { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => {
  return {
    getSignedUrl: vi.fn(async (_client: unknown, cmd: { input: { Bucket: string; Key: string } }) => {
      return `https://${cmd.input.Bucket}.s3.amazonaws.com/${cmd.input.Key}?signed=true`;
    }),
  };
});

// Import AFTER mocks are registered
const { S3WorkspaceStore } = await import("../../src/storage/workspace/s3.js");

describe("S3WorkspaceStore", () => {
  beforeEach(() => {
    s3Objects = new Map();
  });

  // -----------------------------------------------------------------------
  // getManifest
  // -----------------------------------------------------------------------

  it("getManifest returns empty manifest for missing key", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");
    const manifest = await store.getManifest("user-a");

    expect(manifest.userId).toBe("user-a");
    expect(manifest.totalBytes).toBe(0);
    expect(manifest.files).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // writeFile
  // -----------------------------------------------------------------------

  it("writeFile puts blob and updates manifest", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");
    const file = await store.writeFile("user-a", "notes.txt", "hello world");

    expect(file.path).toBe("notes.txt");
    expect(file.size).toBe(Buffer.byteLength("hello world", "utf-8"));
    expect(file.mimeType).toBe("text/plain");
    expect(file.blobId).toBeTruthy();

    // Verify manifest was persisted to S3
    const manifestKey = "test-bucket/pfx/users/user-a/workspace/manifest.json";
    expect(s3Objects.has(manifestKey)).toBe(true);
    const manifest = JSON.parse(s3Objects.get(manifestKey)!);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.totalBytes).toBe(file.size);

    // Verify blob was persisted
    const blobKey = `test-bucket/pfx/users/user-a/workspace/blobs/${file.blobId}`;
    expect(s3Objects.get(blobKey)).toBe("hello world");
  });

  it("writeFile guesses mime type from extension", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    const json = await store.writeFile("user-a", "config.json", '{"a":1}');
    expect(json.mimeType).toBe("application/json");

    const md = await store.writeFile("user-a", "readme.md", "# hi");
    expect(md.mimeType).toBe("text/markdown");
  });

  it("writeFile with description stores it in manifest", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");
    const file = await store.writeFile("user-a", "data.csv", "a,b", "raw data");

    expect(file.description).toBe("raw data");
    expect(file.mimeType).toBe("text/csv");
  });

  it("writeFile overwrites existing file at same path", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    const file1 = await store.writeFile("user-a", "notes.txt", "v1");
    const file2 = await store.writeFile("user-a", "notes.txt", "v2 longer");

    expect(file2.blobId).not.toBe(file1.blobId);

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.totalBytes).toBe(Buffer.byteLength("v2 longer", "utf-8"));

    // Old blob removed
    const oldBlobKey = `test-bucket/pfx/users/user-a/workspace/blobs/${file1.blobId}`;
    expect(s3Objects.has(oldBlobKey)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // readFile
  // -----------------------------------------------------------------------

  it("readFile returns file content from S3", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");
    await store.writeFile("user-a", "notes.txt", "hello world");

    const content = await store.readFile("user-a", "notes.txt");
    expect(content).toBe("hello world");
  });

  it("readFile throws for missing file", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    await expect(store.readFile("user-a", "missing.txt")).rejects.toThrow(
      "File not found in workspace",
    );
  });

  // -----------------------------------------------------------------------
  // listFiles (via manifest)
  // -----------------------------------------------------------------------

  it("getManifest lists all files after writes", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    await store.writeFile("user-a", "a.txt", "aaa");
    await store.writeFile("user-a", "b.json", '{"b":true}');

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.json"]);
  });

  // -----------------------------------------------------------------------
  // deleteFile
  // -----------------------------------------------------------------------

  it("deleteFile removes blob and updates manifest", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    const file = await store.writeFile("user-a", "notes.txt", "hello");

    const deleted = await store.deleteFile("user-a", "notes.txt");
    expect(deleted).toBe(true);

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(0);
    expect(manifest.totalBytes).toBe(0);

    // Blob removed from S3
    const blobKey = `test-bucket/pfx/users/user-a/workspace/blobs/${file.blobId}`;
    expect(s3Objects.has(blobKey)).toBe(false);
  });

  it("deleteFile returns false for non-existent file", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");
    const result = await store.deleteFile("user-a", "nope.txt");
    expect(result).toBe(false);
  });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------

  it("reset clears all files and resets manifest", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    const f1 = await store.writeFile("user-a", "a.txt", "aaa");
    const f2 = await store.writeFile("user-a", "b.txt", "bbb");

    await store.reset("user-a");

    const manifest = await store.getManifest("user-a");
    expect(manifest.files).toHaveLength(0);
    expect(manifest.totalBytes).toBe(0);

    // Blobs removed
    expect(s3Objects.has(`test-bucket/pfx/users/user-a/workspace/blobs/${f1.blobId}`)).toBe(false);
    expect(s3Objects.has(`test-bucket/pfx/users/user-a/workspace/blobs/${f2.blobId}`)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // getDownloadUrl
  // -----------------------------------------------------------------------

  it("getDownloadUrl returns presigned URL", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    await store.writeFile("user-a", "notes.txt", "hello");

    const url = await store.getDownloadUrl("user-a", "notes.txt");
    expect(url).toContain("test-bucket");
    expect(url).toContain("signed=true");
  });

  it("getDownloadUrl throws for missing file", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    await expect(store.getDownloadUrl("user-a", "missing.txt")).rejects.toThrow(
      "File not found in workspace",
    );
  });

  // -----------------------------------------------------------------------
  // Prefix handling
  // -----------------------------------------------------------------------

  it("works without prefix", async () => {
    const store = new S3WorkspaceStore("test-bucket", "");

    const file = await store.writeFile("user-a", "notes.txt", "content");

    // Key should not have a prefix
    const blobKey = `test-bucket/users/user-a/workspace/blobs/${file.blobId}`;
    expect(s3Objects.has(blobKey)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Quota enforcement: maxFileBytes
  // -----------------------------------------------------------------------

  it("rejects file exceeding maxFileBytes", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");
    const oversized = "x".repeat(WORKSPACE_LIMITS.maxFileBytes + 1);

    await expect(
      store.writeFile("user-a", "huge.txt", oversized),
    ).rejects.toThrow(/File too large/);
  });

  it("accepts file exactly at maxFileBytes", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");
    const content = "x".repeat(WORKSPACE_LIMITS.maxFileBytes);

    const file = await store.writeFile("user-a", "max.txt", content);
    expect(file.size).toBe(WORKSPACE_LIMITS.maxFileBytes);
  });

  // -----------------------------------------------------------------------
  // Quota enforcement: maxTotalBytes
  // -----------------------------------------------------------------------

  it("rejects write when total would exceed maxTotalBytes", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    // Write a small file, then inflate totalBytes in the cached manifest
    await store.writeFile("user-a", "seed.txt", "seed");
    const manifest = await store.getManifest("user-a");
    manifest.totalBytes = WORKSPACE_LIMITS.maxTotalBytes - 5;

    // Writing 6 more bytes pushes past the limit
    await expect(
      store.writeFile("user-a", "extra.txt", "abcdef"),
    ).rejects.toThrow(/Workspace full/);
  });

  it("allows overwrite that stays within maxTotalBytes", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

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
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    // Write one real file, then inflate the manifest in the cache
    await store.writeFile("user-a", "seed.txt", "seed");

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
    manifest.totalBytes = WORKSPACE_LIMITS.maxFiles;

    await expect(
      store.writeFile("user-a", "one-too-many.txt", "boom"),
    ).rejects.toThrow(/Too many files/);
  });

  it("allows overwrite when at maxFiles (no new file slot needed)", async () => {
    const store = new S3WorkspaceStore("test-bucket", "pfx");

    await store.writeFile("user-a", "seed.txt", "seed");

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

    const file = await store.writeFile("user-a", "seed.txt", "updated seed");
    expect(file.path).toBe("seed.txt");
  });
});
