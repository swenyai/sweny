# Refactor Entry Points and Config

## Context
Wire everything together: make the main entry point channel-agnostic, update config to support multiple channels, delete the old `src/slack/` directory.

## Dependencies
- ALL previous tasks (07-12) must be complete

## Files to Modify

### `packages/agent/src/config/types.ts`
Read first, then add:
- `channels?: Channel[]` to SwenyConfig
- Keep `slack?` for backward compatibility (deprecated)

### `packages/agent/src/config/schema.ts`
Read first, then:
- Make Slack env vars fully optional (remove startsWith("xapp-") and startsWith("xoxb-") validation that assumes Slack is always present)
- These should only be validated when a Slack channel is actually configured

### `packages/agent/src/config/loader.ts`
Read first, then:
- Remove the automatic Slack token merging (the lines that do `sweny.slack.appToken ??= env.slackAppToken`)
- If `config.channels` is not set and Slack env vars are present, auto-construct a Slack channel for backward compat

### `packages/agent/src/index.ts` — REWRITE
Read the current file first. The new entry point:
1. Load config (same as before)
2. Build shared deps: storage, plugins, session manager, claude runner, etc. (same as before)
3. Resolve channels: use `config.channels` if set, else auto-detect from config.slack / env vars
4. Create standard commands (createStandardCommands from channel/slack-commands.ts)
5. For each channel:
   - Call channel.registerLoginUI?.(authProvider)
   - Call channel.registerCommands?.(commands)
   - Create Orchestrator(channel, deps)
   - Call channel.start(msg => orchestrator.handleMessage(msg))
   - Collect teardown functions
6. Start health server
7. Graceful shutdown: call all teardowns

### `packages/agent/src/cli.ts` — REWRITE
Read the current file first. New version:
1. Load config
2. Build shared deps (similar to index.ts but simpler — no Slack needed)
3. Create cliChannel()
4. Create standard commands, register them
5. Create Orchestrator(channel, deps)
6. Start channel
7. Handle SIGINT

### Delete `packages/agent/src/slack/` directory
After the new channel adapters are working, delete all 5 files:
- `src/slack/app.ts`
- `src/slack/commands.ts`
- `src/slack/event-handler.ts`
- `src/slack/formatter.ts`
- `src/slack/modals.ts`

### Update `packages/agent/src/channel/index.ts`
Export the Slack and CLI channel factories alongside the types.

## Verification
- `npm run typecheck --workspace=packages/agent` passes
- `npm test --workspace=packages/agent` passes
- No imports reference `src/slack/` anymore (use grep to verify)
