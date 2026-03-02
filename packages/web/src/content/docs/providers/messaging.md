---
title: Messaging
description: Send and update messages in chat platforms.
---

The messaging provider sends and updates messages in chat platforms. This is used by the interactive agent to post responses in threads — it's different from the [notification provider](/providers/notification/), which sends one-shot webhook payloads.

The key difference: **messaging** supports two-way threads (send a message, then update it in-place), while **notification** is fire-and-forget.

```typescript
import { slack, teams } from "@sweny-ai/providers/messaging";
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
  token: process.env.SLACK_BOT_TOKEN!,
  logger: myLogger,
});
```

Requires `@slack/web-api` as a peer dependency (lazy-loaded at runtime).

### Sending a message

```typescript
const { messageId } = await messenger.sendMessage({
  channelId: "C0123ABCDEF",
  text: "Looking into this...",
});
```

### Updating in-place

The agent uses this pattern to replace a "thinking..." message with the actual response:

```typescript
// Send placeholder
const { messageId } = await messenger.sendMessage({
  channelId: "C0123ABCDEF",
  threadId: "1234567890.123456",
  text: "Looking into this...",
});

// Replace with actual response
await messenger.updateMessage(
  "C0123ABCDEF",
  messageId,
  "Here's what I found: ...",
);
```

### Required bot token scopes

| Scope | Purpose |
|-------|---------|
| `chat:write` | Send messages |
| `im:history` | Read DM history for context |
| `im:read` | Access DM channels |
| `im:write` | Open DM channels |
| `app_mentions:read` | Respond to @mentions |

## Microsoft Teams

```typescript
const messenger = teams({
  tenantId: process.env.AZURE_TENANT_ID!,
  clientId: process.env.AZURE_CLIENT_ID!,
  clientSecret: process.env.AZURE_CLIENT_SECRET!,
  logger: myLogger,
});
```

Uses the Microsoft Graph API with Azure AD client credentials flow. Zero external dependencies — native `fetch` only.

### Sending a message

Pass the channel as `"teamId/channelId"`:

```typescript
const { messageId } = await messenger.sendMessage({
  channelId: "team-uuid/channel-uuid",
  text: "Looking into this...",
});
```

### Updating in-place

```typescript
await messenger.updateMessage(
  "team-uuid/channel-uuid",
  messageId,
  "Here's what I found: ...",
);
```
