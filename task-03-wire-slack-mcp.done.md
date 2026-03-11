# Task 03 — Wire `slackMCP` into CLI and Action as selectable notification provider

## Context

`slackMCP` is fully implemented in `packages/providers/src/notification/slack-mcp.ts`.
It satisfies `NotificationProvider` using the `@modelcontextprotocol/server-slack` MCP server.

The native `slackWebhook()` provider uses an incoming webhook URL. `slackMCP` uses an OAuth
bot token + workspace ID — a different auth model that some orgs prefer. Both satisfy the
same interface.

Neither CLI nor Action exposes `"slack-mcp"` as a notification option. New config fields
are required in both (the existing `notificationWebhookUrl` is not used by slackMCP).

## Config needed

`slackMCP` requires:
- `botToken` — Slack OAuth bot token (`xoxb-...`)
- `teamId` — Slack workspace/team ID
- `channel` — channel to post to (e.g. `#sweny-alerts`)

## Changes required

### 1. `packages/cli/src/config.ts`

Add fields to `CliConfig` interface:
```ts
slackBotToken: string;
slackTeamId: string;
slackChannel: string;
```

Add parsing in `parseCliInputs()` (find the notification section and add):
```ts
slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
slackTeamId: process.env.SLACK_TEAM_ID ?? "",
slackChannel: options.slackChannel ?? process.env.SLACK_CHANNEL ?? "",
```

Add CLI flag option in the option parser (find where `--notification-webhook-url` is defined):
```ts
.option("--slack-channel <channel>", "Slack channel for slack-mcp notification provider")
```

Add validation (find the notification validation block):
```ts
case "slack-mcp":
  if (!config.slackBotToken)
    errors.push("SLACK_BOT_TOKEN env var is required when notification-provider is slack-mcp");
  if (!config.slackTeamId)
    errors.push("SLACK_TEAM_ID env var is required when notification-provider is slack-mcp");
  if (!config.slackChannel)
    errors.push("--slack-channel is required when notification-provider is slack-mcp");
  break;
```

### 2. `packages/cli/src/providers/index.ts`

Add import:
```ts
import { ..., slackMCP } from "@sweny-ai/providers/notification";
```

Add case to `createProviders` notification switch:
```ts
case "slack-mcp":
  registry.set("notification", slackMCP({
    botToken: config.slackBotToken,
    teamId: config.slackTeamId,
    channel: config.slackChannel,
    logger,
  }));
  break;
```

### 3. `packages/action/src/config.ts`

Add fields to `ActionConfig` interface:
```ts
slackBotToken: string;
slackTeamId: string;
slackChannel: string;
```

Add parsing in `parseInputs()`:
```ts
slackBotToken: core.getInput("slack-bot-token"),
slackTeamId: core.getInput("slack-team-id"),
slackChannel: core.getInput("slack-channel"),
```

Add validation:
```ts
case "slack-mcp":
  if (!config.slackBotToken)
    errors.push("Missing required input: `slack-bot-token` is required when `notification-provider` is `slack-mcp`");
  if (!config.slackTeamId)
    errors.push("Missing required input: `slack-team-id` is required when `notification-provider` is `slack-mcp`");
  if (!config.slackChannel)
    errors.push("Missing required input: `slack-channel` is required when `notification-provider` is `slack-mcp`");
  break;
```

### 4. `packages/action/src/providers/index.ts`

Add import:
```ts
import { ..., slackMCP } from "@sweny-ai/providers/notification";
```

Add case:
```ts
case "slack-mcp":
  registry.set("notification", slackMCP({
    botToken: config.slackBotToken,
    teamId: config.slackTeamId,
    channel: config.slackChannel,
    logger: actionsLogger,
  }));
  break;
```

### 5. `packages/action/action.yml`

Add three new inputs to the inputs block (near the notification section):
```yaml
slack-bot-token:
  description: 'Slack OAuth bot token (xoxb-...) — required when notification-provider is slack-mcp'
  required: false
  default: ''
slack-team-id:
  description: 'Slack workspace/team ID — required when notification-provider is slack-mcp'
  required: false
  default: ''
slack-channel:
  description: 'Slack channel to post to (e.g. #sweny-alerts) — required when notification-provider is slack-mcp'
  required: false
  default: ''
```

## After changes

```
cd packages/providers && npm run build
cd packages/cli && npm run typecheck
cd packages/action && npm run typecheck && npx vitest run
```

## Definition of done

- `notification-provider: slack-mcp` works in both CLI and Action
- `npm run typecheck` passes in both packages
- `action.yml` has the 3 new inputs
- Create a changeset: `@sweny-ai/cli` patch
