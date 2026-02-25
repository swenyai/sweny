import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AuditLogger, AuditRecord } from "./types.js";

export class FsAuditLogger implements AuditLogger {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async logTurn(record: AuditRecord): Promise<void> {
    const date = record.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = join(
      this.baseDir,
      "users",
      record.userId,
      "conversations",
      date,
      record.threadKey,
      `${record.turnNumber}.jsonl`,
    );

    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
  }
}
