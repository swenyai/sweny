import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import type { MemoryEntry, UserMemory, MemoryStore } from "../types.js";
import type { Logger } from "../../logger.js";
import { consoleLogger } from "../../logger.js";

export class S3MemoryStore implements MemoryStore {
  private s3: S3Client;
  private bucket: string;
  private prefix: string;
  private cache = new Map<string, UserMemory>();
  private logger: Logger;

  constructor(bucket: string, prefix = "", region = "us-west-2", logger?: Logger) {
    this.s3 = new S3Client({ region });
    this.bucket = bucket;
    this.prefix = prefix;
    this.logger = logger ?? consoleLogger;
  }

  private s3Key(userId: string): string {
    const base = `users/${userId}/memory.json`;
    return this.prefix ? `${this.prefix}/${base}` : base;
  }

  async getMemories(userId: string): Promise<UserMemory> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    try {
      const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.s3Key(userId) }));
      const body = await result.Body?.transformToString("utf-8");
      if (body) {
        const memory = JSON.parse(body) as UserMemory;
        this.cache.set(userId, memory);
        return memory;
      }
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code !== "NoSuchKey" && code !== "AccessDenied") {
        this.logger.error("[memory] Failed to load memories:", err);
      }
    }

    const empty: UserMemory = { entries: [] };
    this.cache.set(userId, empty);
    return empty;
  }

  private async save(userId: string, memory: UserMemory): Promise<void> {
    this.cache.set(userId, memory);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.s3Key(userId),
        Body: JSON.stringify(memory, null, 2),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      }),
    );
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
