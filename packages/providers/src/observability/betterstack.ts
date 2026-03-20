import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ProviderConfigSchema } from "../config-schema.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const betterstackConfigSchema = z.object({
  apiToken: z.string().min(1, "Better Stack API token is required"),
  sourceId: z.string().optional(),
  logger: z.custom<Logger>().optional(),
});

export type BetterStackConfig = z.infer<typeof betterstackConfigSchema>;

export const betterstackProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Better Stack",
  fields: [
    { key: "apiToken", envVar: "BETTERSTACK_API_TOKEN", description: "Better Stack Telemetry API token" },
    {
      key: "sourceId",
      envVar: "BETTERSTACK_SOURCE_ID",
      required: false,
      description: "Better Stack log source ID (optional, queries all sources if omitted)",
    },
  ],
};

export function betterstack(config: BetterStackConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = betterstackConfigSchema.parse(config);
  const provider = new BetterStackProvider(parsed);
  return Object.assign(provider, { configSchema: betterstackProviderConfigSchema });
}

const BASE_URL = "https://telemetry.betterstack.com";

/** Escape a string value for use inside a ClickHouse SQL single-quoted literal. */
function escapeSql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

interface ClickHouseRow {
  dt?: string;
  timestamp?: string;
  message?: string;
  msg?: string;
  level?: string;
  severity?: string;
  service?: string;
  [key: string]: unknown;
}

interface ClickHouseQueryResponse {
  data?: ClickHouseRow[];
}

class BetterStackProvider implements ObservabilityProvider {
  private readonly apiToken: string;
  private readonly sourceId: string | undefined;
  private readonly log: Logger;

  constructor(config: BetterStackConfig) {
    this.apiToken = config.apiToken;
    this.sourceId = config.sourceId;
    this.log = config.logger ?? consoleLogger;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  private timeRangeToInterval(timeRange: string): string {
    const match = /^(\d+)([hdm])$/.exec(timeRange);
    if (!match) return "1 DAY";
    const v = parseInt(match[1], 10);
    if (match[2] === "m") return `${v} MINUTE`;
    if (match[2] === "h") return `${v} HOUR`;
    return `${v} DAY`;
  }

  /**
   * Build base WHERE conditions shared by both queryLogs and aggregate.
   * All user-supplied filter values are escaped before interpolation.
   */
  private buildConditions(opts: { timeRange: string; serviceFilter: string; severity?: string }): string[] {
    const conditions: string[] = [`dt >= now() - INTERVAL ${this.timeRangeToInterval(opts.timeRange)}`];
    if (opts.severity && opts.severity !== "*") {
      conditions.push(`level = '${escapeSql(opts.severity)}'`);
    }
    if (opts.serviceFilter !== "*") {
      conditions.push(`service = '${escapeSql(opts.serviceFilter)}'`);
    }
    if (this.sourceId) {
      conditions.push(`source_id = '${escapeSql(this.sourceId)}'`);
    }
    return conditions;
  }

  private async runQuery(sql: string): Promise<ClickHouseRow[]> {
    const response = await fetch(`${BASE_URL}/api/v1/query`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query: sql, format: "JSON" }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderApiError("BetterStack", response.status, response.statusText, text);
    }
    const result = (await response.json()) as ClickHouseQueryResponse;
    return result.data ?? [];
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying Better Stack access");
    const response = await fetch(`${BASE_URL}/api/v1/sources`, {
      method: "GET",
      headers: this.headers,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderApiError("BetterStack", response.status, response.statusText, text);
    }
    this.log.info("Better Stack API access verified");
  }

  private rowToLogEntry(row: ClickHouseRow): LogEntry {
    const timestamp = String(row.dt ?? row.timestamp ?? new Date().toISOString());
    const message = String(row.message ?? row.msg ?? "");
    const level = String(row.level ?? row.severity ?? "info").toLowerCase();
    const service = String(row.service ?? "unknown");

    const RESERVED = new Set(["dt", "timestamp", "message", "msg", "level", "severity", "service"]);
    const attributes = Object.fromEntries(
      Object.entries(row)
        .filter(([k]) => !RESERVED.has(k))
        .map(([k, v]) => [k, String(v)]),
    );

    return { timestamp, service, level, message, attributes };
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Better Stack logs (range: ${opts.timeRange})`);
    const where = this.buildConditions(opts).join(" AND ");
    const sql = `SELECT dt, message, level, service FROM logs WHERE ${where} ORDER BY dt DESC LIMIT 200`;

    const rows = await this.runQuery(sql);
    const entries = rows.map((r) => this.rowToLogEntry(r));
    this.log.info(`Found ${entries.length} log entries`);
    return entries;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info("Aggregating Better Stack error counts");
    const where = this.buildConditions({ ...opts, severity: "error" }).join(" AND ");
    const sql = `SELECT service, count() AS cnt FROM logs WHERE ${where} GROUP BY service ORDER BY cnt DESC`;

    const rows = await this.runQuery(sql);
    const results: AggregateResult[] = rows
      .map((r) => ({ service: String(r.service ?? "unknown"), count: Number(r.cnt ?? 0) }))
      .filter((r) => r.count > 0);

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    const env: Record<string, string> = { BETTERSTACK_API_TOKEN: this.apiToken };
    if (this.sourceId) env.BETTERSTACK_SOURCE_ID = this.sourceId;
    return env;
  }

  getPromptInstructions(): string {
    const sourceNote = this.sourceId ? `\n- \`BETTERSTACK_SOURCE_ID\` - log source ID (\`${this.sourceId}\`)` : "";
    return `### Better Stack Telemetry
- \`BETTERSTACK_API_TOKEN\` - API token (use as \`Authorization: Bearer $BETTERSTACK_API_TOKEN\`)${sourceNote}

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have access to the Better Stack MCP server which exposes ClickHouse SQL query tools and telemetry data.

The MCP server is already configured. Use MCP tools to:
- Execute ClickHouse SQL queries against logs, spans, metrics, and exceptions
- Query sources, dashboards, and error tracking data
- Build and run log explorations

#### Example: Direct REST query (fallback if MCP unavailable)
\`\`\`bash
curl -s -X POST "https://telemetry.betterstack.com/api/v1/query" \\
  -H "Authorization: Bearer $BETTERSTACK_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"SELECT dt, message, level, service FROM logs WHERE dt >= now() - INTERVAL 1 HOUR AND level = '\''error'\'' ORDER BY dt DESC LIMIT 100","format":"JSON"}'
\`\`\`

#### Example: Count errors by service
\`\`\`bash
curl -s -X POST "https://telemetry.betterstack.com/api/v1/query" \\
  -H "Authorization: Bearer $BETTERSTACK_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"SELECT service, count() AS cnt FROM logs WHERE dt >= now() - INTERVAL 1 HOUR AND level = '\''error'\'' GROUP BY service ORDER BY cnt DESC","format":"JSON"}'
\`\`\``;
  }
}
