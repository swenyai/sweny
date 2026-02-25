import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

export const slackWebhookConfigSchema = z.object({
  webhookUrl: z.string().url("Slack webhook URL is required"),
  logger: z.custom<Logger>().optional(),
});

export type SlackWebhookConfig = z.infer<typeof slackWebhookConfigSchema>;

export function slackWebhook(config: SlackWebhookConfig): NotificationProvider {
  const parsed = slackWebhookConfigSchema.parse(config);
  return new SlackWebhookProvider(parsed);
}

class SlackWebhookProvider implements NotificationProvider {
  private readonly webhookUrl: string;
  private readonly log: Logger;

  constructor(config: SlackWebhookConfig) {
    this.webhookUrl = config.webhookUrl;
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const text = payload.title
      ? `*${payload.title}*\n${payload.body}`
      : payload.body;

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(
        `Slack webhook error: ${response.status} ${response.statusText}`,
      );
    }

    this.log.info("Slack notification sent");
  }
}
