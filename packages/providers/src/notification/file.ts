import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

export const fileNotificationConfigSchema = z.object({
  outputDir: z.string().min(1, "Output directory is required"),
  logger: z.custom<Logger>().optional(),
});

export type FileNotificationConfig = z.infer<typeof fileNotificationConfigSchema>;

export function fileNotification(config: FileNotificationConfig): NotificationProvider {
  const parsed = fileNotificationConfigSchema.parse(config);
  return new FileNotificationProvider(parsed);
}

const STATUS_EMOJI: Record<string, string> = {
  success: "SUCCESS",
  error: "ERROR",
  warning: "WARNING",
  info: "INFO",
  skipped: "SKIPPED",
};

class FileNotificationProvider implements NotificationProvider {
  private readonly notificationsDir: string;
  private readonly log: Logger;

  constructor(config: FileNotificationConfig) {
    this.notificationsDir = path.join(path.resolve(config.outputDir), "notifications");
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    mkdirSync(this.notificationsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(this.notificationsDir, `summary-${timestamp}.md`);

    const lines: string[] = [];

    // Title
    lines.push(`# ${payload.title ?? "SWEny Triage Summary"}`);
    lines.push("");

    // Status + summary
    if (payload.status) {
      lines.push(`**Status**: ${STATUS_EMOJI[payload.status] ?? payload.status}`);
    }
    if (payload.summary) {
      lines.push(`**Summary**: ${payload.summary}`);
    }
    if (payload.status || payload.summary) lines.push("");

    // Metadata fields table
    if (payload.fields && payload.fields.length > 0) {
      lines.push("| Field | Value |");
      lines.push("|-------|-------|");
      for (const field of payload.fields) {
        lines.push(`| ${field.label} | ${field.value} |`);
      }
      lines.push("");
    }

    // Links
    if (payload.links && payload.links.length > 0) {
      lines.push("## Links");
      lines.push("");
      for (const link of payload.links) {
        lines.push(`- [${link.label}](${link.url})`);
      }
      lines.push("");
    }

    // Content sections
    if (payload.sections && payload.sections.length > 0) {
      for (const section of payload.sections) {
        if (section.title) {
          lines.push(`## ${section.title}`);
          lines.push("");
        }
        lines.push(section.content);
        lines.push("");
      }
    }

    // Fallback: body
    if (!payload.sections?.length && !payload.fields?.length) {
      lines.push(payload.body);
    }

    writeFileSync(filePath, lines.join("\n"), "utf-8");
    this.log.info(`Notification written to ${filePath}`);
  }
}
