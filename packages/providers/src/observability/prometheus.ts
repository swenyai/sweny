import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const prometheusConfigSchema = z.object({
  url: z.string().url("Prometheus base URL is required"),
  token: z.string().optional(),
  logger: z.custom<Logger>().optional(),
});

export type PrometheusConfig = z.infer<typeof prometheusConfigSchema>;

export function prometheus(config: PrometheusConfig): ObservabilityProvider {
  const parsed = prometheusConfigSchema.parse(config);
  return new PrometheusProvider(parsed);
}

interface PrometheusAlert {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  state?: string;
  activeAt?: string;
}

class PrometheusProvider implements ObservabilityProvider {
  private readonly url: string;
  private readonly token: string | undefined;
  private readonly log: Logger;

  constructor(config: PrometheusConfig) {
    this.url = config.url.replace(/\/$/, "");
    this.token = config.token;
    this.log = config.logger ?? consoleLogger;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.url}${path}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Prometheus", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  private alertToLogEntry(alert: PrometheusAlert): LogEntry {
    return {
      timestamp: alert.activeAt ?? new Date().toISOString(),
      service: alert.labels?.service ?? alert.labels?.job ?? "unknown",
      level: alert.labels?.severity ?? "warning",
      message: alert.annotations?.summary ?? alert.labels?.alertname ?? "",
      attributes: {
        alertname: alert.labels?.alertname,
        labels: alert.labels,
        annotations: alert.annotations,
        state: alert.state,
      },
    };
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Prometheus access (url: ${this.url})`);
    await this.get("/api/v1/status/buildinfo");
    this.log.info("Prometheus API access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Prometheus alerts (severity: ${opts.severity}, service: ${opts.serviceFilter})`);

    const result = await this.get<{ data: { alerts: PrometheusAlert[] } }>("/api/v1/alerts");
    let alerts = result.data.alerts ?? [];

    if (opts.severity !== "*") {
      alerts = alerts.filter((a) => a.labels?.severity === opts.severity);
    }

    if (opts.serviceFilter !== "*") {
      alerts = alerts.filter(
        (a) =>
          a.labels?.service === opts.serviceFilter ||
          a.labels?.job === opts.serviceFilter ||
          a.labels?.namespace === opts.serviceFilter,
      );
    }

    const entries = alerts.map((a) => this.alertToLogEntry(a));
    this.log.info(`Found ${entries.length} alerts`);
    return entries;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Prometheus alerts for ${opts.serviceFilter}`);

    const result = await this.get<{ data: { alerts: PrometheusAlert[] } }>("/api/v1/alerts");
    let alerts = result.data.alerts ?? [];

    if (opts.serviceFilter !== "*") {
      alerts = alerts.filter(
        (a) =>
          a.labels?.service === opts.serviceFilter ||
          a.labels?.job === opts.serviceFilter ||
          a.labels?.namespace === opts.serviceFilter,
      );
    }

    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const service = alert.labels?.service ?? alert.labels?.job ?? "unknown";
      counts.set(service, (counts.get(service) ?? 0) + 1);
    }

    const groups: AggregateResult[] = Array.from(counts.entries()).map(([service, count]) => ({
      service,
      count,
    }));

    this.log.info(`Aggregated ${groups.length} service groups`);
    return groups;
  }

  getAgentEnv(): Record<string, string> {
    return {
      PROMETHEUS_URL: this.url,
      ...(this.token ? { PROMETHEUS_TOKEN: this.token } : {}),
    };
  }

  getPromptInstructions(): string {
    const authHeader = this.token
      ? `  -H "Authorization: Bearer $PROMETHEUS_TOKEN" \\`
      : "";
    const authNote = this.token
      ? `- \`PROMETHEUS_TOKEN\` - Bearer token (include as \`Authorization: Bearer $PROMETHEUS_TOKEN\` header)`
      : "";

    return `### Prometheus Alerts API
- \`PROMETHEUS_URL\` - Base URL of the Prometheus server (e.g., http://localhost:9090)
${authNote}

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to the Prometheus HTTP API via curl commands.

#### Example: List all currently firing alerts
\`\`\`bash
curl -s \\
${authHeader ? authHeader + "\n" : ""}  "$PROMETHEUS_URL/api/v1/alerts"
\`\`\`

#### Example: Run an instant PromQL query
\`\`\`bash
curl -s \\
${authHeader ? authHeader + "\n" : ""}  "$PROMETHEUS_URL/api/v1/query?query=up"
\`\`\``;
  }
}
