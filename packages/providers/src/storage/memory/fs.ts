import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { MemoryEntry, UserMemory, MemoryStore } from "../types.js";

export class FsMemoryStore implements MemoryStore {
  private baseDir: string;
  private cache = new Map<string, UserMemory>();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private filePath(userId: string): string {
    return join(this.baseDir, "users", userId, "memory.json");
  }

  async getMemories(userId: string): Promise<UserMemory> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    try {
      const data = await readFile(this.filePath(userId), "utf-8");
      const memory = JSON.parse(data) as UserMemory;
      this.cache.set(userId, memory);
      return memory;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[memory] Failed to load memories:", err);
      }
    }

    const empty: UserMemory = { entries: [] };
    this.cache.set(userId, empty);
    return empty;
  }

  private async save(userId: string, memory: UserMemory): Promise<void> {
    this.cache.set(userId, memory);
    const path = this.filePath(userId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(memory, null, 2), "utf-8");
  }

  async addEntry(userId: string, text: string): Promise<MemoryEntry> {
    const memory = await this.getMemories(userId);
    const entry: MemoryEntry = {
      id: randomBytes(4).toString("hex"),
      text,
      createdAt: new Date().toISOString(),
    };
    memory.entries.push(entry);
    await this.save(userId, memory);
    return entry;
  }

  async removeEntry(userId: string, entryId: string): Promise<boolean> {
    const memory = await this.getMemories(userId);
    const idx = memory.entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;
    memory.entries.splice(idx, 1);
    await this.save(userId, memory);
    return true;
  }

  async clearMemories(userId: string): Promise<void> {
    await this.save(userId, { entries: [] });
  }
}
