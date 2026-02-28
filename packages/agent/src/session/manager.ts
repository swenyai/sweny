import type { SessionStore } from "../storage/session/types.js";
import type { PersistedSession, TranscriptEntry } from "../storage/session/types.js";
import type { Logger } from "../logger.js";

export interface Session {
  threadKey: string;
  agentSessionId: string | null;
  userId: string;
  createdAt: Date;
  lastActiveAt: Date;
  messageCount: number;
}

const defaultLogger: Logger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  // eslint-disable-next-line no-console
  error: (...args: unknown[]) => console.error(...args),
};

export class SessionManager {
  private sessions = new Map<string, Session>();
  private ttlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval>;
  private store?: SessionStore;
  private logger: Logger;

  constructor(ttlHours: number, store?: SessionStore, logger?: Logger) {
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    this.store = store;
    this.logger = logger ?? defaultLogger;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  getOrCreate(threadKey: string, userId: string): Session {
    const existing = this.sessions.get(threadKey);
    if (existing && !this.isExpired(existing)) {
      return existing;
    }

    const session: Session = {
      threadKey,
      agentSessionId: null,
      userId,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      messageCount: 0,
    };

    this.sessions.set(threadKey, session);
    return session;
  }

  /**
   * Try to load a session from the persistent store (cache-miss path).
   * Falls back to getOrCreate if the store has no record.
   */
  async getOrCreateAsync(threadKey: string, userId: string): Promise<Session> {
    // Check in-memory cache first
    const cached = this.sessions.get(threadKey);
    if (cached && !this.isExpired(cached)) {
      return cached;
    }

    // Try to load from persistent store
    if (this.store) {
      try {
        const persisted = await this.store.load(userId, threadKey);
        if (persisted) {
          const session: Session = {
            threadKey: persisted.threadKey,
            agentSessionId: persisted.agentSessionId,
            userId: persisted.userId,
            createdAt: new Date(persisted.createdAt),
            lastActiveAt: new Date(persisted.lastActiveAt),
            messageCount: persisted.messageCount,
          };
          if (!this.isExpired(session)) {
            this.sessions.set(threadKey, session);
            return session;
          }
        }
      } catch (err) {
        this.logger.error("[session] Failed to load from store:", err);
      }
    }

    // Create new
    return this.getOrCreate(threadKey, userId);
  }

  get(threadKey: string): Session | null {
    const session = this.sessions.get(threadKey);
    if (!session || this.isExpired(session)) return null;
    return session;
  }

  /**
   * Persist session metadata to the store (non-blocking fire-and-forget).
   */
  persist(session: Session): void {
    if (!this.store) return;

    const persisted: PersistedSession = {
      threadKey: session.threadKey,
      agentSessionId: session.agentSessionId,
      userId: session.userId,
      messageCount: session.messageCount,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
    };

    this.store
      .save(session.userId, session.threadKey, persisted)
      .catch((err: unknown) => this.logger.error("[session] Failed to persist session:", err));
  }

  /**
   * Append a transcript entry to the session's conversation history.
   */
  appendTranscript(session: Session, entry: TranscriptEntry): void {
    if (!this.store) return;

    this.store
      .appendTranscript(session.userId, session.threadKey, entry)
      .catch((err: unknown) => this.logger.error("[session] Failed to append transcript:", err));
  }

  /**
   * Get the full conversation transcript for a session.
   */
  async getTranscript(userId: string, threadKey: string): Promise<TranscriptEntry[]> {
    if (!this.store) return [];
    return this.store.getTranscript(userId, threadKey);
  }

  /**
   * List all persisted sessions for a user.
   */
  async listSessions(userId: string): Promise<PersistedSession[]> {
    if (!this.store) return [];
    return this.store.listSessions(userId);
  }

  clear(threadKey: string): void {
    this.sessions.delete(threadKey);
  }

  clearAllForUser(userId: string): void {
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(key);
      }
    }
  }

  private isExpired(session: Session): boolean {
    return Date.now() - session.lastActiveAt.getTime() > this.ttlMs;
  }

  private cleanup(): void {
    for (const [key, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.sessions.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
