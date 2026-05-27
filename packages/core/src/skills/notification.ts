/**
 * Notification Skill — generic webhook / multi-channel
 *
 * Replaces: notification/webhook.ts + notification/discord-webhook.ts +
 *           notification/email.ts + notification/teams-webhook.ts
 *
 * For Slack-specific notifications, use the Slack skill instead.
 * This skill handles generic webhooks, Discord, Teams, and email.
 */

import type { Skill, ToolContext, SkillCategory } from "../types.js";

/**
 * Resolve the destination URL for `notify_webhook`.
 *
 * Trust model: the LLM controls tool arguments at runtime, and resolved source
 * content is attacker-influenceable (prompt injection). A free-form `url`
 * override would turn `notify_webhook` into an arbitrary exfiltration sink, so
 * the destination is locked to operator-configured values:
 *
 *   - With no override, the configured `NOTIFICATION_WEBHOOK_URL` is used.
 *   - An `override` is only honored when its host matches the configured
 *     webhook's host, or a host on the `NOTIFICATION_WEBHOOK_ALLOWED_HOSTS`
 *     allowlist (comma-separated, host[:port], case-insensitive).
 *   - Anything else is rejected with a clear error.
 *
 * Returns the URL to POST to, or throws an `Error` the caller surfaces.
 */
export function resolveWebhookUrl(override: string | undefined, config: Record<string, string | undefined>): string {
  const configured = config.NOTIFICATION_WEBHOOK_URL;

  if (override === undefined || override === "") {
    if (!configured) {
      throw new Error("[Notification] No webhook URL configured (set NOTIFICATION_WEBHOOK_URL)");
    }
    return configured;
  }

  // An override was supplied — only honor it if its host is allowlisted.
  let overrideHost: string;
  try {
    overrideHost = new URL(override).host.toLowerCase();
  } catch {
    throw new Error(`[Notification] Invalid webhook url override: ${override}`);
  }

  const allowed = new Set<string>();
  if (configured) {
    try {
      allowed.add(new URL(configured).host.toLowerCase());
    } catch {
      // Misconfigured NOTIFICATION_WEBHOOK_URL — ignore for allowlist purposes.
    }
  }
  for (const host of (config.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS ?? "").split(",")) {
    const h = host.trim().toLowerCase();
    if (h) allowed.add(h);
  }

  if (allowed.has(overrideHost)) return override;

  throw new Error(
    `[Notification] Refusing to POST to non-allowlisted host "${overrideHost}". ` +
      `Destination is locked to NOTIFICATION_WEBHOOK_URL; ` +
      `add the host to NOTIFICATION_WEBHOOK_ALLOWED_HOSTS to permit it.`,
  );
}

export const notification: Skill = {
  id: "notification",
  name: "Notification",
  description: "Send notifications via webhook, Discord, Teams, or email",
  category: "notification",
  config: {
    NOTIFICATION_WEBHOOK_URL: {
      description: "Generic webhook URL for notifications",
      required: false,
      env: "NOTIFICATION_WEBHOOK_URL",
    },
    NOTIFICATION_WEBHOOK_ALLOWED_HOSTS: {
      description:
        "Comma-separated host allowlist (host[:port]) for the notify_webhook url override. " +
        "The configured NOTIFICATION_WEBHOOK_URL host is always allowed.",
      required: false,
      env: "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS",
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
      description:
        "Send a JSON payload to the configured notification webhook (NOTIFICATION_WEBHOOK_URL). " +
        "The destination is fixed: an optional `url` is only honored when its host is on the " +
        "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS allowlist; arbitrary hosts are rejected.",
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Optional webhook URL. Only honored when its host matches NOTIFICATION_WEBHOOK_URL " +
              "or an entry in NOTIFICATION_WEBHOOK_ALLOWED_HOSTS; otherwise rejected.",
          },
          payload: { type: "object", description: "JSON payload to send" },
        },
        required: ["payload"],
      },
      handler: async (input: { url?: string; payload: Record<string, unknown> }, ctx) => {
        const url = resolveWebhookUrl(input.url, ctx.config);
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
