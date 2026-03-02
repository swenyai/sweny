import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { NotificationProvider, NotificationPayload, NotificationStatus } from "./types.js";

export const githubSummaryConfigSchema = z.object({
  logger: z.custom<Logger>().optional(),
});

export type GitHubSummaryConfig = z.infer<typeof githubSummaryConfigSchema>;

export function githubSummary(config?: GitHubSummaryConfig): NotificationProvider {
  return new GitHubSummaryProvider(config?.logger ?? consoleLogger);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const STATUS_EMOJI: Record<NotificationStatus, string> = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  skipped: "⏭️",
};

class GitHubSummaryProvider implements NotificationProvider {
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const core = await import("@actions/core");
    const summary = core.summary;

    // Title
    if (payload.title) {
      summary.addHeading(payload.title, 2);
    }

    // Status summary
    if (payload.status || payload.summary) {
      const emoji = payload.status ? STATUS_EMOJI[payload.status] : "📋";
      const text = payload.summary ? `${emoji} **${payload.summary}**` : emoji;
      summary.addRaw(`\n${text}\n\n`);
    }

    // Metadata fields as a table
    if (payload.fields?.length) {
      summary.addTable([
        [
          { data: "Field", header: true },
          { data: "Value", header: true },
        ],
        ...payload.fields.map((f) => [f.label, f.value]),
      ]);
    }

    // Action links
    if (payload.links?.length) {
      const linkList = payload.links.map((l) => `[${l.label}](${l.url})`).join(" · ");
      summary.addRaw(`\n${linkList}\n\n`);
    }

    // Content sections
    for (const section of payload.sections ?? []) {
      if (section.title) {
        summary.addHeading(section.title, 3);
      }
      summary.addRaw(section.content + "\n\n");
    }

    // Fallback: if no structured content, write body directly
    if (!payload.fields?.length && !payload.status && !payload.summary && !payload.sections?.length) {
      summary.addRaw(payload.body);
    }

    await summary.write();
    this.log.info("GitHub Action summary written");
  }
}
