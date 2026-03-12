import type { S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import type { MemoryEntry, UserMemory, MemoryStore } from "../types.js";
import type { Logger } from "../../logger.js";
import { consoleLogger } from "../../logger.js";

export class S3MemoryStore implements MemoryStore {
  private _client: S3Client | null = null;
  private readonly region: string;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly cache = new Map<string, UserMemory>();
  private readonly logger: Logger;

  constructor(bucket: string, prefix = "", region = "us-west-2", logger?: Logger) {
    this.bucket = bucket;
    this.prefix = prefix;
    this.region = region;
    this.logger = logger ?? consoleLogger;
  }

  private async client(): Promise<S3Client> {
    if (!this._client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this._client = new S3Client({ region: this.region });
    }
    return this._client;
  }

  private s3Key(userId: string): string {
    const base = `users/${userId}/memory.json`;
    return this.prefix ? `${this.prefix}/${base}` : base;
  }

  async getMemories(userId: string): Promise<UserMemory> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const [s3, { GetObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.s3Key(userId) }));
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
    const [s3, { PutObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    this.cache.set(userId, memory);
    await s3.send(
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
