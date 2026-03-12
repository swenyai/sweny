import type { S3Client } from "@aws-sdk/client-s3";
import type { PersistedSession, TranscriptEntry, SessionStore } from "../types.js";
import type { Logger } from "../../logger.js";
import { consoleLogger } from "../../logger.js";

export class S3SessionStore implements SessionStore {
  private _client: S3Client | null = null;
  private readonly region: string;
  private readonly bucket: string;
  private readonly prefix: string;
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
    const [s3, { GetObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    try {
      const result = await s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.metadataKey(userId, threadKey) }),
      );
      const body = await result.Body?.transformToString("utf-8");
      if (body) return JSON.parse(body) as PersistedSession;
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code !== "NoSuchKey" && code !== "AccessDenied") {
        this.logger.error("[session-store] Failed to load session:", err);
      }
    }
    return null;
  }

  async save(userId: string, threadKey: string, session: PersistedSession): Promise<void> {
    const [s3, { PutObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    await s3.send(
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
    const [s3, { GetObjectCommand, PutObjectCommand }] = await Promise.all([
      this.client(),
      import("@aws-sdk/client-s3"),
    ]);
    const key = this.transcriptKey(userId, threadKey);
    const line = JSON.stringify(entry) + "\n";

    let existing = "";
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      existing = (await result.Body?.transformToString("utf-8")) ?? "";
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code !== "NoSuchKey" && code !== "AccessDenied") {
        this.logger.error("[session-store] Failed to read transcript:", err);
      }
    }

    await s3.send(
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
    const [s3, { GetObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    try {
      const result = await s3.send(
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
        this.logger.error("[session-store] Failed to read transcript:", err);
      }
    }
    return [];
  }

  async listSessions(userId: string): Promise<PersistedSession[]> {
    const [s3, { ListObjectsV2Command }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    const prefix = this.prefix ? `${this.prefix}/users/${userId}/sessions/` : `users/${userId}/sessions/`;

    const sessions: PersistedSession[] = [];
    let continuationToken: string | undefined;

    do {
      const result = await s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: continuationToken,
        }),
      );

      if (result.CommonPrefixes) {
        for (const cp of result.CommonPrefixes) {
          if (!cp.Prefix) continue;
          const parts = cp.Prefix.replace(/\/$/, "").split("/");
          const threadKey = parts[parts.length - 1];
          if (!threadKey) continue;
          const session = await this.load(userId, threadKey);
          if (session) sessions.push(session);
        }
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    return sessions;
  }
}
