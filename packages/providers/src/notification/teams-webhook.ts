import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { NotificationProvider, NotificationPayload, NotificationStatus } from "./types.js";

export const teamsWebhookConfigSchema = z.object({
  webhookUrl: z.string().url("Teams webhook URL is required"),
  logger: z.custom<Logger>().optional(),
});

export type TeamsWebhookConfig = z.infer<typeof teamsWebhookConfigSchema>;

export function teamsWebhook(config: TeamsWebhookConfig): NotificationProvider {
  const parsed = teamsWebhookConfigSchema.parse(config);
  return new TeamsWebhookProvider(parsed);
}

// ---------------------------------------------------------------------------
// Adaptive Card helpers
// ---------------------------------------------------------------------------

const STATUS_EMOJI: Record<NotificationStatus, string> = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  skipped: "⏭️",
};

function buildAdaptiveCard(payload: NotificationPayload): object {
  const body: object[] = [];
  const actions: object[] = [];

  // Title
  if (payload.title) {
    body.push({
      type: "TextBlock",
      text: payload.title,
      weight: "Bolder",
      size: "Medium",
    });
  }

  // Status summary
  if (payload.status || payload.summary) {
    const emoji = payload.status ? STATUS_EMOJI[payload.status] : "📋";
    const text = payload.summary ? `${emoji} ${payload.summary}` : emoji;
    body.push({
      type: "TextBlock",
      text,
      wrap: true,
      color:
        payload.status === "success"
          ? "Good"
          : payload.status === "error"
            ? "Attention"
            : payload.status === "warning"
              ? "Warning"
              : "Default",
    });
  }

  // Metadata as FactSet
  if (payload.fields?.length) {
    body.push({
      type: "FactSet",
      facts: payload.fields.map((f) => ({ title: f.label, value: f.value })),
    });
  }

  // Content sections
  for (const section of payload.sections ?? []) {
    body.push({
      type: "Container",
      separator: true,
      items: [
        ...(section.title ? [{ type: "TextBlock", text: section.title, weight: "Bolder", wrap: true }] : []),
        { type: "TextBlock", text: section.content.slice(0, 3000), wrap: true },
      ],
    });
  }

  // If no structured content, fall back to body TextBlock
  if (!payload.fields?.length && !payload.status && !payload.summary && !payload.sections?.length) {
    body.push({
      type: "TextBlock",
      text: payload.body,
      wrap: true,
    });
  }

  // Action links
  for (const link of payload.links ?? []) {
    actions.push({
      type: "Action.OpenUrl",
      title: link.label,
      url: link.url,
    });
  }

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body,
    ...(actions.length ? { actions } : {}),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

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
          content: buildAdaptiveCard(payload),
        },
      ],
    };

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Teams", response.status, response.statusText, body);
    }

    this.log.info("Teams notification sent");
  }
}
