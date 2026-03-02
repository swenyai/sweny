import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { NotificationProvider, NotificationPayload, NotificationStatus } from "./types.js";

export const emailConfigSchema = z.object({
  apiKey: z.string().min(1, "SendGrid API key is required"),
  from: z.string().email("Valid sender email is required"),
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  logger: z.custom<Logger>().optional(),
});

export type EmailConfig = z.infer<typeof emailConfigSchema>;

// ---------------------------------------------------------------------------
// HTML rendering helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

const STATUS_COLORS: Record<NotificationStatus, string> = {
  success: "#28a745",
  error: "#dc3545",
  warning: "#ffc107",
  info: "#17a2b8",
  skipped: "#6c757d",
};

const STATUS_TEXT_COLORS: Record<NotificationStatus, string> = {
  success: "#fff",
  error: "#fff",
  warning: "#212529",
  info: "#fff",
  skipped: "#fff",
};

function buildHtml(payload: NotificationPayload): string {
  const parts: string[] = [
    `<!DOCTYPE html>`,
    `<html><body style="font-family:sans-serif;max-width:800px;margin:0 auto;padding:16px">`,
  ];

  if (payload.title) {
    parts.push(`<h2 style="margin-top:0">${escapeHtml(payload.title)}</h2>`);
  }

  if (payload.status || payload.summary) {
    const bg = payload.status ? STATUS_COLORS[payload.status] : "#6c757d";
    const fg = payload.status ? STATUS_TEXT_COLORS[payload.status] : "#fff";
    const text = payload.summary ? escapeHtml(payload.summary) : (payload.status ?? "");
    parts.push(
      `<div style="background:${bg};color:${fg};padding:8px 12px;border-radius:4px;margin-bottom:12px">${text}</div>`,
    );
  }

  if (payload.fields?.length) {
    parts.push(`<table style="border-collapse:collapse;width:100%;margin-bottom:12px">`);
    parts.push(
      `<thead><tr>` +
        `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #dee2e6">Field</th>` +
        `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #dee2e6">Value</th>` +
        `</tr></thead><tbody>`,
    );
    for (const f of payload.fields) {
      parts.push(
        `<tr>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #dee2e6">${escapeHtml(f.label)}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #dee2e6">${escapeHtml(f.value)}</td>` +
          `</tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }

  if (payload.links?.length) {
    const buttons = payload.links
      .map(
        (l) =>
          `<a href="${safeUrl(l.url)}" style="display:inline-block;padding:6px 12px;margin:0 4px 4px 0;` +
          `background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px">${escapeHtml(l.label)}</a>`,
      )
      .join("");
    parts.push(`<div style="margin-bottom:12px">${buttons}</div>`);
  }

  for (const section of payload.sections ?? []) {
    if (section.title) {
      parts.push(`<h3>${escapeHtml(section.title)}</h3>`);
    }
    parts.push(
      `<pre style="background:#f8f9fa;padding:12px;border-radius:4px;overflow:auto;white-space:pre-wrap">` +
        `${escapeHtml(section.content)}</pre>`,
    );
  }

  // When no structured content was added, fall back to the body text
  if (!payload.fields?.length && !payload.status && !payload.summary && !payload.sections?.length) {
    parts.push(`<div>${payload.body}</div>`);
  }

  parts.push(`</body></html>`);
  return parts.join("\n");
}

export function email(config: EmailConfig): NotificationProvider {
  const parsed = emailConfigSchema.parse(config);
  return new EmailProvider(parsed);
}

class EmailProvider implements NotificationProvider {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly to: string[];
  private readonly log: Logger;

  constructor(config: EmailConfig) {
    this.apiKey = config.apiKey;
    this.from = config.from;
    this.to = Array.isArray(config.to) ? config.to : [config.to];
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const subject = payload.title ?? "SWEny Notification";

    const hasStructuredContent = !!(
      payload.status ||
      payload.summary ||
      payload.fields?.length ||
      payload.sections?.length ||
      payload.links?.length
    );
    const isHtml = payload.format === "html" || hasStructuredContent;
    const value = hasStructuredContent ? buildHtml(payload) : payload.body;

    const content = [{ type: isHtml ? "text/html" : "text/plain", value }];

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: this.to.map((addr) => ({ email: addr })) }],
        from: { email: this.from },
        subject,
        content,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      throw new ProviderApiError("email", response.status, response.statusText, body);
    }

    this.log.info(`Email notification sent to ${this.to.join(", ")}`);
  }
}
