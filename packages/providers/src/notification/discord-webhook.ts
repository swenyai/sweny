import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

export const discordWebhookConfigSchema = z.object({
  webhookUrl: z.string().url("Discord webhook URL is required"),
  logger: z.custom<Logger>().optional(),
});

export type DiscordWebhookConfig = z.infer<typeof discordWebhookConfigSchema>;

export function discordWebhook(config: DiscordWebhookConfig): NotificationProvider {
  const parsed = discordWebhookConfigSchema.parse(config);
  return new DiscordWebhookProvider(parsed);
}

class DiscordWebhookProvider implements NotificationProvider {
  private readonly webhookUrl: string;
  private readonly log: Logger;

  constructor(config: DiscordWebhookConfig) {
    this.webhookUrl = config.webhookUrl;
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const content = payload.title ? `**${payload.title}**\n${payload.body}` : payload.body;

    // Discord has a 2000 character limit per message
    const truncated = content.length > 2000 ? content.slice(0, 1997) + "..." : content;

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: truncated }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Discord", response.status, response.statusText, body);
    }

    this.log.info("Discord notification sent");
  }
}
