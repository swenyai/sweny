import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { OrchestratorDeps } from "../src/orchestrator.js";
import type { Channel, IncomingMessage, SentMessage, ConversationRef } from "../src/channel/types.js";
import type { AuthProvider, UserIdentity } from "../src/auth/types.js";
import type { AccessGuard } from "../src/access/types.js";
import { AccessLevel, AccessDeniedError } from "../src/access/types.js";
import type { SessionManager, Session } from "../src/session/manager.js";
import type { AgentRunner } from "../src/runner/types.js";
import type { RunResult } from "../src/model/types.js";
import type { MemoryStore } from "../src/storage/memory/types.js";
import type { AuditLogger } from "../src/audit/types.js";
import type { RateLimiter } from "../src/rate-limit.js";
import type { Logger } from "../src/logger.js";

function makeConversation(): ConversationRef {
  return { conversationId: "ch-1", messageId: "msg-1" };
}

function makeMessage(overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    userId: "user-1",
    text: "Hello agent",
    conversation: makeConversation(),
    ...overrides,
  };
}

function makeIdentity(overrides?: Partial<UserIdentity>): UserIdentity {
  return {
    userId: "user-1",
    displayName: "Test User",
    email: "test@example.com",
    roles: ["user"],
    metadata: {},
    ...overrides,
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    threadKey: "ch-1-msg-1",
    agentSessionId: null,
    userId: "user-1",
    createdAt: new Date(),
    lastActiveAt: new Date(),
    messageCount: 0,
    ...overrides,
  };
}

function makeRunResult(overrides?: Partial<RunResult>): RunResult {
  return {
    response: "Here is the answer.",
    sessionId: "session-abc",
    toolCalls: [],
    ...overrides,
  };
}

function makeSentMessage(overrides?: Partial<SentMessage>): SentMessage {
  return {
    ref: makeConversation(),
    platformMessageId: "plat-msg-1",
    ...overrides,
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeChannel(overrides?: Partial<Channel>): Channel {
  return {
    name: "test",
    formatHint: "plaintext",
    formatResponse: vi.fn((text: string) => [text]),
    sendMessage: vi.fn(async () => makeSentMessage()),
    editMessage: vi.fn(async () => {}),
    start: vi.fn(async () => async () => {}),
    ...overrides,
  };
}

function makeAuthProvider(overrides?: Partial<AuthProvider>): AuthProvider {
  return {
    displayName: "test-auth",
    authenticate: vi.fn(async () => makeIdentity()),
    hasValidSession: vi.fn(async () => true),
    clearSession: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeAccessGuard(overrides?: Partial<AccessGuard>): AccessGuard {
  return {
    resolveAccessLevel: vi.fn(() => AccessLevel.READ_WRITE),
    assertNotForbidden: vi.fn(),
    assertCanQuery: vi.fn(),
    assertCanMutate: vi.fn(),
    ...overrides,
  };
}

function makeSessionManager(session?: Session): SessionManager {
  const s = session ?? makeSession();
  return {
    getOrCreateAsync: vi.fn(async () => s),
    getOrCreate: vi.fn(() => s),
    persist: vi.fn(),
    appendTranscript: vi.fn(),
    get: vi.fn(() => s),
    getTranscript: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    clear: vi.fn(),
    clearAllForUser: vi.fn(),
    destroy: vi.fn(),
  } as unknown as SessionManager;
}

function makeRunner(result?: RunResult): AgentRunner {
  return {
    run: vi.fn(async () => result ?? makeRunResult()),
  };
}

function makeMemoryStore(): MemoryStore {
  return {
    getMemories: vi.fn(async () => ({ entries: [{ id: "m1", text: "Remember this", createdAt: "2025-01-01T00:00:00Z" }] })),
    addEntry: vi.fn(async () => ({ id: "m2", text: "", createdAt: "" })),
    removeEntry: vi.fn(async () => true),
    clearMemories: vi.fn(async () => {}),
  };
}

function makeAuditLogger(): AuditLogger {
  return {
    logTurn: vi.fn(async () => {}),
  };
}

function makeRateLimiter(allowed = true, retryAfterSeconds = 30): RateLimiter {
  return {
    check: vi.fn(() => (allowed ? { allowed: true } : { allowed: false, retryAfterSeconds })),
  } as unknown as RateLimiter;
}

function buildDeps(overrides?: Partial<OrchestratorDeps>): OrchestratorDeps {
  return {
    authProvider: makeAuthProvider(),
    sessionManager: makeSessionManager(),
    runner: makeRunner(),
    memoryStore: makeMemoryStore(),
    auditLogger: makeAuditLogger(),
    rateLimiter: makeRateLimiter(),
    accessGuard: makeAccessGuard(),
    logger: makeLogger(),
    ...overrides,
  };
}

describe("Orchestrator", () => {
  let channel: Channel;
  let deps: OrchestratorDeps;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    channel = makeChannel();
    deps = buildDeps();
    orchestrator = new Orchestrator(channel, deps);
  });

  describe("successful flow", () => {
    it("runs the full pipeline: auth, access, session, claude, response", async () => {
      await orchestrator.handleMessage(makeMessage());

      expect(deps.authProvider.authenticate).toHaveBeenCalledWith("user-1");
      expect(deps.accessGuard.assertCanQuery).toHaveBeenCalled();
      expect(deps.sessionManager.getOrCreateAsync).toHaveBeenCalledWith("ch-1-msg-1", "user-1");
      expect((deps.runner as any).run).toHaveBeenCalled();
      expect(channel.editMessage).toHaveBeenCalled();
    });

    it("passes formatHint from channel to claude runner", async () => {
      channel = makeChannel({ formatHint: "slack-mrkdwn" });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      const runCall = (deps.runner as any).run.mock.calls[0][0];
      expect(runCall.formatHint).toBe("slack-mrkdwn");
    });
  });

  describe("auth failure", () => {
    it("sends error response when user is not authenticated", async () => {
      deps = buildDeps({
        authProvider: makeAuthProvider({ authenticate: vi.fn(async () => null) }),
      });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(channel.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: "ch-1" }),
        "Authentication required.",
      );
      expect((deps.runner as any).run).not.toHaveBeenCalled();
    });

    it("mentions /login when loginFields exist", async () => {
      deps = buildDeps({
        authProvider: makeAuthProvider({
          authenticate: vi.fn(async () => null),
          loginFields: [{ key: "token", label: "Token", type: "text" }],
        }),
      });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(channel.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        "Please use `/login` first to authenticate.",
      );
    });
  });

  describe("access denied", () => {
    it("sends error response when user is forbidden", async () => {
      deps = buildDeps({
        accessGuard: makeAccessGuard({
          assertCanQuery: vi.fn(() => {
            throw new AccessDeniedError("Forbidden");
          }),
        }),
      });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(channel.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        "Your account does not have access to this assistant.",
      );
      expect((deps.runner as any).run).not.toHaveBeenCalled();
    });
  });

  describe("rate limited", () => {
    it("sends rate limit error with retry seconds", async () => {
      deps = buildDeps({ rateLimiter: makeRateLimiter(false, 42) });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(channel.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        "You've sent too many requests. Please wait 42s before trying again.",
      );
      expect(deps.authProvider.authenticate).not.toHaveBeenCalled();
    });
  });

  describe("claude error", () => {
    it("edits thinking message with error text when claude runner throws", async () => {
      deps = buildDeps({
        runner: makeRunner(),
      });
      (deps.runner as any).run = vi.fn(async () => {
        throw new Error("Model unavailable");
      });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(channel.editMessage).toHaveBeenCalledWith(
        expect.objectContaining({ platformMessageId: "plat-msg-1" }),
        "Something went wrong: Model unavailable",
      );
    });

    it("sends error via sendMessage when editMessage is not available", async () => {
      channel = makeChannel({ editMessage: undefined });
      deps = buildDeps({
        runner: makeRunner(),
      });
      (deps.runner as any).run = vi.fn(async () => {
        throw new Error("Model unavailable");
      });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      // First call is "Looking into this...", second is error
      const calls = (channel.sendMessage as any).mock.calls;
      expect(calls.length).toBe(2);
      expect(calls[1][1]).toBe("Something went wrong: Model unavailable");
    });
  });

  describe("response chunking", () => {
    it("edits first chunk and sends remaining chunks as new messages", async () => {
      channel = makeChannel({
        formatResponse: vi.fn(() => ["chunk-1", "chunk-2", "chunk-3"]),
      });
      deps = buildDeps();
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(channel.editMessage).toHaveBeenCalledWith(
        expect.objectContaining({ platformMessageId: "plat-msg-1" }),
        "chunk-1",
      );
      // Two additional sendMessage calls for chunks 2 and 3
      // sendMessage is called first for "thinking", then for chunk-2 and chunk-3
      const sendCalls = (channel.sendMessage as any).mock.calls;
      // First sendMessage is "Looking into this..."
      expect(sendCalls[0][1]).toBe("Looking into this...");
      expect(sendCalls[1][1]).toBe("chunk-2");
      expect(sendCalls[2][1]).toBe("chunk-3");
    });

    it("sends all chunks via sendMessage when editMessage is not available", async () => {
      channel = makeChannel({
        formatResponse: vi.fn(() => ["chunk-a", "chunk-b"]),
        editMessage: undefined,
      });
      deps = buildDeps();
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      const sendCalls = (channel.sendMessage as any).mock.calls;
      // First is "thinking", then chunk-a and chunk-b
      expect(sendCalls[0][1]).toBe("Looking into this...");
      expect(sendCalls[1][1]).toBe("chunk-a");
      expect(sendCalls[2][1]).toBe("chunk-b");
    });
  });

  describe("thread locking", () => {
    it("serializes concurrent messages on the same thread", async () => {
      const order: number[] = [];
      let resolveFirst: () => void;
      const firstBlocked = new Promise<void>((r) => { resolveFirst = r; });

      const runner = makeRunner();
      let callCount = 0;
      (runner as any).run = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          order.push(1);
          await firstBlocked;
          order.push(2);
        } else {
          order.push(3);
        }
        return makeRunResult();
      });

      deps = buildDeps({ runner });
      orchestrator = new Orchestrator(channel, deps);

      const msg = makeMessage();
      const p1 = orchestrator.handleMessage(msg);
      const p2 = orchestrator.handleMessage(msg);

      // Let the first call complete
      resolveFirst!();
      await Promise.all([p1, p2]);

      // Second call must wait for first to finish
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("audit logging", () => {
    it("logs audit record with correct fields", async () => {
      const auditLogger = makeAuditLogger();
      channel = makeChannel({ name: "slack" });
      deps = buildDeps({ auditLogger });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage({ text: "What is X?" }));

      expect(auditLogger.logTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-abc",
          threadKey: "ch-1-msg-1",
          conversationId: "ch-1",
          messageId: "msg-1",
          channelName: "slack",
          userId: "user-1",
          userEmail: "test@example.com",
          userMessage: "What is X?",
          assistantResponse: "Here is the answer.",
        }),
      );
    });

    it("does not throw when auditLogger is not provided", async () => {
      deps = buildDeps({ auditLogger: undefined });
      orchestrator = new Orchestrator(channel, deps);

      await expect(orchestrator.handleMessage(makeMessage())).resolves.not.toThrow();
    });
  });

  describe("allowed users filter", () => {
    it("rejects users not in allowedUsers list", async () => {
      deps = buildDeps({ allowedUsers: ["user-allowed"] });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage({ userId: "user-blocked" }));

      expect(channel.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        "Sorry, you don't have access to this bot yet.",
      );
      expect(deps.authProvider.authenticate).not.toHaveBeenCalled();
    });

    it("allows users in the allowedUsers list", async () => {
      deps = buildDeps({ allowedUsers: ["user-1"] });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(deps.authProvider.authenticate).toHaveBeenCalled();
      expect((deps.runner as any).run).toHaveBeenCalled();
    });

    it("allows all users when allowedUsers is empty", async () => {
      deps = buildDeps({ allowedUsers: [] });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(deps.authProvider.authenticate).toHaveBeenCalled();
    });

    it("allows all users when allowedUsers is undefined", async () => {
      deps = buildDeps({ allowedUsers: undefined });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(deps.authProvider.authenticate).toHaveBeenCalled();
    });
  });

  describe("memory loading", () => {
    it("passes memories to claude runner when memoryStore is provided", async () => {
      const memoryStore = makeMemoryStore();
      deps = buildDeps({ memoryStore });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(memoryStore.getMemories).toHaveBeenCalledWith("user-1");
      const runCall = (deps.runner as any).run.mock.calls[0][0];
      expect(runCall.memories).toEqual([{ id: "m1", text: "Remember this", createdAt: "2025-01-01T00:00:00Z" }]);
    });

    it("passes empty memories when memoryStore is not provided", async () => {
      deps = buildDeps({ memoryStore: undefined });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      const runCall = (deps.runner as any).run.mock.calls[0][0];
      expect(runCall.memories).toEqual([]);
    });
  });

  describe("session persistence", () => {
    it("persists session when claude returns a sessionId", async () => {
      const session = makeSession({ messageCount: 5 });
      deps = buildDeps({
        sessionManager: makeSessionManager(session),
        runner: makeRunner(makeRunResult({ sessionId: "new-session-id" })),
      });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(session.agentSessionId).toBe("new-session-id");
      expect(session.messageCount).toBe(6);
      expect(deps.sessionManager.persist).toHaveBeenCalledWith(session);
    });

    it("does not persist session when sessionId is null", async () => {
      deps = buildDeps({
        runner: makeRunner(makeRunResult({ sessionId: null })),
      });
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage());

      expect(deps.sessionManager.persist).not.toHaveBeenCalled();
    });

    it("appends transcript entries for user and assistant", async () => {
      deps = buildDeps();
      orchestrator = new Orchestrator(channel, deps);

      await orchestrator.handleMessage(makeMessage({ text: "Hello" }));

      const appendCalls = (deps.sessionManager.appendTranscript as any).mock.calls;
      expect(appendCalls).toHaveLength(2);
      expect(appendCalls[0][1].role).toBe("user");
      expect(appendCalls[0][1].text).toBe("Hello");
      expect(appendCalls[1][1].role).toBe("assistant");
      expect(appendCalls[1][1].text).toBe("Here is the answer.");
    });
  });
});
