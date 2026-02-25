// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface PersistedSession {
  threadKey: string;
  claudeSessionId: string | null;
  userId: string;
  messageCount: number;
  createdAt: string;
  lastActiveAt: string;
}

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  toolCalls?: { toolName: string; toolInput: Record<string, unknown>; executedAt: string }[];
  timestamp: string;
}

export interface SessionStore {
  load(userId: string, threadKey: string): Promise<PersistedSession | null>;
  save(userId: string, threadKey: string, session: PersistedSession): Promise<void>;
  appendTranscript(userId: string, threadKey: string, entry: TranscriptEntry): Promise<void>;
  getTranscript(userId: string, threadKey: string): Promise<TranscriptEntry[]>;
  listSessions(userId: string): Promise<PersistedSession[]>;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

export interface UserMemory {
  entries: MemoryEntry[];
}

export interface MemoryStore {
  getMemories(userId: string): Promise<UserMemory>;
  addEntry(userId: string, text: string): Promise<MemoryEntry>;
  removeEntry(userId: string, entryId: string): Promise<boolean>;
  clearMemories(userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface WorkspaceFile {
  path: string;
  blobId: string;
  size: number;
  mimeType: string;
  createdAt: string;
  description?: string;
}

export interface WorkspaceManifest {
  userId: string;
  createdAt: string;
  updatedAt: string;
  totalBytes: number;
  files: WorkspaceFile[];
}

export const WORKSPACE_LIMITS = {
  maxTotalBytes: 50 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 500,
} as const;

export interface WorkspaceStore {
  getManifest(userId: string): Promise<WorkspaceManifest>;
  readFile(userId: string, path: string): Promise<string>;
  writeFile(userId: string, path: string, content: string, description?: string): Promise<WorkspaceFile>;
  deleteFile(userId: string, path: string): Promise<boolean>;
  reset(userId: string): Promise<void>;
  getDownloadUrl(userId: string, path: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Composite provider
// ---------------------------------------------------------------------------

export interface StorageProvider {
  createSessionStore(): SessionStore;
  createMemoryStore(): MemoryStore;
  createWorkspaceStore(): WorkspaceStore;
}
