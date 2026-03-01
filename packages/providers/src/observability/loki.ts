import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const lokiConfigSchema = z.object({
  baseUrl: z.string().min(1, "Loki base URL is required"),
  apiKey: z.string().optional(),
  orgId: z.string().optional(),
  logger: z.custom<Logger>().optional(),
});

export type LokiConfig = z.infer<typeof lokiConfigSchema>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function loki(config: LokiConfig): ObservabilityProvider {
  const parsed = lokiConfigSchema.parse(config);
  return new LokiProvider(parsed);
}

class LokiProvider implements ObservabilityProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly orgId: string | undefined;
  private readonly log: Logger;

  constructor(config: LokiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.orgId = config.orgId;
    this.log = config.logger ?? consoleLogger;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (this.orgId) {
      headers["X-Scope-OrgID"] = this.orgId;
    }
    return headers;
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const response = await fetch(url.toString(), {
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Loki", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  /**
   * Parse a human-readable time range string (e.g. "1h", "24h", "7d") into
   * a { start, end } pair of Unix timestamps in nanoseconds (strings), which
   * is the format the Loki HTTP API expects.
   */
  private parseTimeRange(timeRange: string): { start: string; end: string } {
    const now = Date.now();
    const match = timeRange.match(/^(\d+)([smhdw])$/);
    if (!match) {
      // Fallback: treat as 1h
      const start = (now - 3600 * 1000) * 1_000_000;
      return { start: start.toString(), end: (now * 1_000_000).toString() };
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 3600 * 1000,
      d: 86400 * 1000,
      w: 7 * 86400 * 1000,
    };

    const durationMs = value * (multipliers[unit] || 3600 * 1000);
    const startNs = (now - durationMs) * 1_000_000;
    const endNs = now * 1_000_000;

    return { start: startNs.toString(), end: endNs.toString() };
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Loki access (${this.baseUrl})`);

    // Try /ready first; fall back to /loki/api/v1/labels
    try {
      const url = new URL("/ready", this.baseUrl);
      const response = await fetch(url.toString(), {
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderApiError("Loki", response.status, response.statusText, body);
      }
    } catch {
      // Fall back to labels endpoint
      await this.request<unknown>("/loki/api/v1/labels");
    }

    this.log.info("Loki API access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    const { start, end } = this.parseTimeRange(opts.timeRange);
    const serviceFilter = opts.serviceFilter && opts.serviceFilter !== "*" ? escapeRegex(opts.serviceFilter) : ".*";
    const query = `{job=~".*${serviceFilter}.*"} |= \`${opts.severity}\``;

    this.log.info(`Querying Loki logs: ${query} (range: ${opts.timeRange})`);

    const result = await this.request<{
      data: {
        result: Array<{
          stream: Record<string, string>;
          values: Array<[string, string]>;
        }>;
      };
    }>("/loki/api/v1/query_range", {
      query,
      start,
      end,
      limit: "100",
    });

    const logs: LogEntry[] = [];
    for (const stream of result.data?.result || []) {
      const job = stream.stream?.job || stream.stream?.service || "unknown";
      const level = stream.stream?.level || opts.severity;

      for (const [tsNano, line] of stream.values) {
        // Convert nanosecond timestamp to ISO string
        const tsMs = Math.floor(parseInt(tsNano, 10) / 1_000_000);
        logs.push({
          timestamp: new Date(tsMs).toISOString(),
          service: job,
          level,
          message: line,
          attributes: { ...stream.stream },
        });
      }
    }

    this.log.info(`Found ${logs.length} ${opts.severity} logs for ${opts.serviceFilter} in last ${opts.timeRange}`);

    return logs;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    const serviceFilter = opts.serviceFilter && opts.serviceFilter !== "*" ? escapeRegex(opts.serviceFilter) : ".*";
    const query = `sum by (job) (count_over_time({job=~".*${serviceFilter}.*"} |= "error" [${opts.timeRange}]))`;

    this.log.info(`Aggregating Loki errors: ${query}`);

    const result = await this.request<{
      data: {
        result: Array<{
          metric: Record<string, string>;
          value: [number, string];
        }>;
      };
    }>("/loki/api/v1/query", {
      query,
    });

    const groups: AggregateResult[] = (result.data?.result || []).map((entry) => ({
      service: entry.metric?.job || "unknown",
      count: parseInt(entry.value?.[1] || "0", 10),
    }));

    this.log.info(`Aggregated ${groups.length} service groups`);

    return groups;
  }

  getAgentEnv(): Record<string, string> {
    const env: Record<string, string> = {
      LOKI_URL: this.baseUrl,
    };
    if (this.apiKey) {
      env.LOKI_API_KEY = this.apiKey;
    }
    if (this.orgId) {
      env.LOKI_ORG_ID = this.orgId;
    }
    return env;
  }

  getPromptInstructions(): string {
    const authHeader = this.apiKey ? `  -H "Authorization: Bearer \${LOKI_API_KEY}" \\` : "";
    const orgHeader = this.orgId ? `  -H "X-Scope-OrgID: \${LOKI_ORG_ID}" \\` : "";
    const extraHeaders = [authHeader, orgHeader].filter(Boolean).join("\n");
    const curlHeaders = extraHeaders ? `\n${extraHeaders}` : "";

    return `### Grafana Loki API
- \`LOKI_URL\` - Loki base URL (${this.baseUrl})${this.apiKey ? `\n- \`LOKI_API_KEY\` - Bearer token for authentication` : ""}${this.orgId ? `\n- \`LOKI_ORG_ID\` - Tenant/org ID for multi-tenant Loki (${this.orgId})` : ""}

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

Investigate logs from Loki across **BOTH production AND staging environments** to find bugs and issues.
You have DIRECT ACCESS to Loki's HTTP API via curl commands.

**Key Insight**: Catching issues in staging BEFORE they hit production is extremely valuable!
- Issues in staging only \u2192 Fix before users are affected
- Issues in both environments \u2192 Critical, affects users now
- Issues in production only \u2192 May be load/scale related

Use LogQL query language. Key patterns:
- Stream selectors: \`{job="myservice"}\`, \`{job=~".*pattern.*"}\`
- Line filters: \`|= "error"\`, \`|~ "(?i)error"\`, \`!= "debug"\`
- Label filters: \`| level="error"\`
- Metric queries: \`count_over_time({job="myservice"}[1h])\`

#### Example: Query recent error logs
\`\`\`bash
curl -s "\${LOKI_URL}/loki/api/v1/query_range" \\${curlHeaders}
  --data-urlencode 'query={job=~".*"} |= "error"' \\
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \\
  --data-urlencode "end=$(date +%s)000000000" \\
  --data-urlencode "limit=100"
\`\`\`

#### Example: Count errors by job over a time range
\`\`\`bash
curl -s "\${LOKI_URL}/loki/api/v1/query" \\${curlHeaders}
  --data-urlencode 'query=sum by (job) (count_over_time({job=~".*"} |= "error" [1h]))'
\`\`\`

#### Example: Get available labels
\`\`\`bash
curl -s "\${LOKI_URL}/loki/api/v1/labels" \\${curlHeaders}
\`\`\`

#### Example: Get label values for a specific label
\`\`\`bash
curl -s "\${LOKI_URL}/loki/api/v1/label/job/values" \\${curlHeaders}
\`\`\``;
  }
}
