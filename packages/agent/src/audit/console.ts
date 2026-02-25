import type { AuditLogger, AuditRecord } from "./types.js";

export class ConsoleAuditLogger implements AuditLogger {
  async logTurn(record: AuditRecord): Promise<void> {
    console.log(`[audit] ${record.userId} turn=${record.turnNumber} tools=${record.toolCalls.length} duration=${record.durationMs}ms`);
  }
}
