import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

export const webhookConfigSchema = z.object({
  url: z.string().url("Webhook URL is required"),
  /** Extra headers merged into the request (e.g., Authorization). */
  headers: z.record(z.string()).optional(),
  /** HTTP method — defaults to POST. */
  method: z.enum(["POST", "PUT"]).default("POST"),
  /** Optional HMAC secret for signing the payload (X-Signature-256 header). */
  signingSecret: z.string().optional(),
  logger: z.custom<Logger>().optional(),
});

export type WebhookConfig = z.input<typeof webhookConfigSchema>;

export function webhook(config: WebhookConfig): NotificationProvider {
  const parsed = webhookConfigSchema.parse(config);
  return new WebhookProvider(parsed);
}

class WebhookProvider implements NotificationProvider {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly method: "POST" | "PUT";
  private readonly signingSecret: string | undefined;
  private readonly log: Logger;

  constructor(config: z.output<typeof webhookConfigSchema>) {
    this.url = config.url;
    this.headers = config.headers ?? {};
    this.method = config.method;
    this.signingSecret = config.signingSecret;
    this.log = config.logger ?? consoleLogger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const jsonBody = JSON.stringify({
      title: payload.title,
      body: payload.body,
      format: payload.format,
      status: payload.status,
      summary: payload.summary,
      fields: payload.fields,
      sections: payload.sections,
      links: payload.links,
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers,
    };

    if (this.signingSecret) {
      const signature = createHmac("sha256", this.signingSecret).update(jsonBody).digest("hex");
      headers["X-Signature-256"] = `sha256=${signature}`;
    }

    const response = await fetch(this.url, {
      method: this.method,
      headers,
      body: jsonBody,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      throw new ProviderApiError("webhook", response.status, response.statusText, body);
    }

    this.log.info(`Webhook notification sent to ${this.url}`);
  }
}
