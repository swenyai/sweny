import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const elasticConfigSchema = z
  .object({
    baseUrl: z.string().min(1, "Elasticsearch URL is required"),
    apiKey: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    index: z.string().default("logs-*"),
    logger: z.custom<Logger>().optional(),
  })
  .refine((c) => c.apiKey || (c.username && c.password), {
    message: "Either apiKey or both username and password must be provided",
  });

export type ElasticConfig = z.infer<typeof elasticConfigSchema>;

export function elastic(config: ElasticConfig): ObservabilityProvider {
  const parsed = elasticConfigSchema.parse(config);
  return new ElasticProvider(parsed);
}

/** Safely extract a string from an unknown value, returning undefined for non-strings. */
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

class ElasticProvider implements ObservabilityProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly index: string;
  private readonly log: Logger;

  constructor(config: ElasticConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.username = config.username;
    this.password = config.password;
    this.index = config.index;
    this.log = config.logger ?? consoleLogger;
  }

  private authHeaders(): Record<string, string> {
    if (this.apiKey) {
      return { Authorization: `ApiKey ${this.apiKey}` };
    }
    const encoded = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Elasticsearch", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  /**
   * Convert time range strings like "1h", "24h", "7d" to Elasticsearch
   * date math format "now-1h", "now-24h", "now-7d".
   */
  private toElasticRange(timeRange: string): string {
    // Already in Elasticsearch format
    if (timeRange.startsWith("now-")) {
      return timeRange;
    }
    return `now-${timeRange}`;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Elasticsearch access (${this.baseUrl})`);

    const info = await this.request<{ cluster_name?: string; version?: { number?: string } }>("GET", "/");

    this.log.info(
      `Elasticsearch access verified (cluster: ${info.cluster_name ?? "unknown"}, version: ${info.version?.number ?? "unknown"})`,
    );
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(
      `Querying Elasticsearch logs (severity: ${opts.severity}, range: ${opts.timeRange}, service: ${opts.serviceFilter})`,
    );

    const must: Record<string, unknown>[] = [
      {
        range: {
          "@timestamp": {
            gte: this.toElasticRange(opts.timeRange),
            lte: "now",
          },
        },
      },
    ];

    if (opts.severity && opts.severity !== "*") {
      must.push({ match: { "log.level": opts.severity } });
    }

    if (opts.serviceFilter && opts.serviceFilter !== "*") {
      must.push({
        bool: {
          should: [{ match: { "service.name": opts.serviceFilter } }, { match: { "host.name": opts.serviceFilter } }],
          minimum_should_match: 1,
        },
      });
    }

    const result = await this.request<{
      hits?: {
        hits?: Array<{
          _source?: Record<string, unknown>;
        }>;
      };
    }>("POST", `/${this.index}/_search`, {
      size: 100,
      sort: [{ "@timestamp": { order: "desc" } }],
      query: {
        bool: { must },
      },
    });

    const hits = result.hits?.hits ?? [];

    const logs: LogEntry[] = hits.map((hit) => {
      const src = hit._source ?? {};
      const service =
        str(src["service.name"]) ??
        (src["service"] && typeof src["service"] === "object"
          ? str((src["service"] as Record<string, unknown>)["name"])
          : undefined) ??
        str(src["host.name"]) ??
        (src["host"] && typeof src["host"] === "object"
          ? str((src["host"] as Record<string, unknown>)["name"])
          : undefined) ??
        "unknown";
      const level =
        str(src["log.level"]) ??
        (src["log"] && typeof src["log"] === "object"
          ? str((src["log"] as Record<string, unknown>)["level"])
          : undefined) ??
        "unknown";

      return {
        timestamp: str(src["@timestamp"]) ?? "",
        service,
        level,
        message: str(src["message"]) ?? "",
        attributes: src,
      };
    });

    this.log.info(`Found ${logs.length} log entries`);

    return logs;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Elasticsearch logs (range: ${opts.timeRange}, service: ${opts.serviceFilter})`);

    const must: Record<string, unknown>[] = [
      {
        range: {
          "@timestamp": {
            gte: this.toElasticRange(opts.timeRange),
            lte: "now",
          },
        },
      },
    ];

    if (opts.serviceFilter && opts.serviceFilter !== "*") {
      must.push({
        bool: {
          should: [{ match: { "service.name": opts.serviceFilter } }, { match: { "host.name": opts.serviceFilter } }],
          minimum_should_match: 1,
        },
      });
    }

    const result = await this.request<{
      aggregations?: {
        services?: {
          buckets?: Array<{
            key: string;
            doc_count: number;
          }>;
        };
      };
    }>("POST", `/${this.index}/_search`, {
      size: 0,
      query: {
        bool: { must },
      },
      aggs: {
        services: {
          terms: {
            field: "service.keyword",
            size: 50,
            order: { _count: "desc" },
          },
        },
      },
    });

    const buckets = result.aggregations?.services?.buckets ?? [];

    const results: AggregateResult[] = buckets.map((bucket) => ({
      service: bucket.key,
      count: bucket.doc_count,
    }));

    this.log.info(`Aggregated ${results.length} service groups`);

    return results;
  }

  getAgentEnv(): Record<string, string> {
    const env: Record<string, string> = {
      ELASTIC_URL: this.baseUrl,
      ELASTIC_INDEX: this.index,
    };

    if (this.apiKey) {
      env.ELASTIC_API_KEY = this.apiKey;
    } else {
      // Zod refine guarantees username+password exist when apiKey is absent
      env.ELASTIC_USERNAME = this.username ?? "";
      env.ELASTIC_PASSWORD = this.password ?? "";
    }

    return env;
  }

  getPromptInstructions(): string {
    const authHeader = this.apiKey
      ? `-H "Authorization: ApiKey \${ELASTIC_API_KEY}"`
      : `-u "\${ELASTIC_USERNAME}:\${ELASTIC_PASSWORD}"`;

    return `### Elasticsearch Logs API
- \`ELASTIC_URL\` - Elasticsearch base URL (${this.baseUrl})
- \`ELASTIC_INDEX\` - Index pattern (${this.index})
${this.apiKey ? "- `ELASTIC_API_KEY` - API key for authentication" : "- `ELASTIC_USERNAME` / `ELASTIC_PASSWORD` - Basic auth credentials"}

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

Investigate logs from Elasticsearch across **BOTH production AND staging environments** to find bugs and issues.
You have DIRECT ACCESS to Elasticsearch's REST API via curl commands.

**Key Insight**: Catching issues in staging BEFORE they hit production is extremely valuable!
- Issues in staging only -> Fix before users are affected
- Issues in both environments -> Critical, affects users now
- Issues in production only -> May be load/scale related

#### Example: Search for error logs in the last hour
\`\`\`bash
curl -s -X POST "\${ELASTIC_URL}/\${ELASTIC_INDEX}/_search" \\
  -H "Content-Type: application/json" \\
  ${authHeader} \\
  -d '{"size":100,"sort":[{"@timestamp":{"order":"desc"}}],"query":{"bool":{"must":[{"range":{"@timestamp":{"gte":"now-1h","lte":"now"}}},{"match":{"log.level":"error"}}]}}}'
\`\`\`

#### Example: Aggregate log counts by service
\`\`\`bash
curl -s -X POST "\${ELASTIC_URL}/\${ELASTIC_INDEX}/_search" \\
  -H "Content-Type: application/json" \\
  ${authHeader} \\
  -d '{"size":0,"query":{"bool":{"must":[{"range":{"@timestamp":{"gte":"now-24h","lte":"now"}}}]}},"aggs":{"services":{"terms":{"field":"service.keyword","size":50,"order":{"_count":"desc"}}}}}'
\`\`\`

#### Example: Filter logs by service name
\`\`\`bash
curl -s -X POST "\${ELASTIC_URL}/\${ELASTIC_INDEX}/_search" \\
  -H "Content-Type: application/json" \\
  ${authHeader} \\
  -d '{"size":100,"sort":[{"@timestamp":{"order":"desc"}}],"query":{"bool":{"must":[{"range":{"@timestamp":{"gte":"now-1h","lte":"now"}}},{"match":{"service.name":"my-service"}}]}}}'
\`\`\`

#### Example: Get cluster health
\`\`\`bash
curl -s "\${ELASTIC_URL}/_cluster/health" \\
  ${authHeader}
\`\`\``;
  }
}
