import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { IncidentProvider, Incident, IncidentCreateOptions, OnCallEntry } from "./types.js";

export const opsgenieConfigSchema = z.object({
  apiKey: z.string().min(1, "OpsGenie API key is required"),
  region: z.enum(["us", "eu"]).default("us"),
  logger: z.custom<Logger>().optional(),
});

export type OpsGenieConfig = z.infer<typeof opsgenieConfigSchema>;

export function opsgenie(config: OpsGenieConfig): IncidentProvider {
  const parsed = opsgenieConfigSchema.parse(config);
  return new OpsGenieProvider(parsed);
}

class OpsGenieProvider implements IncidentProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly log: Logger;

  constructor(config: OpsGenieConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.region === "eu" ? "https://api.eu.opsgenie.com" : "https://api.opsgenie.com";
    this.log = config.logger ?? consoleLogger;
  }

  private async apiRequest<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: opts?.method ?? "GET",
      headers: {
        Authorization: `GenieKey ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("OpsGenie", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying OpsGenie access...");

    await this.apiRequest("/v2/account");

    this.log.info("OpsGenie API access verified");
  }

  async createIncident(opts: IncidentCreateOptions): Promise<Incident> {
    this.log.info(`Creating OpsGenie alert: ${opts.title}`);

    const priority = opts.urgency === "low" ? "P3" : "P1";

    const result = await this.apiRequest<{
      data: {
        alertId: string;
        alias: string;
      };
      requestId: string;
    }>("/v2/alerts", {
      method: "POST",
      body: {
        message: opts.title,
        ...(opts.description ? { description: opts.description } : {}),
        priority,
        ...(opts.serviceId ? { tags: [opts.serviceId] } : {}),
      },
    });

    this.log.info(`OpsGenie alert created (id: ${result.data.alertId})`);

    return {
      id: result.data.alertId,
      title: opts.title,
      status: "triggered",
      urgency: opts.urgency ?? "high",
      url: `${this.baseUrl}/alert/detail/${result.data.alertId}`,
      ...(opts.serviceId ? { service: opts.serviceId } : {}),
    };
  }

  async acknowledgeIncident(id: string): Promise<void> {
    this.log.info(`Acknowledging OpsGenie alert ${id}`);

    await this.apiRequest(`/v2/alerts/${id}/acknowledge`, {
      method: "POST",
      body: {},
    });

    this.log.info(`OpsGenie alert ${id} acknowledged`);
  }

  async resolveIncident(id: string, resolution?: string): Promise<void> {
    this.log.info(`Resolving OpsGenie alert ${id}`);

    await this.apiRequest(`/v2/alerts/${id}/close`, {
      method: "POST",
      body: {
        ...(resolution ? { note: resolution } : {}),
      },
    });

    this.log.info(`OpsGenie alert ${id} resolved`);
  }

  async getOnCall(scheduleId?: string): Promise<OnCallEntry[]> {
    this.log.info("Fetching OpsGenie on-call schedule");

    let resolvedScheduleId = scheduleId;

    if (!resolvedScheduleId) {
      const schedulesResult = await this.apiRequest<{
        data: Array<{ id: string; name: string }>;
      }>("/v2/schedules");

      if (schedulesResult.data.length === 0) {
        this.log.warn("No OpsGenie schedules found");
        return [];
      }

      resolvedScheduleId = schedulesResult.data[0].id;
      this.log.info(`Using first schedule: ${schedulesResult.data[0].name} (${resolvedScheduleId})`);
    }

    const result = await this.apiRequest<{
      data: {
        onCallParticipants: Array<{
          id: string;
          name: string;
          type: string;
        }>;
      };
    }>(`/v2/schedules/${resolvedScheduleId}/on-calls`);

    const entries: OnCallEntry[] = result.data.onCallParticipants.map((participant) => ({
      userId: participant.id,
      name: participant.name,
    }));

    this.log.info(`Found ${entries.length} on-call entries`);

    return entries;
  }
}
