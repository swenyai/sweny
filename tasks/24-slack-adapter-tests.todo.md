# Task 24 — Tests for Slack Channel Adapter

## Objective

Add tests for `slackChannel()` — the Slack adapter implementing the `Channel` interface. Hard to fully unit-test due to Bolt dependency, but we can test the factory, formatter, and message-handling logic.

## File Under Test

`packages/agent/src/channel/slack.ts` (154 lines)

### Key Exports

- `slackChannel(config): Channel` — factory that wraps `@slack/bolt`'s `App`
- Config: `{ appToken, botToken, signingSecret }`

### Channel Interface (from `packages/agent/src/channel/types.ts`)

```ts
interface Channel {
  name: string;                    // "slack"
  formatHint: string;              // "slack-mrkdwn"
  formatResponse(text: string): string[];  // splits on 3000-char Slack limit
  sendMessage(conversation: ConversationRef, text: string): Promise<SentMessage>;
  editMessage?(message: SentMessage, text: string): Promise<void>;
  start(handler: (msg: IncomingMessage) => Promise<void>): Promise<() => Promise<void>>;
  registerLoginUI?(authProvider: AuthProvider): void;
  registerCommands?(commands: ChannelCommand[]): void;
}
```

### Supporting Files

- `packages/agent/src/channel/slack-formatter.ts` — `formatSlackResponse(text: string): string[]` (chunking logic)
- `packages/agent/src/channel/slack-login.ts` — Slack login modal registration

## Test File

`packages/agent/tests/channel/slack.test.ts`

## Test Cases

### Factory & properties
1. `slackChannel()` returns object with `name === "slack"`
2. `formatHint === "slack-mrkdwn"`

### formatResponse (chunking)
3. Short text (<3000 chars) → returns single-element array
4. Long text (>3000 chars) → splits into multiple chunks
5. Empty text → returns `[""]` or `[]`

### Mock strategy for Bolt

Mock `@slack/bolt` so the `App` constructor doesn't actually connect:
```ts
vi.mock("@slack/bolt", () => ({
  App: vi.fn(() => ({
    event: vi.fn(),
    command: vi.fn(),
    action: vi.fn(),
    start: vi.fn(async () => {}),
    client: {
      chat: { postMessage: vi.fn(), update: vi.fn() },
      views: { open: vi.fn() },
    },
  })),
}));
```

### sendMessage
4. Calls `client.chat.postMessage` with correct channel and text
5. Returns `SentMessage` with correct refs

### editMessage
6. Calls `client.chat.update` with correct channel, ts, and text

### start
7. Returns a teardown function
8. Registers event handlers on `app.event("message", ...)`

## Verification

1. `npm test --workspace=packages/agent` — new tests pass
2. `npm test` — all tests pass
