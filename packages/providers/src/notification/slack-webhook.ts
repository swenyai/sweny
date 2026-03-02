import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { NotificationProvider, NotificationPayload, NotificationStatus } from "./types.js";

export const slackWebhookConfigSchema = z.object({
  webhookUrl: z.string().url("Slack webhook URL is required"),
  logger: z.custom<Logger>().optional(),
});

export type SlackWebhookConfig = z.infer<typeof slackWebhookConfigSchema>;

export function slackWebhook(config: SlackWebhookConfig): NotificationProvider {
  const parsed = slackWebhookConfigSchema.parse(config);
  return new SlackWebhookProvider(parsed);
}

// ---------------------------------------------------------------------------
// Block Kit helpers
// ---------------------------------------------------------------------------

const STATUS_EMOJI: Record<NotificationStatus, string> = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  skipped: "⏭️",
};

/** Build the fallback `text` field (used for notifications and screen readers). */
function buildFallbackText(payload: NotificationPayload): string {
  if (payload.title && payload.summary) return `*${payload.title}*\n${payload.summary}`;
  if (payload.title) return `*${payload.title}*\n${payload.body?.slice(0, 150) || ""}`;
  return payload.body?.slice(0, 150) || "";
}

/** Build Slack Block Kit blocks from the structured payload. */
function buildBlocks(payload: NotificationPayload): object[] {
  const blocks: object[] = [];

  // 1. Header block
  if (payload.title) {
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: payload.title, emoji: true },
    });
  }

  // 2. Status + summary section
  if (payload.status || payload.summary) {
    const emoji = payload.status ? STATUS_EMOJI[payload.status] : "📋";
    const text = payload.summary ? `${emoji} *${payload.summary}*` : emoji;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });
  }

  // 3. Metadata fields grid (max 10 fields per section block — Slack limit)
  if (payload.fields?.length) {
    for (let i = 0; i < payload.fields.length; i += 10) {
      const chunk = payload.fields.slice(i, i + 10);
      blocks.push({
        type: "section",
        fields: chunk.map((f) => ({
          type: "mrkdwn",
          text: `*${f.label}*\n${f.value}`,
        })),
      });
    }
  }

  // 4. If no structured content at all, fall back to body as a mrkdwn section
  if (!payload.fields?.length && !payload.status && !payload.summary) {
    const text = payload.body?.slice(0, 3000) || "";
    if (text) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text },
      });
    }
  }

  // 5. Action links as buttons
  if (payload.links?.length) {
    blocks.push({
      type: "actions",
      elements: payload.links.map((l, i) => ({
        type: "button",
        text: { type: "plain_text", text: l.label, emoji: true },
        url: l.url,
        action_id: `notify_link_${i}`,
      })),
    });
  }

  // 6. Content sections (investigation log, issues report, etc.)
  for (const section of payload.sections ?? []) {
    blocks.push({ type: "divider" });
    const header = section.title ? `*${section.title}*\n` : "";
    const text = `${header}${section.content}`;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: text.slice(0, 3000) },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

class SlackWebhookProvider implements NotificationProvider {
  private readonly webhookUrl: string;
  private readonly log: Logger;

  constructor(config: SlackWebhookConfig) {
    this.webhookUrl = config.webhookUrl;
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const body = JSON.stringify({
      text: buildFallbackText(payload),
      blocks: buildBlocks(payload),
    });

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new ProviderApiError("Slack", response.status, response.statusText, responseBody);
    }

    this.log.info("Slack notification sent");
  }
}
