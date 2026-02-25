import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

export const teamsWebhookConfigSchema = z.object({
  webhookUrl: z.string().url("Teams webhook URL is required"),
  logger: z.custom<Logger>().optional(),
});

export type TeamsWebhookConfig = z.infer<typeof teamsWebhookConfigSchema>;

export function teamsWebhook(config: TeamsWebhookConfig): NotificationProvider {
  const parsed = teamsWebhookConfigSchema.parse(config);
  return new TeamsWebhookProvider(parsed);
}

class TeamsWebhookProvider implements NotificationProvider {
  private readonly webhookUrl: string;
  private readonly log: Logger;

  constructor(config: TeamsWebhookConfig) {
    this.webhookUrl = config.webhookUrl;
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              ...(payload.title
                ? [
                    {
                      type: "TextBlock",
                      text: payload.title,
                      weight: "Bolder",
                      size: "Medium",
                    },
                  ]
                : []),
              {
                type: "TextBlock",
                text: payload.body,
                wrap: true,
              },
            ],
          },
        },
      ],
    };

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      throw new Error(
        `Teams webhook error: ${response.status} ${response.statusText}`,
      );
    }

    this.log.info("Teams notification sent");
  }
}
