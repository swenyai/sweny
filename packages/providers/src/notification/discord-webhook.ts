import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { NotificationProvider, NotificationPayload, NotificationStatus } from "./types.js";

export const discordWebhookConfigSchema = z.object({
  webhookUrl: z.string().url("Discord webhook URL is required"),
  logger: z.custom<Logger>().optional(),
});

export type DiscordWebhookConfig = z.infer<typeof discordWebhookConfigSchema>;

export function discordWebhook(config: DiscordWebhookConfig): NotificationProvider {
  const parsed = discordWebhookConfigSchema.parse(config);
  return new DiscordWebhookProvider(parsed);
}

// ---------------------------------------------------------------------------
// Embed helpers
// ---------------------------------------------------------------------------

// Discord color integers (decimal)
const STATUS_COLORS: Record<NotificationStatus, number> = {
  success: 5763719, // #57F287 green
  error: 15548997, // #ED4245 red
  warning: 16705372, // #FEE75C yellow
  info: 5793266, // #5865F2 blurple
  skipped: 9807270, // #95A5A6 gray
};

const STATUS_EMOJI: Record<NotificationStatus, string> = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  skipped: "⏭️",
};

const DISCORD_EMBED_DESC_LIMIT = 4096;
const DISCORD_FIELD_VALUE_LIMIT = 1024;
const DISCORD_MAX_FIELDS = 25;

function buildEmbed(payload: NotificationPayload): object {
  const embed: Record<string, unknown> = {};

  if (payload.title) {
    embed.title = payload.title.slice(0, 256);
  }

  // Description: status summary or body fallback
  if (payload.summary) {
    const emoji = payload.status ? STATUS_EMOJI[payload.status] : "📋";
    embed.description = `${emoji} ${payload.summary}`.slice(0, DISCORD_EMBED_DESC_LIMIT);
  } else if (!payload.fields?.length) {
    embed.description = payload.body.slice(0, DISCORD_EMBED_DESC_LIMIT);
  }

  // Color from status
  if (payload.status) {
    embed.color = STATUS_COLORS[payload.status];
  }

  // Metadata as embed fields (inline)
  const fields: object[] = [];
  for (const f of payload.fields?.slice(0, DISCORD_MAX_FIELDS) ?? []) {
    fields.push({
      name: f.label.slice(0, 256),
      value: f.value.slice(0, DISCORD_FIELD_VALUE_LIMIT),
      inline: f.short ?? true,
    });
  }
  if (fields.length) {
    embed.fields = fields;
  }

  // Footer with first section title or run timestamp
  if (payload.sections?.length || payload.fields?.length) {
    embed.footer = { text: `SWEny • ${new Date().toUTCString()}` };
  }

  return embed;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

class DiscordWebhookProvider implements NotificationProvider {
  private readonly webhookUrl: string;
  private readonly log: Logger;

  constructor(config: DiscordWebhookConfig) {
    this.webhookUrl = config.webhookUrl;
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const embed = buildEmbed(payload);
    const webhookPayload: Record<string, unknown> = { embeds: [embed] };

    // Discord has a single `content` field — combine sections and links into it.
    const contentParts: string[] = [];

    if (payload.sections?.length) {
      contentParts.push(payload.sections.map((s) => `**${s.title ?? "Section"}**\n${s.content}`).join("\n\n"));
    }

    if (payload.links?.length) {
      contentParts.push(payload.links.map((l) => `[${l.label}](${l.url})`).join(" • "));
    }

    if (contentParts.length) {
      webhookPayload.content = contentParts.join("\n\n").slice(0, 2000);
    }

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Discord", response.status, response.statusText, body);
    }

    this.log.info("Discord notification sent");
  }
}
