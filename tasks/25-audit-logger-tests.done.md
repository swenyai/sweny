# Task 25 — Tests for Audit Loggers (Console + FS)

## Objective

Add tests for `ConsoleAuditLogger` and `FsAuditLogger`. Both are simple but untested.

## Files Under Test

### 1. `packages/agent/src/audit/console.ts` (7 lines)

```ts
export class ConsoleAuditLogger implements AuditLogger {
  async logTurn(record: AuditRecord): Promise<void> {
    console.log(`[audit] ${record.userId} turn=${record.turnNumber} tools=${record.toolCalls.length} duration=${record.durationMs}ms`);
  }
}
```

### 2. `packages/agent/src/audit/fs.ts` (27 lines)

```ts
export class FsAuditLogger implements AuditLogger {
  constructor(baseDir: string) { this.baseDir = baseDir; }

  async logTurn(record: AuditRecord): Promise<void> {
    const date = record.timestamp.slice(0, 10);
    const filePath = join(baseDir, "users", record.userId, "conversations", date, record.threadKey, `${record.turnNumber}.jsonl`);
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
  }
}
```

### AuditRecord Type (`packages/agent/src/audit/types.ts`)

```ts
interface AuditRecord {
  sessionId: string;
  threadKey: string;
  conversationId: string;
  messageId: string;
  channelName: string;
  userId: string;
  userEmail?: string;
  turnNumber: number;
  userMessage: string;
  assistantResponse: string;
  toolCalls: { toolName: string; toolInput: Record<string, unknown>; executedAt: string }[];
  durationMs: number;
  timestamp: string;
}
```

## Test File

`packages/agent/tests/audit/loggers.test.ts`

## Test Cases

### ConsoleAuditLogger
1. `logTurn` calls `console.log` with formatted string containing userId, turnNumber, tool count, duration
2. Includes correct values from the record
3. Returns a resolved promise (async interface)

### FsAuditLogger
4. Creates correct directory path from record fields: `baseDir/users/{userId}/conversations/{date}/{threadKey}/`
5. Writes JSON record followed by newline to `{turnNumber}.jsonl`
6. Creates parent directories recursively
7. Appends (not overwrites) to file

## Mock Strategy

- Console: spy on `console.log` with `vi.spyOn(console, "log")`
- FS: Use a real temp directory (`fs.mkdtempSync`) — the FsAuditLogger is simple enough for real FS tests. OR mock `node:fs/promises`.

## Verification

1. `npm test --workspace=packages/agent` — new tests pass
2. `npm test` — all tests pass
