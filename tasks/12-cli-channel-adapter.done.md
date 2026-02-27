# Create CLI Channel Adapter

## Context
Refactor the existing `packages/agent/src/cli.ts` into a Channel adapter so CLI mode uses the same orchestration pipeline as Slack.

## Dependencies
- Task 07 (Channel interface) must be complete

## Files to Create

### `packages/agent/src/channel/cli.ts`
Factory: `cliChannel(config?: CliChannelConfig): Channel`

```typescript
export interface CliChannelConfig {
  prompt?: string;  // default: "you> "
}
```

Implementation:
- `name`: "cli"
- `formatHint`: "plaintext"
- `formatResponse(text)`: return `[text]` (no chunking for terminal)
- `sendMessage(conv, text)`: write to stdout, return SentMessage
- No `editMessage` (omit — it's optional)
- `start(onMessage)`:
  - Create readline interface
  - On each line: if starts with "/" check registered commands first, else call `onMessage`
  - Handle special inputs: "/quit" exits, empty lines skipped
  - Return teardown that closes readline
- `registerCommands(commands)`: store commands, dispatch "/" prefixed input to them

Read the existing `src/cli.ts` to understand the current CLI flow and preserve its behavior.

### `packages/agent/tests/channel/cli.test.ts`
Test with mocked stdin/stdout (use Readable/Writable streams):
1. start() calls onMessage for user input
2. sendMessage writes to stdout
3. /quit triggers teardown
4. Registered commands are dispatched
5. Empty lines are skipped

## Verification
- `npm run typecheck --workspace=packages/agent` passes
- `npm test --workspace=packages/agent` passes
