export interface AuditRecord {
  sessionId: string;
  threadKey: string;
  channelId: string;
  threadTs: string;
  userId: string;
  userEmail?: string;
  turnNumber: number;
  userMessage: string;
  assistantResponse: string;
  toolCalls: { toolName: string; toolInput: Record<string, unknown>; executedAt: string }[];
  durationMs: number;
  timestamp: string;
}

export interface AuditLogger {
  logTurn(record: AuditRecord): Promise<void>;
}
