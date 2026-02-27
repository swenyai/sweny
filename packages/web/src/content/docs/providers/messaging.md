---
title: Messaging
description: Send and update messages in chat platforms.
---

```typescript
import { slack } from "@sweny/providers/messaging";
```

## Interface

```typescript
interface MessagingProvider {
  sendMessage(msg: ChatMessage): Promise<{ messageId: string }>;
  updateMessage(channelId: string, messageId: string, text: string): Promise<void>;
}

interface ChatMessage {
  channelId: string;
  threadId?: string;
  text: string;
  format?: "markdown" | "text";
}
```

## Slack

```typescript
const messenger = slack({
  botToken: process.env.SLACK_BOT_TOKEN!,
  logger: myLogger,
});
```

Requires `@slack/web-api` as a peer dependency (lazy-loaded at runtime).
