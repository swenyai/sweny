import * as core from "@actions/core";
import {
  ObservabilityProvider,
  QueryOptions,
  LogEntry,
  AggregateResult,
} from "./types.js";

interface DatadogConfig {
  apiKey: string;
  appKey: string;
  site: string;
}

export class DatadogProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly appKey: string;
  private readonly site: string;

  constructor(config: DatadogConfig) {
    this.apiKey = config.apiKey;
    this.appKey = config.appKey;
    this.site = config.site;
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
    core.info(`Verifying Datadog access (site: ${this.site})`);

    await this.request("/api/v2/logs/analytics/aggregate", {
      filter: { query: "*", from: "now-5m", to: "now" },
      compute: [{ type: "total", aggregation: "count" }],
    });

    core.info("Datadog API access verified");
  }

  async queryLogs(opts: QueryOptions): Promise<LogEntry[]> {
    const query = `service:${opts.serviceFilter} status:${opts.severity}`;
    core.info(
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

    core.info(
      `Found ${logs.length} ${opts.severity} logs for ${opts.serviceFilter} in last ${opts.timeRange}`,
    );

    return logs;
  }

  async aggregate(
    opts: Omit<QueryOptions, "severity">,
  ): Promise<AggregateResult[]> {
    core.info(
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

    core.info(`Aggregated ${groups.length} service groups`);

    return groups;
  }
}
