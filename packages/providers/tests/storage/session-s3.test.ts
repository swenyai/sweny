import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PersistedSession, TranscriptEntry } from "../../src/storage/types.js";

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-s3
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: class {
      send = mockSend;
    },
    GetObjectCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    PutObjectCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    ListObjectsV2Command: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
  };
});

// Import after mock so the mock is applied
import { S3SessionStore } from "../../src/storage/session/s3.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    threadKey: "thread-1",
    agentSessionId: "sess-abc",
    userId: "user-a",
    messageCount: 0,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    ...overrides,
  };
}

function s3Body(content: string) {
  return {
    Body: {
      transformToString: vi.fn().mockResolvedValue(content),
    },
  };
}

function noSuchKeyError() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S3SessionStore", () => {
  const BUCKET = "test-bucket";
  const PREFIX = "data";

  beforeEach(() => {
    mockSend.mockReset();
  });

  // -----------------------------------------------------------------------
  // load
  // -----------------------------------------------------------------------

  it("load returns parsed session from S3", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const session = makeSession();

    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(session)));

    const result = await store.load("user-a", "thread-1");
    expect(result).toEqual(session);

    // Verify GetObjectCommand was sent with correct params
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input).toEqual({
      Bucket: BUCKET,
      Key: "data/users/user-a/sessions/thread-1/metadata.json",
    });
  });

  it("load returns null when key does not exist (NoSuchKey)", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);

    mockSend.mockRejectedValueOnce(noSuchKeyError());

    const result = await store.load("user-a", "missing-thread");
    expect(result).toBeNull();
  });

  it("load returns null when AccessDenied", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const err = new Error("AccessDenied");
    err.name = "AccessDenied";

    mockSend.mockRejectedValueOnce(err);

    const result = await store.load("user-a", "denied-thread");
    expect(result).toBeNull();
  });

  it("load returns null when Body is empty", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);

    mockSend.mockResolvedValueOnce({
      Body: { transformToString: vi.fn().mockResolvedValue("") },
    });

    const result = await store.load("user-a", "thread-1");
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // save
  // -----------------------------------------------------------------------

  it("save puts session as JSON to S3", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const session = makeSession({ messageCount: 5 });

    mockSend.mockResolvedValueOnce({});

    await store.save("user-a", "thread-1", session);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input).toEqual({
      Bucket: BUCKET,
      Key: "data/users/user-a/sessions/thread-1/metadata.json",
      Body: JSON.stringify(session, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    });
  });

  // -----------------------------------------------------------------------
  // appendTranscript
  // -----------------------------------------------------------------------

  it("appendTranscript appends to existing transcript", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const existingEntry: TranscriptEntry = {
      role: "user",
      text: "Hello",
      timestamp: "2025-01-01T00:00:00.000Z",
    };
    const newEntry: TranscriptEntry = {
      role: "assistant",
      text: "Hi there!",
      timestamp: "2025-01-01T00:00:01.000Z",
    };

    const existingContent = JSON.stringify(existingEntry) + "\n";

    // First call: GetObject returns existing transcript
    mockSend.mockResolvedValueOnce(s3Body(existingContent));
    // Second call: PutObject
    mockSend.mockResolvedValueOnce({});

    await store.appendTranscript("user-a", "thread-1", newEntry);

    expect(mockSend).toHaveBeenCalledTimes(2);

    // Verify PutObject call
    const putCmd = mockSend.mock.calls[1][0];
    const expectedBody = existingContent + JSON.stringify(newEntry) + "\n";
    expect(putCmd.input).toEqual({
      Bucket: BUCKET,
      Key: "data/users/user-a/sessions/thread-1/transcript.jsonl",
      Body: expectedBody,
      ContentType: "application/x-ndjson",
      ServerSideEncryption: "AES256",
    });
  });

  it("appendTranscript creates new transcript when none exists (NoSuchKey)", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const entry: TranscriptEntry = {
      role: "user",
      text: "First message",
      timestamp: "2025-01-01T00:00:00.000Z",
    };

    // First call: GetObject throws NoSuchKey
    mockSend.mockRejectedValueOnce(noSuchKeyError());
    // Second call: PutObject
    mockSend.mockResolvedValueOnce({});

    await store.appendTranscript("user-a", "thread-1", entry);

    expect(mockSend).toHaveBeenCalledTimes(2);

    // Verify PutObject with just the new entry
    const putCmd = mockSend.mock.calls[1][0];
    expect(putCmd.input).toEqual({
      Bucket: BUCKET,
      Key: "data/users/user-a/sessions/thread-1/transcript.jsonl",
      Body: JSON.stringify(entry) + "\n",
      ContentType: "application/x-ndjson",
      ServerSideEncryption: "AES256",
    });
  });

  // -----------------------------------------------------------------------
  // getTranscript
  // -----------------------------------------------------------------------

  it("getTranscript parses JSONL entries", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const entry1: TranscriptEntry = {
      role: "user",
      text: "Hello",
      timestamp: "2025-01-01T00:00:00.000Z",
    };
    const entry2: TranscriptEntry = {
      role: "assistant",
      text: "Hi!",
      timestamp: "2025-01-01T00:00:01.000Z",
    };

    const content = JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n";
    mockSend.mockResolvedValueOnce(s3Body(content));

    const transcript = await store.getTranscript("user-a", "thread-1");
    expect(transcript).toHaveLength(2);
    expect(transcript[0]).toEqual(entry1);
    expect(transcript[1]).toEqual(entry2);
  });

  it("getTranscript returns empty array when key does not exist", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);

    mockSend.mockRejectedValueOnce(noSuchKeyError());

    const transcript = await store.getTranscript("user-a", "missing");
    expect(transcript).toEqual([]);
  });

  it("getTranscript returns empty array when body is empty", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);

    mockSend.mockResolvedValueOnce(s3Body(""));

    const transcript = await store.getTranscript("user-a", "thread-1");
    expect(transcript).toEqual([]);
  });

  it("getTranscript handles entries with tool calls", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const entry: TranscriptEntry = {
      role: "assistant",
      text: "Running analysis...",
      toolCalls: [
        {
          toolName: "query_logs",
          toolInput: { service: "api", timeRange: "1h" },
          executedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      timestamp: "2025-01-01T00:00:00.000Z",
    };

    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(entry) + "\n"));

    const transcript = await store.getTranscript("user-a", "thread-1");
    expect(transcript).toHaveLength(1);
    expect(transcript[0]!.toolCalls).toHaveLength(1);
    expect(transcript[0]!.toolCalls![0]!.toolName).toBe("query_logs");
  });

  // -----------------------------------------------------------------------
  // listSessions
  // -----------------------------------------------------------------------

  it("listSessions returns sessions from CommonPrefixes", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const session1 = makeSession({ threadKey: "thread-1" });
    const session2 = makeSession({ threadKey: "thread-2" });

    // First call: ListObjectsV2 returns common prefixes
    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [
        { Prefix: "data/users/user-a/sessions/thread-1/" },
        { Prefix: "data/users/user-a/sessions/thread-2/" },
      ],
      NextContinuationToken: undefined,
    });
    // Second & third calls: GetObject for each session metadata
    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(session1)));
    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(session2)));

    const sessions = await store.listSessions("user-a");
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.threadKey).sort()).toEqual(["thread-1", "thread-2"]);

    // Verify ListObjectsV2 was called with correct prefix and delimiter
    const listCmd = mockSend.mock.calls[0][0];
    expect(listCmd.input).toEqual({
      Bucket: BUCKET,
      Prefix: "data/users/user-a/sessions/",
      Delimiter: "/",
      ContinuationToken: undefined,
    });
  });

  it("listSessions handles pagination with ContinuationToken", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const session1 = makeSession({ threadKey: "thread-1" });
    const session2 = makeSession({ threadKey: "thread-2" });

    // First page
    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: "data/users/user-a/sessions/thread-1/" }],
      NextContinuationToken: "token-page-2",
    });
    // Load session from first page
    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(session1)));
    // Second page
    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: "data/users/user-a/sessions/thread-2/" }],
      NextContinuationToken: undefined,
    });
    // Load session from second page
    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(session2)));

    const sessions = await store.listSessions("user-a");
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.threadKey).sort()).toEqual(["thread-1", "thread-2"]);

    // Verify the second ListObjectsV2 call used the continuation token
    const secondListCmd = mockSend.mock.calls[2][0];
    expect(secondListCmd.input.ContinuationToken).toBe("token-page-2");
  });

  it("listSessions returns empty when no CommonPrefixes", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);

    mockSend.mockResolvedValueOnce({
      CommonPrefixes: undefined,
      NextContinuationToken: undefined,
    });

    const sessions = await store.listSessions("user-a");
    expect(sessions).toEqual([]);
  });

  it("listSessions skips sessions that fail to load", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);
    const session2 = makeSession({ threadKey: "thread-2" });

    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [
        { Prefix: "data/users/user-a/sessions/thread-1/" },
        { Prefix: "data/users/user-a/sessions/thread-2/" },
      ],
      NextContinuationToken: undefined,
    });
    // First session load fails
    mockSend.mockRejectedValueOnce(noSuchKeyError());
    // Second session loads fine
    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(session2)));

    const sessions = await store.listSessions("user-a");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.threadKey).toBe("thread-2");
  });

  // -----------------------------------------------------------------------
  // prefix handling
  // -----------------------------------------------------------------------

  it("works without prefix", async () => {
    const store = new S3SessionStore(BUCKET);
    const session = makeSession();

    mockSend.mockResolvedValueOnce(s3Body(JSON.stringify(session)));

    await store.load("user-a", "thread-1");

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Key).toBe("users/user-a/sessions/thread-1/metadata.json");
  });

  it("listSessions uses correct prefix without store prefix", async () => {
    const store = new S3SessionStore(BUCKET);

    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [],
      NextContinuationToken: undefined,
    });

    await store.listSessions("user-a");

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Prefix).toBe("users/user-a/sessions/");
  });

  it("listSessions skips CommonPrefixes entries with empty Prefix", async () => {
    const store = new S3SessionStore(BUCKET, PREFIX);

    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: "" }, { Prefix: undefined }],
      NextContinuationToken: undefined,
    });

    const sessions = await store.listSessions("user-a");
    expect(sessions).toEqual([]);
  });
});
