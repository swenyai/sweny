import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import type { SessionStore, PersistedSession, TranscriptEntry } from "../../src/storage/session/types.js";

/** Flush microtask queue so fire-and-forget promises settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Minimal in-memory implementation of SessionStore for testing. */
function createMockStore(): SessionStore {
  const sessions = new Map<string, PersistedSession>();
  const transcripts = new Map<string, TranscriptEntry[]>();

  function storeKey(userId: string, threadKey: string): string {
    return `${userId}::${threadKey}`;
  }

  return {
    async load(userId, threadKey) {
      return sessions.get(storeKey(userId, threadKey)) ?? null;
    },
    async save(userId, threadKey, session) {
      sessions.set(storeKey(userId, threadKey), session);
    },
    async appendTranscript(userId, threadKey, entry) {
      const key = storeKey(userId, threadKey);
      const entries = transcripts.get(key) ?? [];
      entries.push(entry);
      transcripts.set(key, entries);
    },
    async getTranscript(userId, threadKey) {
      return transcripts.get(storeKey(userId, threadKey)) ?? [];
    },
    async listSessions(userId) {
      const results: PersistedSession[] = [];
      for (const [key, session] of sessions) {
        if (key.startsWith(`${userId}::`)) {
          results.push(session);
        }
      }
      return results;
    },
  };
}

describe("SessionManager", () => {
  let manager: SessionManager;
  let store: SessionStore;

  beforeEach(() => {
    store = createMockStore();
    manager = new SessionManager(24, store);
  });

  afterEach(() => {
    manager.destroy();
  });

  it("getOrCreate creates a new session", () => {
    const session = manager.getOrCreate("thread-1", "user-a");

    expect(session).toBeDefined();
    expect(session.threadKey).toBe("thread-1");
    expect(session.userId).toBe("user-a");
    expect(session.agentSessionId).toBeNull();
    expect(session.messageCount).toBe(0);
    expect(session.createdAt).toBeInstanceOf(Date);
  });

  it("getOrCreate returns the same session for the same key", () => {
    const first = manager.getOrCreate("thread-1", "user-a");
    const second = manager.getOrCreate("thread-1", "user-a");

    expect(first).toBe(second);
  });

  it("different keys get different sessions", () => {
    const s1 = manager.getOrCreate("thread-1", "user-a");
    const s2 = manager.getOrCreate("thread-2", "user-a");

    expect(s1).not.toBe(s2);
    expect(s1.threadKey).toBe("thread-1");
    expect(s2.threadKey).toBe("thread-2");
  });

  it("session stores threadKey and userId", () => {
    const session = manager.getOrCreate("thread-abc", "user-xyz");
    expect(session.threadKey).toBe("thread-abc");
    expect(session.userId).toBe("user-xyz");
  });

  it("appendTranscript adds entries", async () => {
    const session = manager.getOrCreate("thread-1", "user-a");
    const entry: TranscriptEntry = {
      role: "user",
      text: "Hello",
      timestamp: new Date().toISOString(),
    };

    manager.appendTranscript(session, entry);

    // Fire-and-forget promise settles on next microtask tick
    await flushMicrotasks();

    const transcript = await manager.getTranscript("user-a", "thread-1");
    expect(transcript).toHaveLength(1);
    expect(transcript[0]!.text).toBe("Hello");
  });

  it("getTranscript returns entries in order", async () => {
    const session = manager.getOrCreate("thread-1", "user-a");

    const entry1: TranscriptEntry = {
      role: "user",
      text: "First",
      timestamp: "2025-01-01T00:00:00Z",
    };
    const entry2: TranscriptEntry = {
      role: "assistant",
      text: "Second",
      timestamp: "2025-01-01T00:00:01Z",
    };

    manager.appendTranscript(session, entry1);
    manager.appendTranscript(session, entry2);

    await flushMicrotasks();

    const transcript = await manager.getTranscript("user-a", "thread-1");
    expect(transcript).toHaveLength(2);
    expect(transcript[0]!.text).toBe("First");
    expect(transcript[1]!.text).toBe("Second");
  });

  it("clear removes session from memory", () => {
    manager.getOrCreate("thread-1", "user-a");

    expect(manager.get("thread-1")).not.toBeNull();

    manager.clear("thread-1");

    expect(manager.get("thread-1")).toBeNull();
  });

  it("listSessions returns sessions for a user from the store", async () => {
    const session = manager.getOrCreate("thread-1", "user-a");
    manager.persist(session);

    await flushMicrotasks();

    const sessions = await manager.listSessions("user-a");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.threadKey).toBe("thread-1");
  });

  it("clearAllForUser removes all sessions for a specific user", () => {
    manager.getOrCreate("thread-1", "user-a");
    manager.getOrCreate("thread-2", "user-a");
    manager.getOrCreate("thread-3", "user-b");

    manager.clearAllForUser("user-a");

    expect(manager.get("thread-1")).toBeNull();
    expect(manager.get("thread-2")).toBeNull();
    expect(manager.get("thread-3")).not.toBeNull();
  });
});
