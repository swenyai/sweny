import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
    json: "application/json", txt: "text/plain", log: "text/plain",
    md: "text/markdown", csv: "text/csv", xml: "application/xml",
    yaml: "text/yaml", yml: "text/yaml", ts: "text/typescript",
    js: "text/javascript", py: "text/x-python", sh: "text/x-shellscript",
    html: "text/html", css: "text/css", sql: "text/x-sql",
  };
  return map[ext] ?? "text/plain";
}

export class S3WorkspaceStore implements WorkspaceStore {
  private s3: S3Client;
  private bucket: string;
  private prefix: string;
  private cache = new Map<string, WorkspaceManifest>();
  private logger: Logger;

  constructor(bucket: string, prefix = "", region = "us-west-2", logger?: Logger) {
    this.s3 = new S3Client({ region });
    this.bucket = bucket;
    this.prefix = prefix;
    this.logger = logger ?? consoleLogger;
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

    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.manifestKey(userId) }),
      );
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
    manifest.updatedAt = new Date().toISOString();
    this.cache.set(userId, manifest);
    await this.s3.send(
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

    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, file.blobId) }),
    );
    return (await result.Body?.transformToString("utf-8")) ?? "";
  }

  async writeFile(userId: string, path: string, content: string, description?: string): Promise<WorkspaceFile> {
    const size = Buffer.byteLength(content, "utf-8");
    if (size > WORKSPACE_LIMITS.maxFileBytes) {
      throw new Error(`File too large (${size} bytes). Max: ${WORKSPACE_LIMITS.maxFileBytes} bytes.`);
    }

    const manifest = await this.getManifest(userId);

    // Check if replacing existing file
    const existingIdx = manifest.files.findIndex((f) => f.path === path);
    const existingSize = existingIdx >= 0 ? manifest.files[existingIdx]!.size : 0;
    const newTotal = manifest.totalBytes - existingSize + size;

    if (newTotal > WORKSPACE_LIMITS.maxTotalBytes) {
      throw new Error(`Workspace full (${newTotal} bytes). Max: ${WORKSPACE_LIMITS.maxTotalBytes} bytes. Use workspace_delete to free space.`);
    }

    if (existingIdx < 0 && manifest.files.length >= WORKSPACE_LIMITS.maxFiles) {
      throw new Error(`Too many files (${manifest.files.length}). Max: ${WORKSPACE_LIMITS.maxFiles}. Delete some first.`);
    }

    // Delete old blob if replacing
    if (existingIdx >= 0) {
      const oldBlobId = manifest.files[existingIdx]!.blobId;
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, oldBlobId) }),
      ).catch(() => {});
    }

    const blobId = randomUUID();
    await this.s3.send(
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

    const file = manifest.files[idx]!;
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, file.blobId) }),
    ).catch(() => {});

    manifest.files.splice(idx, 1);
    manifest.totalBytes -= file.size;
    await this.saveManifest(userId, manifest);
    return true;
  }

  async reset(userId: string): Promise<void> {
    const manifest = await this.getManifest(userId);

    // Delete all blobs
    await Promise.all(
      manifest.files.map((f) =>
        this.s3.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: this.blobKey(userId, f.blobId) }),
        ).catch(() => {}),
      ),
    );

    // Reset manifest
    const empty = emptyManifest(userId);
    await this.saveManifest(userId, empty);
  }

  async getDownloadUrl(userId: string, path: string): Promise<string> {
    const manifest = await this.getManifest(userId);
    const file = manifest.files.find((f) => f.path === path);
    if (!file) throw new Error(`File not found in workspace: ${path}`);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.blobKey(userId, file.blobId),
    });
    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }
}
