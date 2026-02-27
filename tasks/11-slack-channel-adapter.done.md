# Create Slack Channel Adapter

## Context
Move existing Slack functionality from `packages/agent/src/slack/` into a Channel adapter at `packages/agent/src/channel/slack.ts` that implements the Channel interface.

## Dependencies
- Task 07 (Channel interface) must be complete
- Task 10 (Orchestrator) must be complete

## Files to Create

### `packages/agent/src/channel/slack.ts`
Factory: `slackChannel(config: SlackChannelConfig): Channel`

```typescript
export interface SlackChannelConfig {
  appToken: string;
  botToken: string;
  signingSecret: string;
}
```

Implementation:
- `name`: "slack"
- `formatHint`: "slack-mrkdwn"
- `formatResponse(text)`: delegate to slack-formatter.ts (the existing formatForSlack function)
- `sendMessage(conv, text)`: use `app.client.chat.postMessage({ channel: conv.conversationId, thread_ts: conv.messageId, text })`
- `editMessage(msg, text)`: use `app.client.chat.update({ channel: msg.ref.conversationId, ts: msg.platformMessageId, text })`
- `start(onMessage)`:
  - Create Bolt App with socketMode
  - Register `app.message()` and `app.event("app_mention")` handlers
  - Extract userId, text, ConversationRef from Slack events
  - Call `onMessage(msg)` for each
  - Call `app.start()`
  - Return teardown: `() => app.stop()`
- `registerLoginUI(authProvider)`: register the login modal (from existing modals.ts logic)
- `registerCommands(commands)`: register Bolt slash commands that delegate to ChannelCommand.execute

Read `src/slack/event-handler.ts`, `src/slack/app.ts`, `src/slack/commands.ts`, `src/slack/modals.ts`, and `src/slack/formatter.ts` to understand the existing implementations.

### `packages/agent/src/channel/slack-formatter.ts`
Move `formatForSlack` function from `src/slack/formatter.ts`. Keep the same logic (3000 char chunking, split at \n\n then \n then space).

### `packages/agent/src/channel/slack-commands.ts`
Create factory that returns standard ChannelCommand[] for /new and /memory:

```typescript
export function createStandardCommands(
  sessionManager: SessionManager,
  memoryStore?: MemoryStore,
): ChannelCommand[]
```

Extract the command logic from `src/slack/commands.ts` into generic ChannelCommand objects.

### `packages/agent/src/channel/slack-login.ts`
Extract the login modal registration from `src/slack/modals.ts`. This is Slack-specific (Block Kit) but called via the optional `registerLoginUI` method.

## Verification
- `npm run typecheck --workspace=packages/agent` passes
- The Slack adapter preserves all existing functionality
