# WIP 2 — Where We Left Off

## Completed This Session

### Channel Abstraction (Tasks 07–14) — DONE
Refactored the agent from Slack-only to channel-agnostic. Any messaging transport (Slack, Discord, Telegram, WebSocket, webhook, CLI) can now plug in via the `Channel` interface.

- **Channel interface** (`src/channel/types.ts`) — `Channel`, `ConversationRef`, `IncomingMessage`, `SentMessage`, `ChannelCommand`
- **Orchestrator** (`src/orchestrator.ts`) — generic message pipeline extracted from Slack event handler (auth → access → rate limit → session → memories → runner → persist → audit → respond)
- **Slack adapter** (`src/channel/slack.ts`) — `slackChannel(config)` factory wrapping @slack/bolt
- **CLI adapter** (`src/channel/cli.ts`) — `cliChannel()` factory for terminal REPL
- **Entry points rewritten** — `src/index.ts` and `src/cli.ts` are now channel-agnostic
- **`src/slack/` directory deleted** — 5 files superseded by `src/channel/`
- **Config updated** — `channels?: Channel[]` field added, Slack auto-detected from env vars for backward compat
- **Audit schema generalized** — `channelId` → `conversationId`, `threadTs` → `messageId`, added `channelName`
- **System prompt channel-aware** — `formatHint` drives formatting instructions dynamically

### Test Counts
- **agent**: 120 tests (10 files) — all passing
- **providers**: 211 tests (18 files) — all passing
- **action**: 12 tests (2 files) — all passing
- **Total**: 343 tests, zero failures

### All 14 Task Files
Located in `tasks/` — all renamed to `*.done.md`.

## What's Next — AgentRunner Interface Extraction

**Plan approved, not yet implemented.** The Orchestrator currently depends on the concrete `ClaudeRunner` class. Extract an `AgentRunner` interface so the Orchestrator depends on an abstraction.

### Files to create/modify:
1. **Create** `src/runner/types.ts` — `AgentRunner` interface + `AgentRunOpts` type
2. **Create** `src/runner/index.ts` — barrel exports
3. **Move** `src/claude/runner.ts` → `src/runner/claude.ts` — `ClaudeRunner implements AgentRunner`
4. **Modify** `src/orchestrator.ts` — `OrchestratorDeps.claudeRunner` → `OrchestratorDeps.runner: AgentRunner`
5. **Modify** `src/index.ts` + `src/cli.ts` — update import paths + field names
6. **Modify** `tests/orchestrator.test.ts` — use `AgentRunner` type, rename mock helpers

### Design rationale:
- Follows existing patterns: `AuthProvider`, `AccessGuard`, `Channel`, `ModelRunner` are all interfaces
- Two abstraction layers: `ModelRunner` (low-level SDK calls) and `AgentRunner` (high-level: prompt + plugins + model)
- `ClaudeRunner` becomes one implementation of `AgentRunner`
- `src/claude/` retains `system-prompt.ts` and `tool-guard.ts` as Claude-specific internals

### Full plan at:
`.claude/plans/rosy-foraging-valiant.md`
