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
