---
title: Agent Configuration
description: Configure the SWEny agent with sweny.config.ts and environment variables.
---

The agent is configured through a `sweny.config.ts` file in your project root and environment variables. The config file defines plugins, storage, auth, and model settings. Environment variables provide secrets and runtime overrides.

## sweny.config.ts

```typescript
import { defineConfig } from "@sweny/agent";
import { noAuth } from "@sweny/providers/auth";
import { fsStorage } from "@sweny/providers/storage";
import { allowAllGuard } from "@sweny/providers/access";
import { memoryPlugin, workspacePlugin } from "@sweny/agent";

export default defineConfig({
  name: "my-agent",
  auth: noAuth(),
  storage: fsStorage({ baseDir: "./.sweny-data" }),
  accessGuard: allowAllGuard(),
  plugins: [memoryPlugin(), workspacePlugin()],
  model: {
    maxTurns: 25,
    disallowedTools: [],
  },
  rateLimit: {
    maxPerMinute: 10,
    maxPerHour: 100,
  },
  logLevel: "info",
});
```

## SwenyConfig reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | `"sweny-agent"` | Agent display name, used in system prompt |
| `auth` | `AuthProvider` | `noAuth()` | Authentication provider ([docs](/providers/auth/)) |
| `storage` | `StorageProvider` | (required) | Session, memory, and workspace backend ([docs](/providers/storage/)) |
| `accessGuard` | `AccessGuard` | `allowAllGuard()` | Access control policy ([docs](/providers/access/)) |
| `plugins` | `ToolPlugin[]` | `[]` | Tool plugins to register ([docs](/agent/plugins/)) |
| `systemPrompt` | `string` | (built-in default) | Custom base system prompt |
| `model.maxTurns` | `number` | `20` | Max agent turns per user message |
| `model.disallowedTools` | `string[]` | `[]` | Additional tools to deny beyond the default guard |
| `slack.appToken` | `string` | from env | Slack app-level token (`xapp-...`) |
| `slack.botToken` | `string` | from env | Slack bot token (`xoxb-...`) |
| `slack.signingSecret` | `string` | from env | Slack signing secret |
| `rateLimit.maxPerMinute` | `number` | (unlimited) | Per-user rate limit per minute |
| `rateLimit.maxPerHour` | `number` | (unlimited) | Per-user rate limit per hour |
| `audit` | `AuditLogger` | console logger | Audit log backend |
| `healthPort` | `number` | `3000` | Health check HTTP port |
| `logLevel` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | Log verbosity |
| `allowedUsers` | `string[]` | `[]` (all allowed) | Slack user IDs allowed to interact |

### defineConfig()

A type-only helper that returns its argument unchanged. It provides TypeScript autocomplete in your config file:

```typescript
import { defineConfig } from "@sweny/agent";

export default defineConfig({
  // IDE autocomplete works here
});
```

## Environment variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude API key | One of these two |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude OAuth token | must be set |
| `SLACK_APP_TOKEN` | Slack app-level token (`xapp-...`) | Yes (Slack mode) |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) | Yes (Slack mode) |
| `SLACK_SIGNING_SECRET` | Slack signing secret | Yes (Slack mode) |
| `LOG_LEVEL` | Log verbosity (`debug`, `info`, `warn`, `error`) | No (defaults to `info`) |

Environment variables are validated with Zod on startup. At least one of `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` must be set, or the agent will fail to start. Slack tokens are validated for their expected prefixes (`xapp-`, `xoxb-`).

Create a `.env` file in your project root:

```bash
ANTHROPIC_API_KEY=sk-ant-...
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

## Config resolution

The config loader merges file and environment settings:

1. `loadConfig()` looks for `sweny.config.ts` in the current directory (or a custom path)
2. If the file is missing or fails to import, a default config is used
3. Environment variables fill in Slack tokens and log level **only when not set** in the config file (config file takes priority)
4. Zod schema validation runs and fails fast with clear error messages if required values are missing

## CLI mode

The CLI uses the same config file. Slack tokens are not required when running in CLI mode:

```bash
npx tsx --env-file=.env src/cli.ts
```

Available commands in the REPL:

| Command | Description |
|---------|-------------|
| `/quit`, `/exit` | Exit the CLI |
| `/reset` | Clear the current session |
| `/memory` | Show saved memories |
| `/memory clear` | Clear all memories |
| `/workspace` | Show workspace files |
| `/workspace reset` | Clear the workspace |
| `/help` | List commands |
