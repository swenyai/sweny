import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  ObservabilityProvider,
  LogQueryOptions,
  LogEntry,
  AggregateResult,
} from "./types.js";

export const datadogConfigSchema = z.object({
  apiKey: z.string().min(1, "Datadog API key is required"),
  appKey: z.string().min(1, "Datadog Application key is required"),
  site: z.string().default("datadoghq.com"),
  logger: z.custom<Logger>().optional(),
});

export type DatadogConfig = z.infer<typeof datadogConfigSchema>;

export function datadog(config: DatadogConfig): ObservabilityProvider {
  const parsed = datadogConfigSchema.parse(config);
  return new DatadogProvider(parsed);
}

class DatadogProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly appKey: string;
  private readonly site: string;
  private readonly log: Logger;

  constructor(config: DatadogConfig) {
    this.apiKey = config.apiKey;
    this.appKey = config.appKey;
    this.site = config.site;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://api.${this.site}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": this.apiKey,
        "DD-APPLICATION-KEY": this.appKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Datadog API error: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Datadog access (site: ${this.site})`);

    await this.request("/api/v2/logs/analytics/aggregate", {
      filter: { query: "*", from: "now-5m", to: "now" },
      compute: [{ type: "total", aggregation: "count" }],
    });

    this.log.info("Datadog API access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    const query = `service:${opts.serviceFilter} status:${opts.severity}`;
    this.log.info(
      `Querying Datadog logs: ${query} (range: ${opts.timeRange})`,
    );

    const result = await this.request<{
      data?: Array<{
        attributes?: {
          timestamp?: string;
          service?: string;
          status?: string;
          message?: string;
          attributes?: Record<string, unknown>;
        };
      }>;
    }>("/api/v2/logs/events/search", {
      filter: { query, from: `now-${opts.timeRange}`, to: "now" },
      sort: "-timestamp",
      page: { limit: 100 },
    });

    const logs: LogEntry[] = (result.data || []).map((entry) => ({
      timestamp: entry.attributes?.timestamp || "",
      service: entry.attributes?.service || "",
      level: entry.attributes?.status || "",
      message: entry.attributes?.message || "",
      attributes: entry.attributes?.attributes || {},
    }));

    this.log.info(
      `Found ${logs.length} ${opts.severity} logs for ${opts.serviceFilter} in last ${opts.timeRange}`,
    );

    return logs;
  }

  async aggregate(
    opts: Omit<LogQueryOptions, "severity">,
  ): Promise<AggregateResult[]> {
    this.log.info(
      `Aggregating Datadog errors for ${opts.serviceFilter} (range: ${opts.timeRange})`,
    );

    const result = await this.request<{
      data?: {
        buckets?: Array<{
          by?: { service?: string };
          computes?: { c0?: number };
        }>;
      };
    }>("/api/v2/logs/analytics/aggregate", {
      filter: {
        query: `service:${opts.serviceFilter} status:error`,
        from: `now-${opts.timeRange}`,
        to: "now",
      },
      compute: [{ type: "total", aggregation: "count" }],
      group_by: [
        {
          facet: "service",
          limit: 20,
          sort: { type: "measure", aggregation: "count", order: "desc" },
        },
      ],
    });

    const groups: AggregateResult[] = (result.data?.buckets || []).map(
      (bucket) => ({
        service: bucket.by?.service || "unknown",
        count: bucket.computes?.c0 || 0,
      }),
    );

    this.log.info(`Aggregated ${groups.length} service groups`);

    return groups;
  }
}
