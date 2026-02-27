# Make System Prompt Channel-Aware

## Context
The system prompt in `packages/agent/src/claude/system-prompt.ts` has hardcoded "Format your responses for Slack using Slack's mrkdwn syntax". This needs to become dynamic based on which channel is active.

## Files to Modify

### `packages/agent/src/claude/system-prompt.ts`
1. Read the file first to understand the current structure
2. Add `formatHint?: string` to `SystemPromptOpts` (or whatever the options interface is called)
3. Create a FORMAT_HINTS map:
```typescript
const FORMAT_HINTS: Record<string, string> = {
  "slack-mrkdwn": "Format your responses for Slack using Slack's mrkdwn syntax. Use *bold* for emphasis, `code` for inline code, and ``` for code blocks.",
  "discord-markdown": "Format your responses using Discord markdown. Use **bold** for emphasis, `code` for inline code, and ``` for code blocks.",
  "plaintext": "Format your responses as plain text. Use simple indentation and dashes for lists.",
};
```
4. Split the DEFAULT_BASE_PROMPT: keep the core personality/behavior instructions, make the formatting section dynamic based on `formatHint`
5. When `formatHint` is provided and exists in FORMAT_HINTS, use it. Otherwise fall back to the current Slack formatting (backward compat).

### `packages/agent/src/claude/runner.ts`
1. Read the file to understand how it calls buildSystemPrompt/the system prompt builder
2. Add `formatHint?: string` to the run() options
3. Pass it through to the system prompt builder

## Verification
- `npm run typecheck --workspace=packages/agent` passes
- `npm test --workspace=packages/agent` passes (all 80 tests)
- The change is backward-compatible: without formatHint, behavior is identical to before
