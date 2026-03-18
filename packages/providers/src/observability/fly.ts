import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";
import type { ProviderConfigSchema } from "../config-schema.js";

export const flyConfigSchema = z.object({
  token: z.string().min(1, "Fly.io token is required"),
  appName: z.string().min(1, "Fly.io app name is required"),
  logger: z.custom<Logger>().optional(),
});

export type FlyConfig = z.infer<typeof flyConfigSchema>;

export const flyProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Fly.io",
  fields: [
    { key: "token", envVar: "FLY_TOKEN", description: "Fly.io personal access token" },
    { key: "appName", envVar: "FLY_APP_NAME", description: "Fly.io application name" },
  ],
};

export function fly(config: FlyConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = flyConfigSchema.parse(config);
  const provider = new FlyProvider(parsed);
  return Object.assign(provider, { configSchema: flyProviderConfigSchema });
}

function timeRangeToIso(range: string): string {
  const match = /^(\d+)(h|d|w)$/.exec(range);
  if (!match) return new Date(Date.now() - 3_600_000).toISOString();
  const [, n, unit] = match;
  const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit as "h" | "d" | "w"]!;
  return new Date(Date.now() - parseInt(n, 10) * ms).toISOString();
}

function mapLevel(level: string): string {
  if (level === "error" || level === "fatal") return "error";
  if (level === "warn" || level === "warning") return "warning";
  return "info";
}

interface FlyLogEntry {
  level: string;
  message: string;
  timestamp: string;
  meta?: { region?: string; app?: string; instance?: string; [key: string]: unknown };
}

class FlyProvider implements ObservabilityProvider {
  private readonly token: string;
  private readonly appName: string;
  private readonly log: Logger;

  constructor(config: FlyConfig) {
    this.token = config.token;
    this.appName = config.appName;
    this.log = config.logger ?? consoleLogger;
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`https://api.fly.io${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderApiError("Fly", response.status, response.statusText, body);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getLogs(path: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`https://api.fly.io${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderApiError("Fly", response.status, response.statusText, body);
      }
      return await response.text();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "";
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseLogLines(text: string): FlyLogEntry[] {
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as FlyLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is FlyLogEntry => entry !== null);
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Fly.io access (app: ${this.appName})`);
    await this.get(`/v1/apps/${encodeURIComponent(this.appName)}`);
    this.log.info("Fly.io API access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Fly.io logs (severity: ${opts.severity}, range: ${opts.timeRange})`);

    const sinceIso = timeRangeToIso(opts.timeRange);
    const text = await this.getLogs(`/v1/apps/${encodeURIComponent(this.appName)}/logs`);
    let entries = this.parseLogLines(text);

    // Filter by time range
    entries = entries.filter((e) => e.timestamp > sinceIso);

    // Filter by severity
    if (opts.severity === "error") {
      entries = entries.filter((e) => e.level === "error" || e.level === "fatal");
    } else if (opts.severity === "warning") {
      entries = entries.filter((e) => e.level === "warn" || e.level === "warning");
    }

    // Filter by service (region)
    if (opts.serviceFilter !== "*") {
      entries = entries.filter((e) => e.meta?.region === opts.serviceFilter);
    }

    const logs: LogEntry[] = entries.map((e) => ({
      timestamp: e.timestamp,
      service: e.meta?.region ?? "unknown",
      level: mapLevel(e.level),
      message: e.message,
      attributes: e.meta ?? {},
    }));

    logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const result = logs.slice(0, 200);

    this.log.info(`Found ${result.length} Fly.io log entries`);
    return result;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Fly.io errors (range: ${opts.timeRange})`);

    const sinceIso = timeRangeToIso(opts.timeRange);
    const text = await this.getLogs(`/v1/apps/${encodeURIComponent(this.appName)}/logs`);
    let entries = this.parseLogLines(text);

    // Filter by time range
    entries = entries.filter((e) => e.timestamp > sinceIso);

    // Filter to error+fatal
    let errors = entries.filter((e) => e.level === "error" || e.level === "fatal");

    // Filter by service (region)
    if (opts.serviceFilter !== "*") {
      errors = errors.filter((e) => e.meta?.region === opts.serviceFilter);
    }

    // Group by region
    const counts = new Map<string, number>();
    for (const e of errors) {
      const region = e.meta?.region ?? "unknown";
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }

    const results: AggregateResult[] = Array.from(counts.entries())
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count);

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    return { FLY_TOKEN: this.token, FLY_APP_NAME: this.appName };
  }

  getPromptInstructions(): string {
    return `### Fly.io Logs API
- \`FLY_TOKEN\` - Personal access token (use in Authorization: Bearer header)
- \`FLY_APP_NAME\` - Application name (${this.appName})

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to Fly.io's API to query application logs.

**Note**: The logs endpoint returns streaming NDJSON — each line is a JSON object. Use --max-time to cap the response.

#### Example: Verify access (get app info)
\`\`\`bash
curl -s "https://api.fly.io/v1/apps/\${FLY_APP_NAME}" \\
  -H "Authorization: Bearer \${FLY_TOKEN}"
\`\`\`

#### Example: Get recent application logs (NDJSON)
\`\`\`bash
curl -s --max-time 10 "https://api.fly.io/v1/apps/\${FLY_APP_NAME}/logs" \\
  -H "Authorization: Bearer \${FLY_TOKEN}"
# Each line is: {"level":"info","message":"...","timestamp":"...","meta":{"region":"iad","app":"..."}}
\`\`\`

Log levels: \`info\`, \`warn\`, \`error\`, \`debug\`, \`fatal\`. Filter errors: level === "error" or "fatal".
Service grouping: use \`meta.region\` as the service identifier.`;
  }
}
