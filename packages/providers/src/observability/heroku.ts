import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const herokuConfigSchema = z.object({
  apiKey: z.string().min(1, "Heroku API key is required"),
  appName: z.string().min(1, "Heroku app name is required"),
  logger: z.custom<Logger>().optional(),
});

export type HerokuConfig = z.infer<typeof herokuConfigSchema>;

export function heroku(config: HerokuConfig): ObservabilityProvider {
  const parsed = herokuConfigSchema.parse(config);
  return new HerokuProvider(parsed);
}

const BASE_URL = "https://api.heroku.com";

// Heroku logplex line: "2024-01-01T00:00:00+00:00 app[web.1]: message"
const LOG_LINE_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.+-]+)\s+\S+\[([^\]]+)\]:\s*(.*)$/;

function inferLevel(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(fatal|error|exception|panic|failed)\b/.test(lower)) return "error";
  if (/\b(warn|warning)\b/.test(lower)) return "warning";
  return "info";
}

function timeRangeToMs(timeRange: string): number {
  const match = /^(\d+)([hdm])$/.exec(timeRange);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}

interface ParsedLine {
  timestamp: string;
  dyno: string;
  dynoType: string;
  message: string;
}

class HerokuProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly appName: string;
  private readonly log: Logger;

  constructor(config: HerokuConfig) {
    this.apiKey = config.apiKey;
    this.appName = config.appName;
    this.log = config.logger ?? consoleLogger;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/vnd.heroku+json; version=3",
      "Content-Type": "application/json",
    };
  }

  private async request<T>(path: string, opts?: { method?: string; body?: string }): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: opts?.method ?? "GET",
      headers: this.headers,
      body: opts?.body,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Heroku", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Heroku access for app: ${this.appName}`);
    await this.request(`/apps/${this.appName}`);
    this.log.info("Heroku API access verified");
  }

  private parseLogLines(text: string): ParsedLine[] {
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const match = LOG_LINE_RE.exec(line);
        if (!match) return [];
        const [, timestamp, dyno, message] = match;
        // "web.1" → "web", "heroku/router" → "heroku"
        const dynoType = dyno.split(/[./]/)[0];
        return [{ timestamp, dyno, dynoType, message }];
      });
  }

  private async fetchLogText(lines: number): Promise<string> {
    const session = await this.request<{ logplex_url: string }>(`/apps/${this.appName}/log-sessions`, {
      method: "POST",
      body: JSON.stringify({ lines, tail: false }),
    });
    const logResp = await fetch(session.logplex_url);
    if (!logResp.ok) {
      throw new ProviderApiError("Heroku", logResp.status, logResp.statusText, "");
    }
    return logResp.text();
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Heroku logs for app: ${this.appName} (range: ${opts.timeRange})`);

    const since = Date.now() - timeRangeToMs(opts.timeRange);
    const text = await this.fetchLogText(1500);
    const parsed = this.parseLogLines(text);

    let entries: LogEntry[] = parsed
      .filter((l) => new Date(l.timestamp).getTime() >= since)
      .map((l) => ({
        timestamp: l.timestamp,
        service: l.dynoType,
        level: inferLevel(l.message),
        message: l.message,
        attributes: { dyno: l.dyno },
      }));

    if (opts.serviceFilter !== "*") {
      entries = entries.filter((e) => e.service === opts.serviceFilter);
    }

    if (opts.severity !== "*") {
      entries = entries.filter((e) => e.level === opts.severity.toLowerCase());
    }

    this.log.info(`Found ${entries.length} log entries`);
    return entries;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Heroku error logs for app: ${this.appName}`);

    const since = Date.now() - timeRangeToMs(opts.timeRange);
    const text = await this.fetchLogText(1500);
    let errorLines = this.parseLogLines(text)
      .filter((l) => new Date(l.timestamp).getTime() >= since)
      .filter((l) => inferLevel(l.message) === "error");

    if (opts.serviceFilter !== "*") {
      errorLines = errorLines.filter((l) => l.dynoType === opts.serviceFilter);
    }

    const counts = new Map<string, number>();
    for (const l of errorLines) {
      counts.set(l.dynoType, (counts.get(l.dynoType) ?? 0) + 1);
    }

    const results: AggregateResult[] = Array.from(counts.entries()).map(([service, count]) => ({
      service,
      count,
    }));

    this.log.info(`Aggregated ${results.length} dyno groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    return {
      HEROKU_API_KEY: this.apiKey,
      HEROKU_APP_NAME: this.appName,
    };
  }

  getPromptInstructions(): string {
    return `### Heroku Logs API
- \`HEROKU_API_KEY\` - Heroku API key (use as \`Authorization: Bearer $HEROKU_API_KEY\`)
- \`HEROKU_APP_NAME\` - Heroku application name (\`${this.appName}\`)

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to the Heroku Platform API via curl commands.

#### Example: Fetch recent log lines via a log session
\`\`\`bash
logplex_url=$(curl -s -X POST "https://api.heroku.com/apps/$HEROKU_APP_NAME/log-sessions" \\
  -H "Authorization: Bearer $HEROKU_API_KEY" \\
  -H "Accept: application/vnd.heroku+json; version=3" \\
  -H "Content-Type: application/json" \\
  -d '{"lines": 200, "tail": false}' | jq -r '.logplex_url')
curl -s "$logplex_url"
\`\`\`

#### Example: Get app info
\`\`\`bash
curl -s "https://api.heroku.com/apps/$HEROKU_APP_NAME" \\
  -H "Authorization: Bearer $HEROKU_API_KEY" \\
  -H "Accept: application/vnd.heroku+json; version=3"
\`\`\``;
  }
}
