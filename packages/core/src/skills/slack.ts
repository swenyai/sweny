/**
 * Slack Skill
 *
 * Replaces: notification/slack-webhook.ts + messaging/slack.ts
 * Two separate provider modules → one skill with simple tools
 */

import type { Skill, ToolContext } from "../types.js";

export const slack: Skill = {
  id: "slack",
  name: "Slack",
  description: "Send messages and notifications to Slack channels",
  config: {
    SLACK_WEBHOOK_URL: {
      description: "Slack incoming webhook URL",
      required: false,
      env: "SLACK_WEBHOOK_URL",
    },
    SLACK_BOT_TOKEN: {
      description: "Slack bot token (for API calls)",
      required: false,
      env: "SLACK_BOT_TOKEN",
    },
  },
  tools: [
    {
      name: "slack_send_message",
      description: "Send a message to a Slack channel via webhook or API",
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text (Slack mrkdwn supported)" },
          channel: { type: "string", description: "Channel ID or name (required for API, ignored for webhook)" },
          blocks: {
            type: "array",
            description: "Optional Block Kit blocks for rich formatting",
            items: { type: "object" },
          },
        },
        required: ["text"],
      },
      handler: async (input: { text: string; channel?: string; blocks?: any[] }, ctx) => {
        // Prefer bot token API for channel targeting; fall back to webhook
        if (ctx.config.SLACK_BOT_TOKEN && input.channel) {
          const res = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ctx.config.SLACK_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel: input.channel,
              text: input.text,
              blocks: input.blocks,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`[Slack] send_message failed (HTTP ${res.status}): ${await res.text()}`);
          const data: any = await res.json();
          if (!data.ok) throw new Error(`[Slack] send_message failed: ${data.error ?? "unknown error"}`);
          return data;
        }

        if (ctx.config.SLACK_WEBHOOK_URL) {
          const res = await fetch(ctx.config.SLACK_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: input.text, blocks: input.blocks }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`[Slack] webhook failed (HTTP ${res.status}): ${await res.text()}`);
          return { ok: true };
        }

        throw new Error("No Slack credentials configured (need SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN)");
      },
    },
    {
      name: "slack_send_thread_reply",
      description: "Reply to an existing Slack message thread",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel ID" },
          thread_ts: { type: "string", description: "Parent message timestamp" },
          text: { type: "string" },
        },
        required: ["channel", "thread_ts", "text"],
      },
      handler: async (input: { channel: string; thread_ts: string; text: string }, ctx) => {
        if (!ctx.config.SLACK_BOT_TOKEN) throw new Error("[Slack] thread replies require SLACK_BOT_TOKEN");
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.config.SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: input.channel,
            thread_ts: input.thread_ts,
            text: input.text,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`[Slack] thread_reply failed (HTTP ${res.status}): ${await res.text()}`);
        const data: any = await res.json();
        if (!data.ok) throw new Error(`[Slack] thread_reply failed: ${data.error ?? "unknown error"}`);
        return data;
      },
    },
  ],
};
