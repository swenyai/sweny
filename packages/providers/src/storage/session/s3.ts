import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { PersistedSession, TranscriptEntry, SessionStore } from "../types.js";

export class S3SessionStore implements SessionStore {
  private s3: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(bucket: string, prefix = "", region = "us-west-2") {
    this.s3 = new S3Client({ region });
    this.bucket = bucket;
    this.prefix = prefix;
  }

  private baseKey(userId: string, threadKey: string): string {
    const base = `users/${userId}/sessions/${threadKey}`;
    return this.prefix ? `${this.prefix}/${base}` : base;
  }

  private metadataKey(userId: string, threadKey: string): string {
    return `${this.baseKey(userId, threadKey)}/metadata.json`;
  }

  private transcriptKey(userId: string, threadKey: string): string {
    return `${this.baseKey(userId, threadKey)}/transcript.jsonl`;
  }

  async load(userId: string, threadKey: string): Promise<PersistedSession | null> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.metadataKey(userId, threadKey) }),
      );
      const body = await result.Body?.transformToString("utf-8");
      if (body) return JSON.parse(body) as PersistedSession;
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code !== "NoSuchKey" && code !== "AccessDenied") {
        console.error("[session-store] Failed to load session:", err);
      }
    }
    return null;
  }

  async save(userId: string, threadKey: string, session: PersistedSession): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.metadataKey(userId, threadKey),
        Body: JSON.stringify(session, null, 2),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async appendTranscript(userId: string, threadKey: string, entry: TranscriptEntry): Promise<void> {
    const key = this.transcriptKey(userId, threadKey);
    const line = JSON.stringify(entry) + "\n";

    // Read existing transcript and append
    let existing = "";
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      existing = (await result.Body?.transformToString("utf-8")) ?? "";
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code !== "NoSuchKey" && code !== "AccessDenied") {
        console.error("[session-store] Failed to read transcript:", err);
      }
    }

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: existing + line,
        ContentType: "application/x-ndjson",
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async getTranscript(userId: string, threadKey: string): Promise<TranscriptEntry[]> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.transcriptKey(userId, threadKey) }),
      );
      const body = await result.Body?.transformToString("utf-8");
      if (!body) return [];
      return body
        .trim()
        .split("\n")
        .filter((line: string) => line.length > 0)
        .map((line: string) => JSON.parse(line) as TranscriptEntry);
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code !== "NoSuchKey" && code !== "AccessDenied") {
        console.error("[session-store] Failed to read transcript:", err);
      }
    }
    return [];
  }

  async listSessions(_userId: string): Promise<PersistedSession[]> {
    // S3 listing requires ListObjectsV2 -- for now return empty.
    // Full implementation would list users/{userId}/sessions/*/metadata.json
    return [];
  }
}
