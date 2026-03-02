---
title: Storage
description: Persist sessions, memory, and workspace files.
---

```typescript
import { fsStorage, s3Storage, csiStorage } from "@sweny-ai/providers/storage";
```

## Interface

```typescript
interface StorageProvider {
  createSessionStore(): SessionStore;
  createMemoryStore(): MemoryStore;
  createWorkspaceStore(): WorkspaceStore;
}
```

### Session Store

Persists conversation sessions and transcripts:

```typescript
interface SessionStore {
  load(userId: string, threadKey: string): Promise<PersistedSession | null>;
  save(userId: string, threadKey: string, session: PersistedSession): Promise<void>;
  appendTranscript(userId: string, threadKey: string, entry: TranscriptEntry): Promise<void>;
  getTranscript(userId: string, threadKey: string): Promise<TranscriptEntry[]>;
  listSessions(userId: string): Promise<PersistedSession[]>;
}
```

### Memory Store

Long-term memory that persists across sessions:

```typescript
interface MemoryStore {
  getMemories(userId: string): Promise<UserMemory>;
  addEntry(userId: string, text: string): Promise<MemoryEntry>;
  removeEntry(userId: string, entryId: string): Promise<boolean>;
  clearMemories(userId: string): Promise<void>;
}
```

### Workspace Store

File storage for user-generated content:

```typescript
interface WorkspaceStore {
  getManifest(userId: string): Promise<WorkspaceManifest>;
  readFile(userId: string, path: string): Promise<string>;
  writeFile(userId: string, path: string, content: string): Promise<WorkspaceFile>;
  deleteFile(userId: string, path: string): Promise<boolean>;
  reset(userId: string): Promise<void>;
  getDownloadUrl(userId: string, path: string): Promise<string>;
}
```

Workspace limits: 50 MB total, 5 MB per file, 500 files max.

## Filesystem Storage

For local development and single-server deployments:

```typescript
const storage = fsStorage({ baseDir: "./.sweny-data" });
```

Data layout: `{baseDir}/users/{userId}/sessions/`, `{baseDir}/users/{userId}/memory/`, etc.

## S3 Storage

For production deployments:

```typescript
const storage = s3Storage({
  bucket: "my-sweny-bucket",
  prefix: "agent",        // optional
  region: "us-west-2",    // optional, defaults to us-west-2
});
```

Requires `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` as peer dependencies. Uses AES-256 server-side encryption.

## CSI / Kubernetes PVC Storage

For Kubernetes deployments using a mounted PersistentVolumeClaim:

```typescript
const storage = csiStorage({
  mountPath: "/mnt/sweny-data",
  volumeName: "sweny-pvc",    // optional, used in logs
  namespace: "production",    // optional, used in logs
});
```

Requires `@kubernetes/client-node` as a peer dependency.
