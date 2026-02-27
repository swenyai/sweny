---
title: Notification
description: Send triage results to Slack, Teams, Discord, or GitHub Actions.
---

```typescript
import { githubSummary, slackWebhook, teamsWebhook, discordWebhook } from "@sweny/providers/notification";
```

## Interface

```typescript
interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}

interface NotificationPayload {
  title?: string;
  body: string;
  format?: "markdown" | "html" | "text";
}
```

## GitHub Summary

Writes to the GitHub Actions Job Summary:

```typescript
const notifier = githubSummary({ logger: myLogger });
```

Requires `@actions/core` as a peer dependency. Only works inside GitHub Actions.

## Slack Webhook

```typescript
const notifier = slackWebhook({
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  logger: myLogger,
});
```

## Teams Webhook

```typescript
const notifier = teamsWebhook({
  webhookUrl: process.env.TEAMS_WEBHOOK_URL!,
  logger: myLogger,
});
```

## Discord Webhook

```typescript
const notifier = discordWebhook({
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
  logger: myLogger,
});
```

## Sending a notification

All providers share the same `send()` method:

```typescript
await notifier.send({
  title: "SWEny Triage Complete",
  body: "Found 3 novel issues. Created ENG-456, ENG-457. Opened PRs #89, #90.",
  format: "markdown",
});
```

The notification provider is fire-and-forget — there's no message ID or threading. For two-way conversations, see the [Messaging provider](/providers/messaging/).
