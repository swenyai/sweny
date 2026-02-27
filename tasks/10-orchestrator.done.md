# Create Orchestrator

## Context
The core message handling pipeline lives in `packages/agent/src/slack/event-handler.ts` (lines ~36-158), mixed with Slack-specific I/O. This task extracts it into a platform-agnostic `Orchestrator` class that uses the Channel interface for all I/O.

## Dependencies
- Task 07 (Channel interface) must be complete
- Task 08 (generalized audit) must be complete
- Task 09 (channel-aware prompt) must be complete

## Files to Create

### `packages/agent/src/orchestrator.ts`

Extract from `src/slack/event-handler.ts` the generic pipeline:

1. **Thread locking** — the `withThreadLock` pattern (Map of promises per threadKey)
2. **Auth check** — `authProvider.authenticate(userId)`
3. **Access check** — `accessGuard.resolveAccessLevel(identity)`, `accessGuard.assertCanQuery(level)`
4. **Rate limiting** — `rateLimiter.check(userId)`
5. **Session management** — `sessionManager.getOrCreateAsync(threadKey, userId)`
6. **Memory loading** — `memoryStore?.getMemories(userId)`
7. **Claude invocation** — `claudeRunner.run(prompt, session, user, memories)` with `formatHint` from channel
8. **Response delivery** — use `channel.sendMessage()` and `channel.editMessage()` instead of Slack's `say()`/`update()`
9. **Response chunking** — use `channel.formatResponse()` instead of `formatForSlack()`
10. **Transcript** — `sessionManager.appendTranscript()`
11. **Audit logging** — `auditLogger.logTurn()` with generalized field names (conversationId, messageId, channelName from channel.name)

```typescript
export interface OrchestratorDeps {
  authProvider: AuthProvider;
  sessionManager: SessionManager;
  claudeRunner: ClaudeRunner;
  memoryStore?: MemoryStore;
  auditLogger?: AuditLogger;
  rateLimiter?: RateLimiter;
  accessGuard: AccessGuard;
  allowedUsers?: string[];
  logger: Logger;
}

export class Orchestrator {
  constructor(private channel: Channel, private deps: OrchestratorDeps) {}
  async handleMessage(msg: IncomingMessage): Promise<void> { /* pipeline */ }
}
```

Read `src/slack/event-handler.ts` carefully to extract the exact logic. The `handleIncomingMessage` inner function (or equivalent) contains the pipeline. Preserve error handling patterns (try/catch, error responses to user).

### `packages/agent/tests/orchestrator.test.ts`

Create tests with mock Channel + mock deps. Test cases:
1. Successful message flow (auth → access → session → claude → response)
2. Auth failure (user not authenticated → error response)
3. Access denied (forbidden user → error response)
4. Rate limited (over limit → error response with retry info)
5. Claude runner error (exception → error response)
6. Response chunking (long response → multiple sendMessage calls)
7. Edit message (first chunk edits "thinking" message, rest are new)
8. Thread locking (concurrent messages on same thread serialize)
9. Audit logging (verify record fields)
10. Allowed users filter (unlisted user rejected)
11. Memory loading (memories passed to claude runner)
12. Session persistence after successful run

## Verification
- `npm run typecheck --workspace=packages/agent` passes
- `npm test --workspace=packages/agent` passes (all existing 80 + new orchestrator tests)
