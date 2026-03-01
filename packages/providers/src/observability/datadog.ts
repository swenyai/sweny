import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

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

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
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
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Datadog", response.status, response.statusText, body);
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
    this.log.info(`Querying Datadog logs: ${query} (range: ${opts.timeRange})`);

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

    this.log.info(`Found ${logs.length} ${opts.severity} logs for ${opts.serviceFilter} in last ${opts.timeRange}`);

    return logs;
  }

  getAgentEnv(): Record<string, string> {
    return {
      DD_API_KEY: this.apiKey,
      DD_APP_KEY: this.appKey,
      DD_SITE: this.site,
    };
  }

  getPromptInstructions(): string {
    return `### Datadog Logs API
- \`DD_API_KEY\` - API key (use in DD-API-KEY header)
- \`DD_APP_KEY\` - Application key (use in DD-APPLICATION-KEY header)
- \`DD_SITE\` - Datadog site (${this.site})

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

Investigate logs from Datadog across **BOTH production AND staging environments** to find bugs and issues.
You have DIRECT ACCESS to Datadog's Logs API via curl commands.

**Key Insight**: Catching issues in staging BEFORE they hit production is extremely valuable!
- Issues in staging only → Fix before users are affected
- Issues in both environments → Critical, affects users now
- Issues in production only → May be load/scale related

Use these environment variables in your curl commands:
- \`DD_API_KEY\` - API key (use in DD-API-KEY header)
- \`DD_APP_KEY\` - Application key (use in DD-APPLICATION-KEY header)
- \`DD_SITE\` - Datadog site (${this.site})

#### Example: Get error counts by service
\`\`\`bash
curl -s -X POST "https://api.\${DD_SITE}/api/v2/logs/analytics/aggregate" \\
  -H "Content-Type: application/json" \\
  -H "DD-API-KEY: \${DD_API_KEY}" \\
  -H "DD-APPLICATION-KEY: \${DD_APP_KEY}" \\
  -d '{"filter":{"query":"service:* status:error","from":"now-1h","to":"now"},"compute":[{"type":"total","aggregation":"count"}],"group_by":[{"facet":"service","limit":20,"sort":{"type":"measure","aggregation":"count","order":"desc"}}]}'
\`\`\`

#### Example: Get recent error logs
\`\`\`bash
curl -s -X POST "https://api.\${DD_SITE}/api/v2/logs/events/search" \\
  -H "Content-Type: application/json" \\
  -H "DD-API-KEY: \${DD_API_KEY}" \\
  -H "DD-APPLICATION-KEY: \${DD_APP_KEY}" \\
  -d '{"filter":{"query":"service:* status:error","from":"now-1h","to":"now"},"sort":"-timestamp","page":{"limit":100}}'
\`\`\``;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Datadog errors for ${opts.serviceFilter} (range: ${opts.timeRange})`);

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

    const groups: AggregateResult[] = (result.data?.buckets || []).map((bucket) => ({
      service: bucket.by?.service || "unknown",
      count: bucket.computes?.c0 || 0,
    }));

    this.log.info(`Aggregated ${groups.length} service groups`);

    return groups;
  }
}
