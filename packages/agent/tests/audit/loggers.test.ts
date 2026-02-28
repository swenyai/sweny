import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConsoleAuditLogger } from "../../src/audit/console.js";
import { FsAuditLogger } from "../../src/audit/fs.js";
import type { AuditRecord } from "../../src/audit/types.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeRecord(overrides?: Partial<AuditRecord>): AuditRecord {
  return {
    sessionId: "sess-1",
    threadKey: "thread-abc",
    conversationId: "conv-1",
    messageId: "msg-1",
    channelName: "test-channel",
    userId: "user-42",
    turnNumber: 3,
    userMessage: "hello",
    assistantResponse: "hi",
    toolCalls: [
      { toolName: "search", toolInput: { q: "test" }, executedAt: "2026-02-28T12:00:00Z" },
      { toolName: "fetch", toolInput: { url: "https://x.com" }, executedAt: "2026-02-28T12:00:01Z" },
    ],
    durationMs: 1500,
    timestamp: "2026-02-28T12:00:05Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ConsoleAuditLogger
// ---------------------------------------------------------------------------

describe("ConsoleAuditLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls console.log with formatted string", async () => {
    const logger = new ConsoleAuditLogger();
    const record = makeRecord();

    await logger.logTurn(record);

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith(
      "[audit] user-42 turn=3 tools=2 duration=1500ms",
    );
  });

  it("includes correct values from the record", async () => {
    const logger = new ConsoleAuditLogger();
    const record = makeRecord({
      userId: "alice",
      turnNumber: 7,
      toolCalls: [],
      durationMs: 250,
    });

    await logger.logTurn(record);

    expect(logSpy).toHaveBeenCalledWith(
      "[audit] alice turn=7 tools=0 duration=250ms",
    );
  });

  it("returns a resolved promise", async () => {
    const logger = new ConsoleAuditLogger();

    await expect(logger.logTurn(makeRecord())).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FsAuditLogger
// ---------------------------------------------------------------------------

describe("FsAuditLogger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "audit-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates correct directory path from record fields", async () => {
    const logger = new FsAuditLogger(tempDir);
    const record = makeRecord({
      userId: "user-42",
      timestamp: "2026-02-28T12:00:05Z",
      threadKey: "thread-abc",
      turnNumber: 3,
    });

    await logger.logTurn(record);

    const expectedPath = join(
      tempDir,
      "users",
      "user-42",
      "conversations",
      "2026-02-28",
      "thread-abc",
      "3.jsonl",
    );

    const content = readFileSync(expectedPath, "utf-8");
    expect(content).toBeTruthy();
  });

  it("writes JSON record followed by newline", async () => {
    const logger = new FsAuditLogger(tempDir);
    const record = makeRecord();

    await logger.logTurn(record);

    const filePath = join(
      tempDir,
      "users",
      record.userId,
      "conversations",
      "2026-02-28",
      record.threadKey,
      `${record.turnNumber}.jsonl`,
    );

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe(JSON.stringify(record) + "\n");
  });

  it("creates parent directories recursively", async () => {
    const logger = new FsAuditLogger(tempDir);
    const record = makeRecord({
      userId: "deep-user",
      threadKey: "deep-thread",
      timestamp: "2025-06-15T10:00:00Z",
    });

    // Should not throw even though the deeply nested directory doesn't exist
    await expect(logger.logTurn(record)).resolves.toBeUndefined();

    const filePath = join(
      tempDir,
      "users",
      "deep-user",
      "conversations",
      "2025-06-15",
      "deep-thread",
      `${record.turnNumber}.jsonl`,
    );

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("deep-user");
  });

  it("appends to file (does not overwrite)", async () => {
    const logger = new FsAuditLogger(tempDir);
    const record1 = makeRecord({ turnNumber: 1 });
    const record2 = makeRecord({ turnNumber: 1, userMessage: "second call" });

    // Both records share the same turnNumber so they go to the same file
    await logger.logTurn(record1);
    await logger.logTurn(record2);

    const filePath = join(
      tempDir,
      "users",
      record1.userId,
      "conversations",
      "2026-02-28",
      record1.threadKey,
      "1.jsonl",
    );

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).userMessage).toBe("hello");
    expect(JSON.parse(lines[1]).userMessage).toBe("second call");
  });
});
