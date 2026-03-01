import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { IncidentProvider, Incident, IncidentCreateOptions, OnCallEntry } from "./types.js";

export const pagerdutyConfigSchema = z.object({
  apiToken: z.string().min(1, "PagerDuty API token is required"),
  routingKey: z.string().min(1, "PagerDuty routing key (integration key) is required"),
  logger: z.custom<Logger>().optional(),
});

export type PagerDutyConfig = z.infer<typeof pagerdutyConfigSchema>;

export function pagerduty(config: PagerDutyConfig): IncidentProvider {
  const parsed = pagerdutyConfigSchema.parse(config);
  return new PagerDutyProvider(parsed);
}

class PagerDutyProvider implements IncidentProvider {
  private readonly apiToken: string;
  private readonly routingKey: string;
  private readonly log: Logger;

  constructor(config: PagerDutyConfig) {
    this.apiToken = config.apiToken;
    this.routingKey = config.routingKey;
    this.log = config.logger ?? consoleLogger;
  }

  private async apiRequest<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const url = `https://api.pagerduty.com${path}`;
    const response = await fetch(url, {
      method: opts?.method ?? "GET",
      headers: {
        Authorization: `Token token=${this.apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.pagerduty+json;version=2",
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("PagerDuty", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying PagerDuty access...");

    await this.apiRequest("/abilities");

    this.log.info("PagerDuty API access verified");
  }

  async createIncident(opts: IncidentCreateOptions): Promise<Incident> {
    this.log.info(`Creating PagerDuty incident: ${opts.title}`);

    // Use Events API v2 for triggering
    const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: this.routingKey,
        event_action: "trigger",
        payload: {
          summary: opts.title,
          severity: opts.urgency === "low" ? "warning" : "critical",
          source: "sweny",
          ...(opts.description ? { custom_details: { description: opts.description } } : {}),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("PagerDuty", response.status, response.statusText, body);
    }

    const result = (await response.json()) as {
      dedup_key: string;
      status: string;
    };

    this.log.info(`PagerDuty incident triggered (dedup_key: ${result.dedup_key})`);

    return {
      id: result.dedup_key,
      title: opts.title,
      status: "triggered",
      urgency: opts.urgency ?? "high",
      url: `https://app.pagerduty.com`,
    };
  }

  async acknowledgeIncident(id: string): Promise<void> {
    this.log.info(`Acknowledging PagerDuty incident ${id}`);

    await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: this.routingKey,
        event_action: "acknowledge",
        dedup_key: id,
      }),
    });

    this.log.info(`PagerDuty incident ${id} acknowledged`);
  }

  async resolveIncident(id: string, resolution?: string): Promise<void> {
    this.log.info(`Resolving PagerDuty incident ${id}`);

    await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: this.routingKey,
        event_action: "resolve",
        dedup_key: id,
        ...(resolution ? { payload: { summary: resolution, source: "sweny", severity: "info" } } : {}),
      }),
    });

    this.log.info(`PagerDuty incident ${id} resolved`);
  }

  async getOnCall(scheduleId?: string): Promise<OnCallEntry[]> {
    this.log.info("Fetching PagerDuty on-call schedule");

    const params = scheduleId ? `?schedule_ids[]=${scheduleId}` : "";

    const result = await this.apiRequest<{
      oncalls: Array<{
        user: {
          id: string;
          name: string;
          email: string;
        };
      }>;
    }>(`/oncalls${params}`);

    const entries: OnCallEntry[] = result.oncalls.map((oc) => ({
      userId: oc.user.id,
      name: oc.user.name,
      email: oc.user.email,
    }));

    this.log.info(`Found ${entries.length} on-call entries`);

    return entries;
  }
}
