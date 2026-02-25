import type { App } from "@slack/bolt";
import type { AuthProvider } from "../auth/types.js";
import type { SessionManager } from "../session/manager.js";
import type { ClaudeRunner } from "../claude/runner.js";
import type { MemoryStore } from "../storage/memory/types.js";
import type { AuditLogger } from "../audit/types.js";
import type { AccessGuard } from "../access/types.js";
import { AccessLevel } from "../access/types.js";
import { formatForSlack } from "./formatter.js";
import type { RateLimiter } from "../rate-limit.js";
import type { TranscriptEntry } from "../storage/session/types.js";

interface HandlerDeps {
  authProvider: AuthProvider;
  sessionManager: SessionManager;
  claudeRunner: ClaudeRunner;
  memoryStore: MemoryStore;
  auditLogger: AuditLogger;
  rateLimiter: RateLimiter;
  accessGuard: AccessGuard;
  allowedUsers: string[];
}

const threadLocks = new Map<string, Promise<void>>();

async function withThreadLock(threadKey: string, fn: () => Promise<void>): Promise<void> {
  const prev = threadLocks.get(threadKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  threadLocks.set(threadKey, next);
  await next;
}

export function registerEventHandlers(app: App, deps: HandlerDeps): void {
  const { authProvider, sessionManager, claudeRunner, memoryStore, auditLogger, rateLimiter, accessGuard, allowedUsers } = deps;

  async function handleMessage(
    userId: string,
    channelId: string,
    text: string,
    threadTs: string,
    say: (msg: { text: string; thread_ts: string }) => Promise<unknown>,
    update: (msg: { channel: string; ts: string; text: string }) => Promise<unknown>,
  ): Promise<void> {
    if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
      await say({ text: "Sorry, you don't have access to this bot yet.", thread_ts: threadTs });
      return;
    }

    const rateCheck = rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      await say({
        text: `You've sent too many requests. Please wait ${rateCheck.retryAfterSeconds}s before trying again.`,
        thread_ts: threadTs,
      });
      return;
    }

    const identity = await authProvider.authenticate(userId);
    if (!identity) {
      const loginCmd = authProvider.loginFields ? "Please use `/login` first to authenticate." : "Authentication required.";
      await say({ text: loginCmd, thread_ts: threadTs });
      return;
    }

    const level = accessGuard.resolveAccessLevel(identity);
    if (level === AccessLevel.FORBIDDEN) {
      await say({
        text: "Your account does not have access to this assistant.",
        thread_ts: threadTs,
      });
      return;
    }

    const threadKey = `${channelId}-${threadTs}`;

    await withThreadLock(threadKey, async () => {
      const thinkingResult = (await say({
        text: "Looking into this...",
        thread_ts: threadTs,
      })) as { ts?: string };
      const thinkingTs = thinkingResult?.ts;

      try {
        const session = await sessionManager.getOrCreateAsync(threadKey, userId);
        const memories = await memoryStore.getMemories(userId);

        const startTime = Date.now();
        const result = await claudeRunner.run({
          prompt: text,
          session,
          user: identity,
          memories: memories.entries,
        });
        const durationMs = Date.now() - startTime;

        if (result.sessionId) {
          session.claudeSessionId = result.sessionId;
          session.lastActiveAt = new Date();
          session.messageCount++;
          sessionManager.persist(session);
        }

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

        const chunks = formatForSlack(result.response);

        if (thinkingTs && chunks.length > 0) {
          await update({ channel: channelId, ts: thinkingTs, text: chunks[0]! });
          for (let i = 1; i < chunks.length; i++) {
            await say({ text: chunks[i]!, thread_ts: threadTs });
          }
        } else {
          for (const chunk of chunks) {
            await say({ text: chunk, thread_ts: threadTs });
          }
        }

        auditLogger
          .logTurn({
            sessionId: result.sessionId ?? "unknown",
            threadKey,
            channelId,
            threadTs,
            userId,
            userEmail: identity.email,
            turnNumber: session.messageCount,
            userMessage: text,
            assistantResponse: result.response,
            toolCalls: result.toolCalls,
            durationMs,
            timestamp: new Date().toISOString(),
          })
          .catch((err) => console.error("[audit] Failed to log turn:", err));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[handler] Claude run failed:", err);

        const errorText = `Something went wrong: ${message}`;
        if (thinkingTs) {
          await update({ channel: channelId, ts: thinkingTs, text: errorText });
        } else {
          await say({ text: errorText, thread_ts: threadTs });
        }
      }
    });
  }

  app.message(async ({ message, say, client }) => {
    if (message.subtype) return;
    if (!("text" in message) || !message.text) return;
    if (!("user" in message) || !message.user) return;

    const threadTs = ("thread_ts" in message ? message.thread_ts : message.ts) ?? message.ts;

    await handleMessage(
      message.user,
      message.channel,
      message.text,
      threadTs,
      say as (msg: { text: string; thread_ts: string }) => Promise<unknown>,
      (msg) => client.chat.update(msg),
    );
  });

  app.event("app_mention", async ({ event, say, client }) => {
    if (!event.text || !event.user) return;

    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) return;

    const threadTs = event.thread_ts ?? event.ts;

    await handleMessage(
      event.user,
      event.channel,
      text,
      threadTs,
      say as (msg: { text: string; thread_ts: string }) => Promise<unknown>,
      (msg) => client.chat.update(msg),
    );
  });
}
