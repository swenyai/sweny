import type { AuthProvider } from "./auth/types.js";
import type { SessionManager } from "./session/manager.js";
import type { AgentRunner } from "./runner/types.js";
import type { MemoryStore } from "./storage/memory/types.js";
import type { AuditLogger } from "./audit/types.js";
import type { AccessGuard } from "./access/types.js";
import { AccessDeniedError } from "./access/types.js";
import type { RateLimiter } from "./rate-limit.js";
import type { TranscriptEntry } from "./storage/session/types.js";
import type { Channel, IncomingMessage } from "./channel/types.js";
import type { Logger } from "./logger.js";

export interface OrchestratorDeps {
  authProvider: AuthProvider;
  sessionManager: SessionManager;
  runner: AgentRunner;
  memoryStore?: MemoryStore;
  auditLogger?: AuditLogger;
  rateLimiter?: RateLimiter;
  accessGuard: AccessGuard;
  allowedUsers?: string[];
  logger: Logger;
}

const threadLocks = new Map<string, Promise<void>>();

async function withThreadLock(threadKey: string, fn: () => Promise<void>): Promise<void> {
  const prev = threadLocks.get(threadKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  threadLocks.set(threadKey, next);
  await next;
}

export class Orchestrator {
  constructor(
    private channel: Channel,
    private deps: OrchestratorDeps,
  ) {}

  async handleMessage(msg: IncomingMessage): Promise<void> {
    const {
      authProvider,
      sessionManager,
      runner,
      memoryStore,
      auditLogger,
      rateLimiter,
      accessGuard,
      allowedUsers,
      logger,
    } = this.deps;
    const { userId, text, conversation } = msg;
    const { conversationId, messageId } = conversation;

    // Allowed users filter
    if (allowedUsers && allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
      await this.channel.sendMessage(conversation, "Sorry, you don't have access to this bot yet.");
      return;
    }

    // Rate limiting
    if (rateLimiter) {
      const rateCheck = rateLimiter.check(userId);
      if (!rateCheck.allowed) {
        await this.channel.sendMessage(
          conversation,
          `You've sent too many requests. Please wait ${rateCheck.retryAfterSeconds}s before trying again.`,
        );
        return;
      }
    }

    // Authentication
    const identity = await authProvider.authenticate(userId);
    if (!identity) {
      const loginCmd = authProvider.loginFields
        ? "Please use `/login` first to authenticate."
        : "Authentication required.";
      await this.channel.sendMessage(conversation, loginCmd);
      return;
    }

    // Access check
    try {
      accessGuard.assertCanQuery(identity);
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        await this.channel.sendMessage(conversation, "Your account does not have access to this assistant.");
        return;
      }
      throw err;
    }

    const threadKey = `${conversationId}-${messageId}`;

    await withThreadLock(threadKey, async () => {
      // Send "thinking" message
      const thinkingMessage = await this.channel.sendMessage(conversation, "Looking into this...");

      try {
        const session = await sessionManager.getOrCreateAsync(threadKey, userId);
        const memories = memoryStore ? await memoryStore.getMemories(userId) : { entries: [] };

        const startTime = Date.now();
        const result = await runner.run({
          prompt: text,
          session,
          user: identity,
          memories: memories.entries,
          formatHint: this.channel.formatHint,
        });
        const durationMs = Date.now() - startTime;

        // Persist session
        if (result.sessionId) {
          session.agentSessionId = result.sessionId;
          session.lastActiveAt = new Date();
          session.messageCount++;
          sessionManager.persist(session);
        }

        // Append transcript
        const userEntry: TranscriptEntry = {
          role: "user",
          text,
          timestamp: new Date().toISOString(),
        };
        const assistantEntry: TranscriptEntry = {
          role: "assistant",
          text: result.response,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
          timestamp: new Date().toISOString(),
        };
        sessionManager.appendTranscript(session, userEntry);
        sessionManager.appendTranscript(session, assistantEntry);

        // Format and deliver response
        const chunks = this.channel.formatResponse(result.response);

        if (this.channel.editMessage && chunks.length > 0) {
          await this.channel.editMessage(thinkingMessage, chunks[0]!);
          for (let i = 1; i < chunks.length; i++) {
            await this.channel.sendMessage(conversation, chunks[i]!);
          }
        } else {
          for (const chunk of chunks) {
            await this.channel.sendMessage(conversation, chunk);
          }
        }

        // Audit logging
        if (auditLogger) {
          auditLogger
            .logTurn({
              sessionId: result.sessionId ?? "unknown",
              threadKey,
              conversationId,
              messageId,
              channelName: this.channel.name,
              userId,
              userEmail: identity.email,
              turnNumber: session.messageCount,
              userMessage: text,
              assistantResponse: result.response,
              toolCalls: result.toolCalls,
              durationMs,
              timestamp: new Date().toISOString(),
            })
            .catch((err) => logger.error("[audit] Failed to log turn:", err));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("[orchestrator] Claude run failed:", err);

        const errorText = `Something went wrong: ${message}`;
        if (this.channel.editMessage) {
          await this.channel.editMessage(thinkingMessage, errorText);
        } else {
          await this.channel.sendMessage(conversation, errorText);
        }
      }
    });
  }
}
