import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

export const emailConfigSchema = z.object({
  apiKey: z.string().min(1, "SendGrid API key is required"),
  from: z.string().email("Valid sender email is required"),
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  logger: z.custom<Logger>().optional(),
});

export type EmailConfig = z.infer<typeof emailConfigSchema>;

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
    const isHtml = payload.format === "html";

    const content = [
      {
        type: isHtml ? "text/html" : "text/plain",
        value: payload.body,
      },
    ];

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
