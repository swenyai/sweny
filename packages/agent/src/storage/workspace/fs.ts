import { readFile, writeFile, mkdir, rm, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { WorkspaceFile, WorkspaceManifest, WorkspaceStore } from "./types.js";
import { WORKSPACE_LIMITS } from "./types.js";

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

export class FsWorkspaceStore implements WorkspaceStore {
  private baseDir: string;
  private cache = new Map<string, WorkspaceManifest>();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private manifestPath(userId: string): string {
    return join(this.baseDir, "users", userId, "workspace", "manifest.json");
  }

  private blobPath(userId: string, blobId: string): string {
    return join(this.baseDir, "users", userId, "workspace", "blobs", blobId);
  }

  async getManifest(userId: string): Promise<WorkspaceManifest> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    try {
      const data = await readFile(this.manifestPath(userId), "utf-8");
      const manifest = JSON.parse(data) as WorkspaceManifest;
      this.cache.set(userId, manifest);
      return manifest;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[workspace] Failed to load manifest:", err);
      }
    }

    const empty = emptyManifest(userId);
    this.cache.set(userId, empty);
    return empty;
  }

  private async saveManifest(userId: string, manifest: WorkspaceManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    this.cache.set(userId, manifest);
    const path = this.manifestPath(userId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(manifest, null, 2), "utf-8");
  }

  async readFile(userId: string, path: string): Promise<string> {
    const manifest = await this.getManifest(userId);
    const file = manifest.files.find((f) => f.path === path);
    if (!file) throw new Error(`File not found in workspace: ${path}`);

    return readFile(this.blobPath(userId, file.blobId), "utf-8");
  }

  async writeFile(userId: string, path: string, content: string, description?: string): Promise<WorkspaceFile> {
    const size = Buffer.byteLength(content, "utf-8");
    if (size > WORKSPACE_LIMITS.maxFileBytes) {
      throw new Error(`File too large (${size} bytes). Max: ${WORKSPACE_LIMITS.maxFileBytes} bytes.`);
    }

    const manifest = await this.getManifest(userId);

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
      await unlink(this.blobPath(userId, oldBlobId)).catch(() => {});
    }

    const blobId = randomUUID();
    const blobFilePath = this.blobPath(userId, blobId);
    await mkdir(dirname(blobFilePath), { recursive: true });
    await writeFile(blobFilePath, content, "utf-8");

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
    await unlink(this.blobPath(userId, file.blobId)).catch(() => {});

    manifest.files.splice(idx, 1);
    manifest.totalBytes -= file.size;
    await this.saveManifest(userId, manifest);
    return true;
  }

  async reset(userId: string): Promise<void> {
    const wsDir = join(this.baseDir, "users", userId, "workspace");
    if (existsSync(wsDir)) {
      await rm(wsDir, { recursive: true, force: true });
    }
    const empty = emptyManifest(userId);
    this.cache.set(userId, empty);
    await this.saveManifest(userId, empty);
  }

  async getDownloadUrl(userId: string, path: string): Promise<string> {
    const manifest = await this.getManifest(userId);
    const file = manifest.files.find((f) => f.path === path);
    if (!file) throw new Error(`File not found in workspace: ${path}`);

    // For local FS, return the file path
    return `file://${this.blobPath(userId, file.blobId)}`;
  }
}
