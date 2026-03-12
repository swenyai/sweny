import type { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { WorkspaceFile, WorkspaceManifest, WorkspaceStore } from "../types.js";
import { WORKSPACE_LIMITS } from "../types.js";
import type { Logger } from "../../logger.js";
import { consoleLogger } from "../../logger.js";

function emptyManifest(userId: string): WorkspaceManifest {
  const now = new Date().toISOString();
  return { userId, createdAt: now, updatedAt: now, totalBytes: 0, files: [] };
}

function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    json: "application/json",
    txt: "text/plain",
    log: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    xml: "application/xml",
    yaml: "text/yaml",
    yml: "text/yaml",
    ts: "text/typescript",
    js: "text/javascript",
    py: "text/x-python",
    sh: "text/x-shellscript",
    html: "text/html",
    css: "text/css",
    sql: "text/x-sql",
  };
  return map[ext] ?? "text/plain";
}

export class S3WorkspaceStore implements WorkspaceStore {
  private _client: S3Client | null = null;
  private readonly region: string;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly cache = new Map<string, WorkspaceManifest>();
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

  private manifestKey(userId: string): string {
    const base = `users/${userId}/workspace/manifest.json`;
    return this.prefix ? `${this.prefix}/${base}` : base;
  }

  private blobKey(userId: string, blobId: string): string {
    const base = `users/${userId}/workspace/blobs/${blobId}`;
    return this.prefix ? `${this.prefix}/${base}` : base;
  }

  async getManifest(userId: string): Promise<WorkspaceManifest> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const [s3, { GetObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.manifestKey(userId) }));
      const body = await result.Body?.transformToString("utf-8");
      if (body) {
        const manifest = JSON.parse(body) as WorkspaceManifest;
        this.cache.set(userId, manifest);
        return manifest;
      }
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code !== "NoSuchKey" && code !== "AccessDenied") {
        this.logger.error("[workspace] Failed to load manifest:", err);
      }
    }

    const empty = emptyManifest(userId);
    this.cache.set(userId, empty);
    return empty;
  }

  private async saveManifest(userId: string, manifest: WorkspaceManifest): Promise<void> {
    const [s3, { PutObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    manifest.updatedAt = new Date().toISOString();
    this.cache.set(userId, manifest);
    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.manifestKey(userId),
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async readFile(userId: string, path: string): Promise<string> {
    const manifest = await this.getManifest(userId);
    const file = manifest.files.find((f) => f.path === path);
    if (!file) throw new Error(`File not found in workspace: ${path}`);

    const [s3, { GetObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    const result = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, file.blobId) }));
    return (await result.Body?.transformToString("utf-8")) ?? "";
  }

  async writeFile(userId: string, path: string, content: string, description?: string): Promise<WorkspaceFile> {
    const size = Buffer.byteLength(content, "utf-8");
    if (size > WORKSPACE_LIMITS.maxFileBytes) {
      throw new Error(`File too large (${size} bytes). Max: ${WORKSPACE_LIMITS.maxFileBytes} bytes.`);
    }

    const manifest = await this.getManifest(userId);

    const existingIdx = manifest.files.findIndex((f) => f.path === path);
    const existing = existingIdx >= 0 ? manifest.files[existingIdx] : undefined;
    const existingSize = existing?.size ?? 0;
    const newTotal = manifest.totalBytes - existingSize + size;

    if (newTotal > WORKSPACE_LIMITS.maxTotalBytes) {
      throw new Error(
        `Workspace full (${newTotal} bytes). Max: ${WORKSPACE_LIMITS.maxTotalBytes} bytes. Use workspace_delete to free space.`,
      );
    }

    if (existingIdx < 0 && manifest.files.length >= WORKSPACE_LIMITS.maxFiles) {
      throw new Error(
        `Too many files (${manifest.files.length}). Max: ${WORKSPACE_LIMITS.maxFiles}. Delete some first.`,
      );
    }

    const [s3, { PutObjectCommand, DeleteObjectCommand }] = await Promise.all([
      this.client(),
      import("@aws-sdk/client-s3"),
    ]);

    if (existing) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, existing.blobId) }))
        .catch(() => {});
    }

    const blobId = randomUUID();
    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.blobKey(userId, blobId),
        Body: content,
        ContentType: guessMimeType(path),
        ServerSideEncryption: "AES256",
      }),
    );

    const file: WorkspaceFile = {
      path,
      blobId,
      size,
      mimeType: guessMimeType(path),
      createdAt: new Date().toISOString(),
      description,
    };

    if (existingIdx >= 0) {
      manifest.files[existingIdx] = file;
    } else {
      manifest.files.push(file);
    }
    manifest.totalBytes = newTotal;
    await this.saveManifest(userId, manifest);

    return file;
  }

  async deleteFile(userId: string, path: string): Promise<boolean> {
    const manifest = await this.getManifest(userId);
    const idx = manifest.files.findIndex((f) => f.path === path);
    if (idx < 0) return false;

    const file = manifest.files[idx];
    if (!file) return false;

    const [s3, { DeleteObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);
    await s3
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, file.blobId) }))
      .catch(() => {});

    manifest.files.splice(idx, 1);
    manifest.totalBytes -= file.size;
    await this.saveManifest(userId, manifest);
    return true;
  }

  async reset(userId: string): Promise<void> {
    const manifest = await this.getManifest(userId);
    const [s3, { DeleteObjectCommand }] = await Promise.all([this.client(), import("@aws-sdk/client-s3")]);

    await Promise.all(
      manifest.files.map((f) =>
        s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, f.blobId) })).catch(() => {}),
      ),
    );

    await this.saveManifest(userId, emptyManifest(userId));
  }

  async getDownloadUrl(userId: string, path: string): Promise<string> {
    const manifest = await this.getManifest(userId);
    const file = manifest.files.find((f) => f.path === path);
    if (!file) throw new Error(`File not found in workspace: ${path}`);

    const [s3, { GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      this.client(),
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, file.blobId) });
    return getSignedUrl(s3, command, { expiresIn: 3600 });
  }
}
