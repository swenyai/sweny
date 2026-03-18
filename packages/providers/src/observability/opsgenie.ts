import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const opsgenieConfigSchema = z.object({
  apiKey: z.string().min(1, "OpsGenie API key is required"),
  region: z.enum(["us", "eu"]).optional().default("us"),
  logger: z.custom<Logger>().optional(),
});

export type OpsGenieConfig = z.infer<typeof opsgenieConfigSchema>;

export function opsgenie(config: OpsGenieConfig): ObservabilityProvider {
  const parsed = opsgenieConfigSchema.parse(config);
  return new OpsGenieProvider(parsed);
}

const BASE_URLS: Record<string, string> = {
  us: "https://api.opsgenie.com",
  eu: "https://api.eu.opsgenie.com",
};

interface OpsGenieAlert {
  id: string;
  message: string;
  status: string;
  acknowledged: boolean;
  source?: string;
  alias?: string;
  createdAt: string;
  teams?: Array<{ name?: string; id: string }>;
  priority: string; // P1–P5
  tags?: string[];
}

function priorityToLevel(priority: string): string {
  if (priority === "P1") return "fatal";
  if (priority === "P2") return "error";
  if (priority === "P3" || priority === "P4") return "warning";
  return "info";
}

function timeRangeToIso(timeRange: string): string {
  const now = Date.now();
  const match = /^(\d+)([hdm])$/.exec(timeRange);
  if (!match) return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === "m" ? value * 60 * 1000 : unit === "h" ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

class OpsGenieProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly log: Logger;

  constructor(config: OpsGenieConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = BASE_URLS[config.region ?? "us"];
    this.log = config.logger ?? consoleLogger;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `GenieKey ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("OpsGenie", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying OpsGenie access");
    await this.get<unknown>("/v2/users?limit=1");
    this.log.info("OpsGenie API access verified");
  }

  private alertToLogEntry(alert: OpsGenieAlert): LogEntry {
    const service = alert.teams?.[0]?.name ?? alert.source ?? "unknown";
    return {
      timestamp: alert.createdAt,
      service,
      level: priorityToLevel(alert.priority),
      message: alert.message,
      attributes: {
        id: alert.id,
        status: alert.status,
        priority: alert.priority,
        alias: alert.alias,
        tags: alert.tags,
      },
    };
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying OpsGenie alerts (range: ${opts.timeRange}, severity: ${opts.severity})`);

    const since = timeRangeToIso(opts.timeRange);
    const queryParts = [`createdAt > ${since}`];
    if (opts.serviceFilter && opts.serviceFilter !== "*") {
      queryParts.push(`teams: "${opts.serviceFilter}"`);
    }

    const params = new URLSearchParams({
      limit: "100",
      order: "desc",
      query: queryParts.join(" AND "),
    });

    const result = await this.get<{ data: OpsGenieAlert[] }>(`/v2/alerts?${params.toString()}`);
    let entries = (result.data ?? []).map((a) => this.alertToLogEntry(a));

    if (opts.severity !== "*") {
      entries = entries.filter((e) => e.level === opts.severity.toLowerCase());
    }

    this.log.info(`Found ${entries.length} alerts`);
    return entries;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating OpsGenie alerts for ${opts.serviceFilter}`);

    const all = await this.queryLogs({ ...opts, severity: "*" });
    const errorAlerts = all.filter((a) => a.level === "error" || a.level === "fatal");

    const counts = new Map<string, number>();
    for (const alert of errorAlerts) {
      counts.set(alert.service, (counts.get(alert.service) ?? 0) + 1);
    }

    const results: AggregateResult[] = Array.from(counts.entries()).map(([service, count]) => ({
      service,
      count,
    }));

    this.log.info(`Aggregated ${results.length} team/source groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    return {
      OPSGENIE_API_KEY: this.apiKey,
    };
  }

  getPromptInstructions(): string {
    return `### OpsGenie Alerts API
- \`OPSGENIE_API_KEY\` - OpsGenie API key (use as \`Authorization: GenieKey $OPSGENIE_API_KEY\`)

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to the OpsGenie REST API via curl commands.

#### Example: List recent open alerts
\`\`\`bash
curl -s "${this.baseUrl}/v2/alerts?status=open&limit=100&order=desc" \\
  -H "Authorization: GenieKey $OPSGENIE_API_KEY"
\`\`\`

#### Example: Filter alerts by team
\`\`\`bash
curl -s "${this.baseUrl}/v2/alerts?query=teams:%22my-team%22&limit=100" \\
  -H "Authorization: GenieKey $OPSGENIE_API_KEY"
\`\`\``;
  }
}
