import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";
import type { ProviderConfigSchema } from "../config-schema.js";

export const renderConfigSchema = z.object({
  apiKey: z.string().min(1, "Render API key is required"),
  serviceId: z.string().min(1, "Render service ID is required"),
  logger: z.custom<Logger>().optional(),
});

export type RenderConfig = z.infer<typeof renderConfigSchema>;

export const renderProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Render",
  fields: [
    { key: "apiKey", envVar: "RENDER_API_KEY", description: "Render API key" },
    { key: "serviceId", envVar: "RENDER_SERVICE_ID", description: "Render service ID" },
  ],
};

export function render(config: RenderConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = renderConfigSchema.parse(config);
  const provider = new RenderProvider(parsed);
  return Object.assign(provider, { configSchema: renderProviderConfigSchema });
}

function timeRangeToIso(range: string): string {
  const match = /^(\d+)(h|d|w)$/.exec(range);
  if (!match) return new Date(Date.now() - 3_600_000).toISOString();
  const [, n, unit] = match;
  const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit as "h" | "d" | "w"]!;
  return new Date(Date.now() - parseInt(n, 10) * ms).toISOString();
}

function inferLevel(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(fatal|error|exception|panic)\b/.test(lower)) return "error";
  if (/\b(warn|warning)\b/.test(lower)) return "warning";
  return "info";
}

interface RenderLogEntry {
  id: string;
  timestamp: string;
  message: string;
  instance?: { id: string; serviceId: string; instanceType: string };
}

class RenderProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly serviceId: string;
  private readonly log: Logger;

  constructor(config: RenderConfig) {
    this.apiKey = config.apiKey;
    this.serviceId = config.serviceId;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `https://api.render.com${path}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Render", response.status, response.statusText, body);
    }
    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Render access (service: ${this.serviceId})`);
    await this.request(`/v1/services/${encodeURIComponent(this.serviceId)}`);
    this.log.info("Render API access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Render logs (severity: ${opts.severity}, range: ${opts.timeRange})`);

    const startTime = timeRangeToIso(opts.timeRange);
    const endTime = new Date().toISOString();

    const result = await this.request<{ logs: RenderLogEntry[] }>(
      `/v1/services/${encodeURIComponent(this.serviceId)}/logs?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&limit=200&direction=backward`,
    );

    let logs = (result.logs ?? []).map((log) => ({
      timestamp: log.timestamp,
      service: log.instance?.serviceId ?? this.serviceId,
      level: inferLevel(log.message),
      message: log.message,
      attributes: { instanceId: log.instance?.id },
    }));

    // Post-filter by severity
    if (opts.severity === "error") logs = logs.filter((l) => l.level === "error");
    else if (opts.severity === "warning") logs = logs.filter((l) => l.level === "warning");

    // Post-filter by service
    if (opts.serviceFilter !== "*") logs = logs.filter((l) => l.service.includes(opts.serviceFilter));

    const resultLogs = logs.slice(0, 200);
    this.log.info(`Found ${resultLogs.length} Render log entries`);
    return resultLogs;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Render errors (range: ${opts.timeRange})`);

    const startTime = timeRangeToIso(opts.timeRange);

    const result = await this.request<{ logs: RenderLogEntry[] }>(
      `/v1/services/${encodeURIComponent(this.serviceId)}/logs?startTime=${encodeURIComponent(startTime)}&limit=200&direction=backward`,
    );

    const errorCount = (result.logs ?? []).filter((l) => inferLevel(l.message) === "error").length;
    if (errorCount === 0) return [];

    return [{ service: this.serviceId, count: errorCount }];
  }

  getAgentEnv(): Record<string, string> {
    return { RENDER_API_KEY: this.apiKey, RENDER_SERVICE_ID: this.serviceId };
  }

  getPromptInstructions(): string {
    return `### Render Logs API
- \`RENDER_API_KEY\` - API key (use in Authorization: Bearer header)
- \`RENDER_SERVICE_ID\` - Service ID (${this.serviceId})

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to Render's API to query runtime logs from web services and workers.

**Note**: Render logs API does not return a severity field — infer level from message content.

#### Example: Verify access (get service details)
\`\`\`bash
curl -s "https://api.render.com/v1/services/\${RENDER_SERVICE_ID}" \\
  -H "Authorization: Bearer \${RENDER_API_KEY}" \\
  -H "Accept: application/json"
\`\`\`

#### Example: Query recent logs (last 1h)
\`\`\`bash
SINCE=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u --date="1 hour ago" +"%Y-%m-%dT%H:%M:%SZ")
curl -s "https://api.render.com/v1/services/\${RENDER_SERVICE_ID}/logs?startTime=\${SINCE}&limit=200&direction=backward" \\
  -H "Authorization: Bearer \${RENDER_API_KEY}" \\
  -H "Accept: application/json"
\`\`\`

Response shape: \`{ "logs": [{ "id": "...", "timestamp": "...", "message": "...", "instance": { "id": "...", "serviceId": "..." } }] }\`
Severity is inferred: "error"/"exception"/"fatal" → error, "warn"/"warning" → warning, else info.`;
  }
}
