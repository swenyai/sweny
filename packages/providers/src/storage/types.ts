// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** A persisted conversation session. */
export interface PersistedSession {
  /** Unique thread key identifying the conversation. */
  threadKey: string;
  /** Agent session ID, or null if not yet assigned. */
  agentSessionId: string | null;
  /** User who owns this session. */
  userId: string;
  /** Total number of messages in the session. */
  messageCount: number;
  /** ISO 8601 timestamp when the session was created. */
  createdAt: string;
  /** ISO 8601 timestamp of the last activity. */
  lastActiveAt: string;
}

/** A single entry in a conversation transcript. */
export interface TranscriptEntry {
  /** Role of the message author. */
  role: "user" | "assistant";
  /** Text content of the message. */
  text: string;
  /** Tool calls made during this turn. */
  toolCalls?: { toolName: string; toolInput: Record<string, unknown>; executedAt: string }[];
  /** ISO 8601 timestamp of the entry. */
  timestamp: string;
}

/** Store for managing conversation sessions and transcripts. */
export interface SessionStore {
  /**
   * Load a session by user and thread key.
   * @param userId - User identifier.
   * @param threadKey - Thread key identifying the session.
   * @returns The persisted session, or null if not found.
   */
  load(userId: string, threadKey: string): Promise<PersistedSession | null>;

  /**
   * Save or update a session.
   * @param userId - User identifier.
   * @param threadKey - Thread key identifying the session.
   * @param session - Session data to persist.
   */
  save(userId: string, threadKey: string, session: PersistedSession): Promise<void>;

  /**
   * Append a transcript entry to a session.
   * @param userId - User identifier.
   * @param threadKey - Thread key identifying the session.
   * @param entry - Transcript entry to append.
   */
  appendTranscript(userId: string, threadKey: string, entry: TranscriptEntry): Promise<void>;

  /**
   * Retrieve the full transcript for a session.
   * @param userId - User identifier.
   * @param threadKey - Thread key identifying the session.
   * @returns Array of transcript entries.
   */
  getTranscript(userId: string, threadKey: string): Promise<TranscriptEntry[]>;

  /**
   * List all sessions for a user.
   * @param userId - User identifier.
   * @returns Array of persisted sessions.
   */
  listSessions(userId: string): Promise<PersistedSession[]>;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** A single memory entry stored for a user. */
export interface MemoryEntry {
  /** Unique identifier for the memory entry. */
  id: string;
  /** Text content of the memory. */
  text: string;
  /** ISO 8601 timestamp when the entry was created. */
  createdAt: string;
}

/** Collection of memory entries for a user. */
export interface UserMemory {
  /** The user's memory entries. */
  entries: MemoryEntry[];
}

/** Store for managing per-user memory entries. */
export interface MemoryStore {
  /**
   * Get all memories for a user.
   * @param userId - User identifier.
   * @returns The user's memory collection.
   */
  getMemories(userId: string): Promise<UserMemory>;

  /**
   * Add a new memory entry for a user.
   * @param userId - User identifier.
   * @param text - Memory text to store.
   * @returns The newly created memory entry.
   */
  addEntry(userId: string, text: string): Promise<MemoryEntry>;

  /**
   * Remove a specific memory entry.
   * @param userId - User identifier.
   * @param entryId - ID of the entry to remove.
   * @returns True if the entry was found and removed.
   */
  removeEntry(userId: string, entryId: string): Promise<boolean>;

  /**
   * Clear all memories for a user.
   * @param userId - User identifier.
   */
  clearMemories(userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/** Metadata for a file stored in a user's workspace. */
export interface WorkspaceFile {
  /** Relative file path within the workspace. */
  path: string;
  /** Provider-specific blob identifier. */
  blobId: string;
  /** File size in bytes. */
  size: number;
  /** MIME type of the file. */
  mimeType: string;
  /** ISO 8601 timestamp when the file was created. */
  createdAt: string;
  /** Optional human-readable description of the file. */
  description?: string;
}

/** Manifest describing a user's entire workspace. */
export interface WorkspaceManifest {
  /** User who owns the workspace. */
  userId: string;
  /** ISO 8601 timestamp when the workspace was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the workspace was last updated. */
  updatedAt: string;
  /** Total bytes used across all files. */
  totalBytes: number;
  /** All files in the workspace. */
  files: WorkspaceFile[];
}

/** Hard limits for workspace storage. */
export const WORKSPACE_LIMITS = {
  maxTotalBytes: 50 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 500,
} as const;

/** Store for managing per-user workspace files. */
export interface WorkspaceStore {
  /**
   * Get the workspace manifest for a user.
   * @param userId - User identifier.
   * @returns The workspace manifest including file listing.
   */
  getManifest(userId: string): Promise<WorkspaceManifest>;

  /**
   * Read a file's content from the workspace.
   * @param userId - User identifier.
   * @param path - Relative file path within the workspace.
   * @returns The file content as a string.
   */
  readFile(userId: string, path: string): Promise<string>;

  /**
   * Write a file to the workspace (creates or overwrites).
   * @param userId - User identifier.
   * @param path - Relative file path within the workspace.
   * @param content - File content to write.
   * @param description - Optional human-readable description.
   * @returns Metadata of the written file.
   */
  writeFile(userId: string, path: string, content: string, description?: string): Promise<WorkspaceFile>;

  /**
   * Delete a file from the workspace.
   * @param userId - User identifier.
   * @param path - Relative file path within the workspace.
   * @returns True if the file was found and deleted.
   */
  deleteFile(userId: string, path: string): Promise<boolean>;

  /**
   * Reset (delete all files in) a user's workspace.
   * @param userId - User identifier.
   */
  reset(userId: string): Promise<void>;

  /**
   * Get a download URL for a workspace file.
   * @param userId - User identifier.
   * @param path - Relative file path within the workspace.
   * @returns A URL that can be used to download the file.
   */
  getDownloadUrl(userId: string, path: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Composite provider
// ---------------------------------------------------------------------------

/** Composite provider that creates session, memory, and workspace stores. */
export interface StorageProvider {
  /**
   * Create a session store instance.
   * @returns A SessionStore for managing conversation sessions.
   */
  createSessionStore(): SessionStore;

  /**
   * Create a memory store instance.
   * @returns A MemoryStore for managing per-user memories.
   */
  createMemoryStore(): MemoryStore;

  /**
   * Create a workspace store instance.
   * @returns A WorkspaceStore for managing per-user files.
   */
  createWorkspaceStore(): WorkspaceStore;
}
