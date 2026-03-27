---
title: Slack
description: Send messages and thread replies to Slack channels.
---

The Slack skill lets Claude send messages to your Slack workspace. It supports two authentication modes: incoming webhooks (simple, single-channel) and bot tokens (multi-channel, thread replies, richer formatting).

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `slack` |
| **Category** | `notification` |
| **Required env vars** | `SLACK_WEBHOOK_URL` or `SLACK_BOT_TOKEN` (at least one) |

## Tools

| Tool | Description |
|------|-------------|
| `slack_send_message` | Send a message to a Slack channel via webhook or API |
| `slack_send_thread_reply` | Reply to an existing message thread (requires bot token) |

## Setup

You can configure Slack with either an incoming webhook or a bot token. Both work for sending messages; the bot token enables additional capabilities.

### Option 1: Incoming webhook (simpler)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app (or use an existing one).
2. Enable **Incoming Webhooks** and add a webhook to the channel where you want notifications.
3. Set the environment variable:

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../..."
```

With a webhook, `slack_send_message` posts to the webhook's configured channel. The `channel` parameter is ignored.

### Option 2: Bot token (more capable)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps).
2. Under **OAuth & Permissions**, add the `chat:write` scope.
3. Install the app to your workspace and copy the bot token.
4. Invite the bot to the channels it needs to post in (`/invite @your-bot`).
5. Set the environment variable:

```bash
export SLACK_BOT_TOKEN="xoxb-..."
```

With a bot token, Claude can target any channel the bot has been invited to and reply to existing threads.

:::note[Both configured?]
If both `SLACK_WEBHOOK_URL` and `SLACK_BOT_TOKEN` are set, the skill prefers the bot token API when a `channel` parameter is provided. It falls back to the webhook when no channel is specified. This lets you use the bot for targeted messages and the webhook as a default.
:::

### Bot token capabilities

| Capability | Webhook | Bot token |
|------------|---------|-----------|
| Send to configured channel | Yes | Yes |
| Send to any channel | No | Yes |
| Thread replies | No | Yes |
| Block Kit formatting | Yes | Yes |

## Workflow usage

**Triage workflow:**
- **notify** — Send a summary of the triage result including severity, root cause, and a link to the created issue.

**Implement workflow:**
- **notify** — Send a message with the issue reference, PR link, and a brief summary of the changes.

The Slack skill is interchangeable with the [Notification](/skills/notification/) skill at notification nodes. Configure whichever channels your team uses.
