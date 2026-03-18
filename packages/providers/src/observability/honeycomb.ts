import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const honeycombConfigSchema = z.object({
  apiKey: z.string().min(1, "Honeycomb API key is required"),
  dataset: z.string().min(1, "Honeycomb dataset name is required"),
  logger: z.custom<Logger>().optional(),
});

export type HoneycombConfig = z.infer<typeof honeycombConfigSchema>;

export function honeycomb(config: HoneycombConfig): ObservabilityProvider {
  const parsed = honeycombConfigSchema.parse(config);
  return new HoneycombProvider(parsed);
}

const BASE_URL = "https://api.honeycomb.io";

interface HoneycombRow {
  data: Record<string, unknown>;
}

interface QueryResult {
  id?: string;
  complete?: boolean;
  data?: { results?: HoneycombRow[] };
}

class HoneycombProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly dataset: string;
  private readonly log: Logger;

  constructor(config: HoneycombConfig) {
    this.apiKey = config.apiKey;
    this.dataset = config.dataset;
    this.log = config.logger ?? consoleLogger;
  }

  private get headers(): Record<string, string> {
    return {
      "X-Honeycomb-Team": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderApiError("Honeycomb", response.status, response.statusText, text);
    }
    return (await response.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: this.headers,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderApiError("Honeycomb", response.status, response.statusText, text);
    }
    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying Honeycomb access");
    await this.get<unknown>("/1/auth");
    this.log.info("Honeycomb API access verified");
  }

  private timeRangeToSeconds(timeRange: string): number {
    const match = /^(\d+)([hdm])$/.exec(timeRange);
    if (!match) return 86400;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === "m") return value * 60;
    if (unit === "h") return value * 3600;
    return value * 86400;
  }

  private async runQuery(queryBody: unknown): Promise<HoneycombRow[]> {
    const { id } = await this.post<{ id: string }>(`/1/queries/${this.dataset}`, queryBody);

    // Poll until complete (up to 10 attempts, 1s apart)
    for (let i = 0; i < 10; i++) {
      const result = await this.get<QueryResult>(`/1/query_results/${this.dataset}/${id}`);
      if (result.complete) {
        return result.data?.results ?? [];
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    return [];
  }

  private rowToLogEntry(row: HoneycombRow): LogEntry {
    const d = row.data;
    const level = String(d.level ?? d.severity ?? d.SeverityText ?? "info").toLowerCase();
    const message = String(d.message ?? d.name ?? d.body ?? "");
    const service = String(d["service.name"] ?? d.service ?? d["app.name"] ?? "unknown");
    const timestamp = String(d.timestamp ?? d.time ?? new Date().toISOString());

    const RESERVED = new Set([
      "timestamp",
      "time",
      "level",
      "severity",
      "SeverityText",
      "message",
      "name",
      "body",
      "service.name",
      "service",
      "app.name",
    ]);
    const attributes = Object.fromEntries(
      Object.entries(d)
        .filter(([k]) => !RESERVED.has(k))
        .map(([k, v]) => [k, String(v)]),
    );

    return { timestamp, service, level, message, attributes };
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Honeycomb dataset: ${this.dataset} (range: ${opts.timeRange})`);

    const queryBody: Record<string, unknown> = {
      time_range: this.timeRangeToSeconds(opts.timeRange),
      limit: 200,
    };

    const filters: Array<Record<string, unknown>> = [];
    if (opts.severity !== "*") {
      filters.push({ column: "level", op: "=", value: opts.severity });
    }
    if (opts.serviceFilter !== "*") {
      filters.push({ column: "service.name", op: "=", value: opts.serviceFilter });
    }
    if (filters.length > 0) {
      queryBody.filters = filters;
    }

    const rows = await this.runQuery(queryBody);
    const entries = rows.map((r) => this.rowToLogEntry(r));
    this.log.info(`Found ${entries.length} log entries`);
    return entries;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Honeycomb error counts in dataset: ${this.dataset}`);

    const filters: Array<Record<string, unknown>> = [{ column: "level", op: "=", value: "error" }];
    if (opts.serviceFilter !== "*") {
      filters.push({ column: "service.name", op: "=", value: opts.serviceFilter });
    }

    const queryBody = {
      time_range: this.timeRangeToSeconds(opts.timeRange),
      calculations: [{ op: "COUNT" }],
      breakdowns: ["service.name"],
      filters,
    };

    const rows = await this.runQuery(queryBody);

    const results: AggregateResult[] = rows
      .map((r) => ({
        service: String(r.data["service.name"] ?? "unknown"),
        count: Number(r.data.COUNT ?? r.data.count ?? 0),
      }))
      .filter((r) => r.count > 0);

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    return {
      HONEYCOMB_API_KEY: this.apiKey,
      HONEYCOMB_DATASET: this.dataset,
    };
  }

  getPromptInstructions(): string {
    return `### Honeycomb Query API
- \`HONEYCOMB_API_KEY\` - Honeycomb API key (use as \`X-Honeycomb-Team: $HONEYCOMB_API_KEY\` header)
- \`HONEYCOMB_DATASET\` - Honeycomb dataset name (\`${this.dataset}\`)

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to the Honeycomb Query API via curl commands.

#### Example: Count errors by service in the last hour
\`\`\`bash
query_id=$(curl -s -X POST "https://api.honeycomb.io/1/queries/$HONEYCOMB_DATASET" \\
  -H "X-Honeycomb-Team: $HONEYCOMB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"time_range":3600,"calculations":[{"op":"COUNT"}],"breakdowns":["service.name"],"filters":[{"column":"level","op":"=","value":"error"}]}' | jq -r '.id')
curl -s "https://api.honeycomb.io/1/query_results/$HONEYCOMB_DATASET/$query_id" \\
  -H "X-Honeycomb-Team: $HONEYCOMB_API_KEY"
\`\`\`

#### Example: Fetch recent raw events
\`\`\`bash
query_id=$(curl -s -X POST "https://api.honeycomb.io/1/queries/$HONEYCOMB_DATASET" \\
  -H "X-Honeycomb-Team: $HONEYCOMB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"time_range":3600,"limit":100}' | jq -r '.id')
curl -s "https://api.honeycomb.io/1/query_results/$HONEYCOMB_DATASET/$query_id" \\
  -H "X-Honeycomb-Team: $HONEYCOMB_API_KEY"
\`\`\``;
  }
}
