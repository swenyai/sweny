import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const pagerdutyConfigSchema = z.object({
  apiKey: z.string().min(1, "PagerDuty API key is required"),
  logger: z.custom<Logger>().optional(),
});

export type PagerDutyConfig = z.infer<typeof pagerdutyConfigSchema>;

export function pagerduty(config: PagerDutyConfig): ObservabilityProvider {
  const parsed = pagerdutyConfigSchema.parse(config);
  return new PagerDutyProvider(parsed);
}

const BASE_URL = "https://api.pagerduty.com";

interface PagerDutyIncident {
  id: string;
  title: string;
  status: string;
  urgency: string;
  created_at: string;
  html_url: string;
  service?: { summary?: string };
}

class PagerDutyProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly log: Logger;

  constructor(config: PagerDutyConfig) {
    this.apiKey = config.apiKey;
    this.log = config.logger ?? consoleLogger;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Token token=${this.apiKey}`,
      Accept: "application/vnd.pagerduty+json;version=2",
      "Content-Type": "application/json",
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("PagerDuty", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying PagerDuty access");
    await this.get<unknown>("/users/me");
    this.log.info("PagerDuty API access verified");
  }

  private timeRangeToIso(timeRange: string): string {
    const now = Date.now();
    const match = /^(\d+)([hdm])$/.exec(timeRange);
    if (!match) return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const ms = unit === "m" ? value * 60 * 1000 : unit === "h" ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
    return new Date(now - ms).toISOString();
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying PagerDuty incidents (range: ${opts.timeRange}, severity: ${opts.severity})`);

    const since = this.timeRangeToIso(opts.timeRange);
    const until = new Date().toISOString();

    const params = new URLSearchParams({
      "statuses[]": "triggered",
      time_zone: "UTC",
      since,
      until,
      limit: "100",
    });
    params.append("statuses[]", "acknowledged");

    const severityLower = opts.severity.toLowerCase();
    if (severityLower === "error" || severityLower === "critical") {
      params.set("urgency", "high");
    }

    if (opts.serviceFilter && opts.serviceFilter !== "*") {
      params.append("service_names[]", opts.serviceFilter);
    }

    const result = await this.get<{ incidents: PagerDutyIncident[] }>(`/incidents?${params.toString()}`);

    const logs: LogEntry[] = (result.incidents ?? []).map((incident) => ({
      timestamp: incident.created_at,
      service: incident.service?.summary ?? "unknown",
      level: incident.urgency === "high" ? "error" : "warning",
      message: incident.title,
      attributes: {
        id: incident.id,
        status: incident.status,
        html_url: incident.html_url,
        urgency: incident.urgency,
      },
    }));

    this.log.info(`Found ${logs.length} incidents for ${opts.serviceFilter} in last ${opts.timeRange}`);

    return logs;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating PagerDuty incidents for ${opts.serviceFilter} (range: ${opts.timeRange})`);

    const incidents = await this.queryLogs({ ...opts, severity: "" });

    const counts = new Map<string, number>();
    for (const incident of incidents) {
      counts.set(incident.service, (counts.get(incident.service) ?? 0) + 1);
    }

    const results: AggregateResult[] = Array.from(counts.entries()).map(([service, count]) => ({
      service,
      count,
    }));

    this.log.info(`Aggregated ${results.length} service groups`);

    return results;
  }

  getAgentEnv(): Record<string, string> {
    return {
      PAGERDUTY_API_KEY: this.apiKey,
    };
  }

  getPromptInstructions(): string {
    return `### PagerDuty Incidents API
- \`PAGERDUTY_API_KEY\` - API key (use in Authorization header as \`Token token=<key>\`)

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

Investigate incidents from PagerDuty to find ongoing or recent issues.
You have DIRECT ACCESS to PagerDuty's REST API via curl commands.

Use this environment variable in your curl commands:
- \`PAGERDUTY_API_KEY\` - PagerDuty API key

#### Example: List recent triggered and acknowledged incidents
\`\`\`bash
curl -s "https://api.pagerduty.com/incidents?statuses[]=triggered&statuses[]=acknowledged&time_zone=UTC&since=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)&until=$(date -u +%Y-%m-%dT%H:%M:%SZ)&limit=100" \\
  -H "Authorization: Token token=\${PAGERDUTY_API_KEY}" \\
  -H "Accept: application/vnd.pagerduty+json;version=2"
\`\`\`

#### Example: List incidents filtered by service name
\`\`\`bash
curl -s "https://api.pagerduty.com/incidents?statuses[]=triggered&statuses[]=acknowledged&service_names[]=my-service&time_zone=UTC&since=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)&until=$(date -u +%Y-%m-%dT%H:%M:%SZ)&limit=100" \\
  -H "Authorization: Token token=\${PAGERDUTY_API_KEY}" \\
  -H "Accept: application/vnd.pagerduty+json;version=2"
\`\`\``;
  }
}
