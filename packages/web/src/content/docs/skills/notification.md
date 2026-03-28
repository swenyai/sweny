---
title: Notification
description: Send notifications via webhook, Discord, or Teams.
---

The Notification skill handles non-Slack notification channels. It supports generic webhooks, Discord, and Microsoft Teams — configure whichever channels your team uses. For Slack, use the dedicated [Slack skill](/skills/slack/) instead.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `notification` |
| **Category** | `notification` |
| **Required env vars** | At least one of: `NOTIFICATION_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` (skill also declares `SMTP_URL` for future email support) |

### Configuration

All config fields are optional. Set the ones for the channels you want to use.

| Env var | Description |
|---------|-------------|
| `NOTIFICATION_WEBHOOK_URL` | Generic webhook URL — receives a JSON POST |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams webhook URL |
The skill activates when at least one of the above is set. If none are set, the skill will not appear in the available tool set.

:::note[Email notifications]
Email notifications are available via the GitHub Action's `notification-provider: email` setting with SendGrid (`sendgrid-api-key`, `email-from`, `email-to` inputs). Email is not exposed as a Claude tool — it's handled by the action's notification layer.
:::

## Tools

| Tool | Description |
|------|-------------|
| `notify_webhook` | Send a JSON payload to a webhook URL |
| `notify_discord` | Send a message to Discord with optional rich embeds |
| `notify_teams` | Send a MessageCard to Microsoft Teams |

### notify_webhook

Posts an arbitrary JSON payload to `NOTIFICATION_WEBHOOK_URL` (or a URL specified in the tool input). Useful for integrating with custom automation, PagerDuty, Opsgenie, or any service that accepts webhook POSTs.

### notify_discord

Posts to your Discord channel via webhook. Supports Discord's embed format for rich messages with titles, descriptions, colored sidebars, and inline fields.

### notify_teams

Sends a MessageCard to Microsoft Teams via an incoming webhook. Supports a title, markdown body text, and a theme color for the card accent.

## Setup

### Discord

1. In your Discord server, go to **Channel Settings > Integrations > Webhooks**.
2. Create a new webhook and copy the URL.
3. Set the environment variable:

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

### Microsoft Teams

1. In your Teams channel, go to **Connectors > Incoming Webhook**.
2. Create a webhook and copy the URL.
3. Set the environment variable:

```bash
export TEAMS_WEBHOOK_URL="https://outlook.office.com/webhook/..."
```

### Generic webhook

Set the URL of any service that accepts JSON POST requests:

```bash
export NOTIFICATION_WEBHOOK_URL="https://your-service.example.com/webhook"
```

The `notify_webhook` tool also accepts a `url` parameter in its input, which overrides the environment variable. This lets Claude target different webhook endpoints dynamically.

## Workflow usage

**Triage workflow:**
- **notify** — Send the triage summary to Discord, Teams, or a webhook.

**Implement workflow:**
- **notify** — Send the implementation result with issue and PR links.

The Notification skill is interchangeable with the [Slack skill](/skills/slack/) at notification nodes. You can configure both — Claude will use all available notification tools at the node.
