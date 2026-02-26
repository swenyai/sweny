import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { PersistedSession, TranscriptEntry, SessionStore } from "../types.js";

export class FsSessionStore implements SessionStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private sessionDir(userId: string, threadKey: string): string {
    return join(this.baseDir, "users", userId, "sessions", threadKey);
  }

  private metadataPath(userId: string, threadKey: string): string {
    return join(this.sessionDir(userId, threadKey), "metadata.json");
  }

  private transcriptPath(userId: string, threadKey: string): string {
    return join(this.sessionDir(userId, threadKey), "transcript.jsonl");
  }

  async load(userId: string, threadKey: string): Promise<PersistedSession | null> {
    try {
      const data = await readFile(this.metadataPath(userId, threadKey), "utf-8");
      return JSON.parse(data) as PersistedSession;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[session-store] Failed to load session:", err);
      }
    }
    return null;
  }

  async save(userId: string, threadKey: string, session: PersistedSession): Promise<void> {
    const path = this.metadataPath(userId, threadKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(session, null, 2), "utf-8");
  }

  async appendTranscript(userId: string, threadKey: string, entry: TranscriptEntry): Promise<void> {
    const path = this.transcriptPath(userId, threadKey);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
  }

  async getTranscript(userId: string, threadKey: string): Promise<TranscriptEntry[]> {
    try {
      const data = await readFile(this.transcriptPath(userId, threadKey), "utf-8");
      return data
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as TranscriptEntry);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[session-store] Failed to read transcript:", err);
      }
    }
    return [];
  }

  async listSessions(userId: string): Promise<PersistedSession[]> {
    const { readdir } = await import("node:fs/promises");
    const sessionsDir = join(this.baseDir, "users", userId, "sessions");
    try {
      const entries = await readdir(sessionsDir, { withFileTypes: true });
      const sessions: PersistedSession[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const session = await this.load(userId, entry.name);
          if (session) sessions.push(session);
        }
      }
      return sessions;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[session-store] Failed to list sessions:", err);
      }
    }
    return [];
  }
}
