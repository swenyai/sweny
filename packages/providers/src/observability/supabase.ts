import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";
import type { ProviderConfigSchema } from "../config-schema.js";

export const supabaseConfigSchema = z.object({
  managementApiKey: z.string().min(1, "Supabase management API key is required"),
  projectRef: z.string().min(1, "Supabase project ref is required"),
  logger: z.custom<Logger>().optional(),
});

export type SupabaseConfig = z.infer<typeof supabaseConfigSchema>;

export const supabaseProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Supabase",
  fields: [
    { key: "managementApiKey", envVar: "SUPABASE_MANAGEMENT_KEY", description: "Supabase management API key" },
    { key: "projectRef", envVar: "SUPABASE_PROJECT_REF", description: "Supabase project reference ID" },
  ],
};

export function supabase(config: SupabaseConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = supabaseConfigSchema.parse(config);
  const provider = new SupabaseProvider(parsed);
  return Object.assign(provider, { configSchema: supabaseProviderConfigSchema });
}

function timeRangeToIso(range: string): string {
  const match = /^(\d+)(h|d|w)$/.exec(range);
  if (!match) return new Date(Date.now() - 3_600_000).toISOString();
  const [, n, unit] = match;
  const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit as "h" | "d" | "w"]!;
  return new Date(Date.now() - parseInt(n, 10) * ms).toISOString();
}

function sourceTables(serviceFilter: string): string[] {
  if (serviceFilter === "*") return ["postgres_logs", "edge_logs", "api_logs", "auth_logs"];
  const map: Record<string, string> = {
    postgres: "postgres_logs",
    edge: "edge_logs",
    api: "api_logs",
    auth: "auth_logs",
    storage: "storage_logs",
    realtime: "realtime_logs",
  };
  return [map[serviceFilter] ?? "postgres_logs"];
}

function severityClause(severity: string): string {
  if (severity === "error") {
    return "AND (LOWER(event_message) LIKE '%error%' OR LOWER(event_message) LIKE '%exception%' OR LOWER(event_message) LIKE '%fatal%')";
  }
  if (severity === "warning" || severity === "warn") {
    return "AND LOWER(event_message) LIKE '%warn%'";
  }
  return "";
}

function tableToService(table: string): string {
  return table.replace("_logs", "");
}

function inferLevel(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(fatal|error|exception|panic)\b/.test(lower)) return "error";
  if (/\b(warn|warning)\b/.test(lower)) return "warning";
  return "info";
}

class SupabaseProvider implements ObservabilityProvider {
  private readonly managementApiKey: string;
  private readonly projectRef: string;
  private readonly log: Logger;

  constructor(config: SupabaseConfig) {
    this.managementApiKey = config.managementApiKey;
    this.projectRef = config.projectRef;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `https://api.supabase.com${path}`;
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.managementApiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderApiError("Supabase", response.status, response.statusText, text);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Supabase access (project: ${this.projectRef})`);

    await this.request(`/v1/projects/${this.projectRef}`);

    this.log.info("Supabase API access verified");
  }

  private async queryTable(
    table: string,
    sinceIso: string,
    extraClause: string,
  ): Promise<Array<{ timestamp: string; event_message: string; metadata: Record<string, unknown> }>> {
    const sql = [
      `SELECT timestamp, event_message, metadata`,
      `FROM ${table}`,
      `WHERE timestamp > '${sinceIso}'`,
      extraClause,
      `ORDER BY timestamp DESC`,
      `LIMIT 100`,
    ]
      .filter(Boolean)
      .join(" ");

    const result = await this.request<{
      result?: Array<{ timestamp: string; event_message: string; metadata: Record<string, unknown> }>;
    }>(`/v1/projects/${this.projectRef}/analytics/endpoints/logs.all`, { sql });

    return result.result ?? [];
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Supabase logs (severity: ${opts.severity}, range: ${opts.timeRange})`);

    const sinceIso = timeRangeToIso(opts.timeRange);
    const tables = sourceTables(opts.serviceFilter);
    const extraClause = severityClause(opts.severity);

    const all: LogEntry[] = [];

    for (const table of tables) {
      const rows = await this.queryTable(table, sinceIso, extraClause);
      for (const row of rows) {
        all.push({
          timestamp: row.timestamp,
          service: tableToService(table),
          level: inferLevel(row.event_message),
          message: row.event_message,
          attributes: row.metadata ?? {},
        });
      }
    }

    all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const result = all.slice(0, 200);

    this.log.info(`Found ${result.length} Supabase log entries`);
    return result;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Supabase errors (range: ${opts.timeRange})`);

    const sinceIso = timeRangeToIso(opts.timeRange);
    const tables = sourceTables(opts.serviceFilter);
    const errorClause = severityClause("error");

    const results: AggregateResult[] = [];

    for (const table of tables) {
      const rows = await this.queryTable(table, sinceIso, errorClause);
      if (rows.length > 0) {
        results.push({ service: tableToService(table), count: rows.length });
      }
    }

    results.sort((a, b) => b.count - a.count);

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    return {
      SUPABASE_MANAGEMENT_KEY: this.managementApiKey,
      SUPABASE_PROJECT_REF: this.projectRef,
    };
  }

  getPromptInstructions(): string {
    return `### Supabase Logs API
- \`SUPABASE_MANAGEMENT_KEY\` - Management API key (use in Authorization: Bearer header)
- \`SUPABASE_PROJECT_REF\` - Project reference ID (${this.projectRef})

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to Supabase's Management API to query project logs via SQL.

Available log tables: \`postgres_logs\`, \`edge_logs\`, \`api_logs\`, \`auth_logs\`, \`storage_logs\`, \`realtime_logs\`

All tables have: \`timestamp\` (ISO 8601 string), \`event_message\` (string), \`metadata\` (JSON object).
Use ISO 8601 timestamps in WHERE clauses — e.g., \`'2024-01-01T00:00:00.000Z'\`.
To get "last 1 hour": compute \`new Date(Date.now() - 3600000).toISOString()\` and substitute below.

#### Example: Verify access / get project info
\`\`\`bash
curl -s "https://api.supabase.com/v1/projects/\${SUPABASE_PROJECT_REF}" \\
  -H "Authorization: Bearer \${SUPABASE_MANAGEMENT_KEY}"
\`\`\`

#### Example: Query recent postgres errors (last 1h)
\`\`\`bash
SINCE=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u --date="1 hour ago" +"%Y-%m-%dT%H:%M:%S.000Z")
curl -s -X POST "https://api.supabase.com/v1/projects/\${SUPABASE_PROJECT_REF}/analytics/endpoints/logs.all" \\
  -H "Authorization: Bearer \${SUPABASE_MANAGEMENT_KEY}" \\
  -H "Content-Type: application/json" \\
  -d "{\"sql\": \"SELECT timestamp, event_message, metadata FROM postgres_logs WHERE timestamp > '$SINCE' AND (LOWER(event_message) LIKE '%error%' OR LOWER(event_message) LIKE '%fatal%') ORDER BY timestamp DESC LIMIT 100\"}"
\`\`\`

#### Example: Query recent edge function logs (last 1h)
\`\`\`bash
SINCE=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u --date="1 hour ago" +"%Y-%m-%dT%H:%M:%S.000Z")
curl -s -X POST "https://api.supabase.com/v1/projects/\${SUPABASE_PROJECT_REF}/analytics/endpoints/logs.all" \\
  -H "Authorization: Bearer \${SUPABASE_MANAGEMENT_KEY}" \\
  -H "Content-Type: application/json" \\
  -d "{\"sql\": \"SELECT timestamp, event_message, metadata FROM edge_logs WHERE timestamp > '$SINCE' ORDER BY timestamp DESC LIMIT 100\"}"
\`\`\``;
  }
}
