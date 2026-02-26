import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FsSessionStore } from "../../src/storage/session/fs.js";
import type { PersistedSession, TranscriptEntry } from "../../src/storage/types.js";

describe("FsSessionStore", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweny-session-test-"));
    tempDirs.push(dir);
    return dir;
  }

  function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
    return {
      threadKey: "thread-1",
      claudeSessionId: "sess-abc",
      userId: "user-a",
      messageCount: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      ...overrides,
    };
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("load returns null for non-existent session", async () => {
    const store = new FsSessionStore(makeTempDir());
    const result = await store.load("user-a", "no-such-thread");
    expect(result).toBeNull();
  });

  it("save and load round-trips a session", async () => {
    const store = new FsSessionStore(makeTempDir());
    const session = makeSession();

    await store.save("user-a", "thread-1", session);
    const loaded = await store.load("user-a", "thread-1");

    expect(loaded).toEqual(session);
  });

  it("save overwrites existing session", async () => {
    const store = new FsSessionStore(makeTempDir());
    const session = makeSession({ messageCount: 5 });

    await store.save("user-a", "thread-1", session);
    const updated = makeSession({ messageCount: 10 });
    await store.save("user-a", "thread-1", updated);

    const loaded = await store.load("user-a", "thread-1");
    expect(loaded?.messageCount).toBe(10);
  });

  it("appendTranscript and getTranscript round-trip entries", async () => {
    const store = new FsSessionStore(makeTempDir());
    const entry1: TranscriptEntry = {
      role: "user",
      text: "Hello",
      timestamp: new Date().toISOString(),
    };
    const entry2: TranscriptEntry = {
      role: "assistant",
      text: "Hi there!",
      timestamp: new Date().toISOString(),
    };

    await store.appendTranscript("user-a", "thread-1", entry1);
    await store.appendTranscript("user-a", "thread-1", entry2);

    const transcript = await store.getTranscript("user-a", "thread-1");
    expect(transcript).toHaveLength(2);
    expect(transcript[0]).toEqual(entry1);
    expect(transcript[1]).toEqual(entry2);
  });

  it("getTranscript returns empty for non-existent thread", async () => {
    const store = new FsSessionStore(makeTempDir());
    const transcript = await store.getTranscript("user-a", "missing");
    expect(transcript).toEqual([]);
  });

  it("listSessions returns all sessions for a user", async () => {
    const store = new FsSessionStore(makeTempDir());

    await store.save("user-a", "thread-1", makeSession({ threadKey: "thread-1" }));
    await store.save("user-a", "thread-2", makeSession({ threadKey: "thread-2" }));
    await store.save("user-b", "thread-3", makeSession({ threadKey: "thread-3", userId: "user-b" }));

    const sessions = await store.listSessions("user-a");
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.threadKey).sort()).toEqual(["thread-1", "thread-2"]);
  });

  it("listSessions returns empty for unknown user", async () => {
    const store = new FsSessionStore(makeTempDir());
    const sessions = await store.listSessions("nobody");
    expect(sessions).toEqual([]);
  });

  it("sessions persist across store instances", async () => {
    const dir = makeTempDir();
    const store1 = new FsSessionStore(dir);
    const session = makeSession();

    await store1.save("user-a", "thread-1", session);

    const store2 = new FsSessionStore(dir);
    const loaded = await store2.load("user-a", "thread-1");
    expect(loaded).toEqual(session);
  });

  it("transcript entries can include tool calls", async () => {
    const store = new FsSessionStore(makeTempDir());
    const entry: TranscriptEntry = {
      role: "assistant",
      text: "Running analysis...",
      toolCalls: [
        {
          toolName: "query_logs",
          toolInput: { service: "api", timeRange: "1h" },
          executedAt: new Date().toISOString(),
        },
      ],
      timestamp: new Date().toISOString(),
    };

    await store.appendTranscript("user-a", "thread-1", entry);
    const transcript = await store.getTranscript("user-a", "thread-1");

    expect(transcript).toHaveLength(1);
    expect(transcript[0]!.toolCalls).toHaveLength(1);
    expect(transcript[0]!.toolCalls![0]!.toolName).toBe("query_logs");
  });
});
