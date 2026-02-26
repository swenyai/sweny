import type { StorageProvider } from "./types.js";
import { S3SessionStore } from "./session/s3.js";
import { S3MemoryStore } from "./memory/s3.js";
import { S3WorkspaceStore } from "./workspace/s3.js";

export function s3Storage(opts: { bucket: string; prefix?: string; region?: string }): StorageProvider {
  const { bucket, prefix = "", region = "us-west-2" } = opts;
  return {
    createSessionStore: () => new S3SessionStore(bucket, prefix, region),
    createMemoryStore: () => new S3MemoryStore(bucket, prefix, region),
    createWorkspaceStore: () => new S3WorkspaceStore(bucket, prefix, region),
  };
}
