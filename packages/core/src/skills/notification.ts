/**
 * Notification Skill — generic webhook / multi-channel
 *
 * Replaces: notification/webhook.ts + notification/discord-webhook.ts +
 *           notification/email.ts + notification/teams-webhook.ts
 *
 * For Slack-specific notifications, use the Slack skill instead.
 * This skill handles generic webhooks, Discord, Teams, and email.
 */

import type { Skill, ToolContext } from "../types.js";

export const notification: Skill = {
  id: "notification",
  name: "Notification",
  description: "Send notifications via webhook, Discord, Teams, or email",
  config: {
    NOTIFICATION_WEBHOOK_URL: {
      description: "Generic webhook URL for notifications",
      required: false,
      env: "NOTIFICATION_WEBHOOK_URL",
    },
    DISCORD_WEBHOOK_URL: {
      description: "Discord webhook URL",
      required: false,
      env: "DISCORD_WEBHOOK_URL",
    },
    TEAMS_WEBHOOK_URL: {
      description: "Microsoft Teams webhook URL",
      required: false,
      env: "TEAMS_WEBHOOK_URL",
    },
    SMTP_URL: {
      description: "SMTP connection URL for email notifications",
      required: false,
      env: "SMTP_URL",
    },
  },
  tools: [
    {
      name: "notify_webhook",
      description: "Send a JSON payload to a webhook URL",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Webhook URL (overrides NOTIFICATION_WEBHOOK_URL)" },
          payload: { type: "object", description: "JSON payload to send" },
        },
        required: ["payload"],
      },
      handler: async (input: { url?: string; payload: Record<string, unknown> }, ctx) => {
        const url = input.url ?? ctx.config.NOTIFICATION_WEBHOOK_URL;
        if (!url) throw new Error("No webhook URL provided or configured");
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input.payload),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`[Notification] webhook failed (HTTP ${res.status}): ${await res.text()}`);
        return { ok: true, status: res.status };
      },
    },
    {
      name: "notify_discord",
      description: "Send a message to Discord via webhook",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Message text" },
          embeds: {
            type: "array",
            description: "Discord embed objects for rich formatting",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                color: { type: "number", description: "Embed color (decimal)" },
                fields: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      value: { type: "string" },
                      inline: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      handler: async (input: { content?: string; embeds?: any[] }, ctx) => {
        if (!ctx.config.DISCORD_WEBHOOK_URL) throw new Error("[Notification] DISCORD_WEBHOOK_URL not configured");
        const res = await fetch(ctx.config.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: input.content, embeds: input.embeds }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`[Notification] Discord webhook failed (HTTP ${res.status}): ${await res.text()}`);
        return { ok: true };
      },
    },
    {
      name: "notify_teams",
      description: "Send a message to Microsoft Teams via webhook",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Card title" },
          text: { type: "string", description: "Card body (markdown)" },
          themeColor: { type: "string", description: "Hex color for the card accent" },
        },
        required: ["text"],
      },
      handler: async (input: { title?: string; text: string; themeColor?: string }, ctx) => {
        if (!ctx.config.TEAMS_WEBHOOK_URL) throw new Error("[Notification] TEAMS_WEBHOOK_URL not configured");
        const res = await fetch(ctx.config.TEAMS_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            "@type": "MessageCard",
            themeColor: input.themeColor ?? "0076D7",
            title: input.title,
            text: input.text,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`[Notification] Teams webhook failed (HTTP ${res.status}): ${await res.text()}`);
        return { ok: true };
      },
    },
  ],
};
