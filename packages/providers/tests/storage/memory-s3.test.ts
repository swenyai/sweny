import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @aws-sdk/client-s3 before importing the module under test
const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: class {
      send = mockSend;
    },
    GetObjectCommand: class {
      input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    },
    PutObjectCommand: class {
      input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    },
  };
});

import { S3MemoryStore } from "../../src/storage/memory/s3.js";

describe("S3MemoryStore", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  function makeStore(): S3MemoryStore {
    // Each call constructs a new store with a fresh cache
    return new S3MemoryStore("test-bucket", "data", "us-east-1");
  }

  function noSuchKeyError(): Error {
    const err = new Error("NoSuchKey");
    err.name = "NoSuchKey";
    return err;
  }

  function s3Body(data: unknown): { Body: { transformToString: () => Promise<string> } } {
    return {
      Body: {
        transformToString: async () => JSON.stringify(data),
      },
    };
  }

  it("getMemories returns empty for missing key (NoSuchKey)", async () => {
    mockSend.mockRejectedValueOnce(noSuchKeyError());

    const store = makeStore();
    const memory = await store.getMemories("user-new");

    expect(memory).toEqual({ entries: [] });
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Verify GetObjectCommand was used with correct bucket/key
    const cmd = mockSend.mock.calls[0]![0]!;
    expect(cmd.input).toEqual({
      Bucket: "test-bucket",
      Key: "data/users/user-new/memory.json",
    });
  });

  it("addEntry creates new memory file", async () => {
    // First call: getMemories triggers GetObjectCommand -> NoSuchKey
    mockSend.mockRejectedValueOnce(noSuchKeyError());
    // Second call: save triggers PutObjectCommand -> success
    mockSend.mockResolvedValueOnce({});

    const store = makeStore();
    const entry = await store.addEntry("user-a", "My first note");

    expect(entry.id).toEqual(expect.any(String));
    expect(entry.text).toBe("My first note");
    expect(entry.createdAt).toEqual(expect.any(String));

    // Verify PutObjectCommand was called
    expect(mockSend).toHaveBeenCalledTimes(2);
    const putCmd = mockSend.mock.calls[1]![0]!;
    expect(putCmd.input.Bucket).toBe("test-bucket");
    expect(putCmd.input.Key).toBe("data/users/user-a/memory.json");
    expect(putCmd.input.ContentType).toBe("application/json");
    expect(putCmd.input.ServerSideEncryption).toBe("AES256");

    const body = JSON.parse(putCmd.input.Body as string);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].text).toBe("My first note");
  });

  it("addEntry appends to existing", async () => {
    const existing = {
      entries: [{ id: "abc123", text: "Existing note", createdAt: "2024-01-01T00:00:00.000Z" }],
    };

    // First addEntry: getMemories -> returns existing data
    mockSend.mockResolvedValueOnce(s3Body(existing));
    // First addEntry: save -> PutObjectCommand
    mockSend.mockResolvedValueOnce({});

    const store = makeStore();
    const entry = await store.addEntry("user-a", "Second note");

    expect(entry.text).toBe("Second note");

    // Verify the put contains both entries
    const putCmd = mockSend.mock.calls[1]![0]!;
    const body = JSON.parse(putCmd.input.Body as string);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].text).toBe("Existing note");
    expect(body.entries[1].text).toBe("Second note");
  });

  it("removeEntry filters correctly", async () => {
    const existing = {
      entries: [
        { id: "keep-1", text: "Keep this", createdAt: "2024-01-01T00:00:00.000Z" },
        { id: "remove-1", text: "Remove this", createdAt: "2024-01-02T00:00:00.000Z" },
      ],
    };

    // getMemories -> returns existing
    mockSend.mockResolvedValueOnce(s3Body(existing));
    // save -> PutObjectCommand
    mockSend.mockResolvedValueOnce({});

    const store = makeStore();
    const removed = await store.removeEntry("user-a", "remove-1");

    expect(removed).toBe(true);

    // Verify only the kept entry remains
    const putCmd = mockSend.mock.calls[1]![0]!;
    const body = JSON.parse(putCmd.input.Body as string);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].id).toBe("keep-1");
  });

  it("removeEntry returns false for non-existent id", async () => {
    const existing = {
      entries: [{ id: "abc", text: "A note", createdAt: "2024-01-01T00:00:00.000Z" }],
    };

    mockSend.mockResolvedValueOnce(s3Body(existing));

    const store = makeStore();
    const removed = await store.removeEntry("user-a", "nonexistent");

    expect(removed).toBe(false);
    // Only GetObjectCommand was called, no PutObjectCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("clearMemories saves empty entries", async () => {
    // clearMemories calls save directly, which calls PutObjectCommand
    mockSend.mockResolvedValueOnce({});

    const store = makeStore();
    await store.clearMemories("user-a");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCmd = mockSend.mock.calls[0]![0]!;
    const body = JSON.parse(putCmd.input.Body as string);
    expect(body).toEqual({ entries: [] });
  });

  it("cache behavior - second getMemories does not call S3 again", async () => {
    const existing = {
      entries: [{ id: "cached", text: "Cached note", createdAt: "2024-01-01T00:00:00.000Z" }],
    };

    mockSend.mockResolvedValueOnce(s3Body(existing));

    const store = makeStore();
    const mem1 = await store.getMemories("user-a");
    const mem2 = await store.getMemories("user-a");

    // S3 should only be called once; second call uses cache
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mem1).toBe(mem2); // same object reference = cache hit
    expect(mem1.entries).toHaveLength(1);
    expect(mem1.entries[0]!.text).toBe("Cached note");
  });

  it("uses correct S3 key without prefix", async () => {
    mockSend.mockRejectedValueOnce(noSuchKeyError());

    const store = new S3MemoryStore("bucket", "", "us-east-1");
    await store.getMemories("user-x");

    const cmd = mockSend.mock.calls[0]![0]!;
    expect(cmd.input.Key).toBe("users/user-x/memory.json");
  });
});
