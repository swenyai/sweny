---
title: Agent Configuration
description: Configure the SWEny agent with sweny.config.ts and environment variables.
---

:::note[Self-hosted agent]
This page is for teams running the **`@sweny-ai/agent`** package — a self-hosted Slack bot powered by SWEny. If you're using the **GitHub Action** (`swenyai/sweny@v1`) or the **CLI** (`@sweny-ai/cli`), you can skip this section.
:::

The agent is configured through a `sweny.config.ts` file in your project root and environment variables.

## sweny.config.ts

```typescript
import { defineConfig } from "@sweny-ai/agent";
import { noAuth } from "@sweny-ai/providers/auth";
import { fsStorage } from "@sweny-ai/providers/storage";
import { allowAllGuard } from "@sweny-ai/providers/access";
import { memoryPlugin, workspacePlugin } from "@sweny-ai/agent";

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
| `healthPort` | `number` | `3000` | Health check HTTP port |
| `logLevel` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | Log verbosity |
| `allowedUsers` | `string[]` | `[]` (all allowed) | Slack user IDs allowed to interact |

## Environment variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude API key | One of these two |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude OAuth token | must be set |
| `SLACK_APP_TOKEN` | Slack app-level token (`xapp-...`) | Yes (Slack mode) |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) | Yes (Slack mode) |
| `SLACK_SIGNING_SECRET` | Slack signing secret | Yes (Slack mode) |
| `LOG_LEVEL` | Log verbosity (`debug`, `info`, `warn`, `error`) | No (defaults to `info`) |

Create a `.env` file in your project root:

```bash
ANTHROPIC_API_KEY=sk-ant-...
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```
