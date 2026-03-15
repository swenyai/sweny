import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";
import type { ProviderConfigSchema } from "../config-schema.js";

export const splunkConfigSchema = z.object({
  baseUrl: z.string().min(1, "Splunk instance URL is required"),
  token: z.string().min(1, "Splunk Bearer token is required"),
  index: z.string().default("main"),
  logger: z.custom<Logger>().optional(),
});

export type SplunkConfig = z.infer<typeof splunkConfigSchema>;

export const splunkProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Splunk",
  fields: [
    { key: "baseUrl", envVar: "SPLUNK_URL", description: "Splunk instance URL" },
    { key: "token", envVar: "SPLUNK_TOKEN", description: "Splunk Bearer token" },
  ],
};

function escapeSpl(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function splunk(config: SplunkConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = splunkConfigSchema.parse(config);
  const provider = new SplunkProvider(parsed);
  return Object.assign(provider, { configSchema: splunkProviderConfigSchema });
}

class SplunkProvider implements ObservabilityProvider {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly index: string;
  private readonly log: Logger;

  constructor(config: SplunkConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.index = config.index;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(method: "GET" | "POST", path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set("output_mode", "json");

    if (method === "GET" && params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    const fetchOpts: RequestInit = { method, headers };

    if (method === "POST" && params) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      fetchOpts.body = new URLSearchParams(params).toString();
    }

    const response = await fetch(url.toString(), fetchOpts);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Splunk", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  private async runSearch<T>(spl: string): Promise<T> {
    this.log.debug(`Running SPL: ${spl}`);

    // Create the search job
    const job = await this.request<{ sid: string }>("POST", "/services/search/jobs", {
      search: spl,
      exec_mode: "normal",
    });

    const sid = job.sid;
    this.log.debug(`Search job created: ${sid}`);

    // Poll for completion
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const status = await this.request<{
        entry?: Array<{
          content?: { dispatchState?: string; isDone?: boolean };
        }>;
      }>("GET", `/services/search/jobs/${sid}`);

      const entry = status.entry?.[0]?.content;
      if (entry?.isDone || entry?.dispatchState === "DONE") {
        break;
      }
    }

    // Fetch results
    const results = await this.request<T>("GET", `/services/search/jobs/${sid}/results`, {
      count: "100",
    });

    return results;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Splunk access (${this.baseUrl})`);

    await this.request<unknown>("GET", "/services/server/info");

    this.log.info("Splunk API access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    const spl = `search index=${this.index} host="${escapeSpl(opts.serviceFilter)}" log_level="${escapeSpl(opts.severity)}" earliest=-${opts.timeRange}`;
    this.log.info(`Querying Splunk logs: ${spl}`);

    const result = await this.runSearch<{
      results?: Array<{
        _time?: string;
        host?: string;
        log_level?: string;
        _raw?: string;
        [key: string]: unknown;
      }>;
    }>(spl);

    const logs: LogEntry[] = (result.results || []).map((event) => {
      const { _time, host, log_level, _raw, ...rest } = event;
      return {
        timestamp: _time || "",
        service: host || "unknown",
        level: log_level || opts.severity,
        message: _raw || "",
        attributes: rest as Record<string, unknown>,
      };
    });

    this.log.info(`Found ${logs.length} ${opts.severity} logs for ${opts.serviceFilter} in last ${opts.timeRange}`);

    return logs;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    const spl = `search index=${this.index} host="${escapeSpl(opts.serviceFilter)}" log_level=error earliest=-${opts.timeRange} | stats count by host`;
    this.log.info(`Aggregating Splunk errors: ${spl}`);

    const result = await this.runSearch<{
      results?: Array<{
        host?: string;
        count?: string;
      }>;
    }>(spl);

    const groups: AggregateResult[] = (result.results || []).map((row) => ({
      service: row.host || "unknown",
      count: parseInt(row.count || "0", 10),
    }));

    this.log.info(`Aggregated ${groups.length} service groups`);

    return groups;
  }

  getAgentEnv(): Record<string, string> {
    return {
      SPLUNK_URL: this.baseUrl,
      SPLUNK_TOKEN: this.token,
      SPLUNK_INDEX: this.index,
    };
  }

  getPromptInstructions(): string {
    return `### Splunk REST API
- \`SPLUNK_URL\` - Splunk instance URL (${this.baseUrl})
- \`SPLUNK_TOKEN\` - Bearer token for authentication
- \`SPLUNK_INDEX\` - Splunk index (${this.index})

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

Investigate logs from Splunk across **BOTH production AND staging environments** to find bugs and issues.
You have DIRECT ACCESS to Splunk's REST API via curl commands.

**Key Insight**: Catching issues in staging BEFORE they hit production is extremely valuable!
- Issues in staging only → Fix before users are affected
- Issues in both environments → Critical, affects users now
- Issues in production only → May be load/scale related

Use these environment variables in your curl commands:
- \`SPLUNK_URL\` - Splunk instance URL (${this.baseUrl})
- \`SPLUNK_TOKEN\` - Bearer token (use in Authorization: Bearer header)
- \`SPLUNK_INDEX\` - Splunk index (${this.index})

#### Example: Get error counts by host
\`\`\`bash
curl -s -X POST "\${SPLUNK_URL}/services/search/jobs" \\
  -H "Authorization: Bearer \${SPLUNK_TOKEN}" \\
  -d "search=search index=\${SPLUNK_INDEX} log_level=error earliest=-1h | stats count by host" \\
  -d "output_mode=json" \\
  -d "exec_mode=oneshot"
\`\`\`

#### Example: Get recent error logs
\`\`\`bash
curl -s -X POST "\${SPLUNK_URL}/services/search/jobs" \\
  -H "Authorization: Bearer \${SPLUNK_TOKEN}" \\
  -d "search=search index=\${SPLUNK_INDEX} log_level=error earliest=-1h" \\
  -d "output_mode=json" \\
  -d "exec_mode=oneshot"
\`\`\`

#### Example: Create a search job and poll for results
\`\`\`bash
# Create the search job
SID=$(curl -s -X POST "\${SPLUNK_URL}/services/search/jobs" \\
  -H "Authorization: Bearer \${SPLUNK_TOKEN}" \\
  -d "search=search index=\${SPLUNK_INDEX} log_level=error earliest=-24h" \\
  -d "output_mode=json" | jq -r '.sid')

# Poll until done
curl -s "\${SPLUNK_URL}/services/search/jobs/\${SID}?output_mode=json" \\
  -H "Authorization: Bearer \${SPLUNK_TOKEN}"

# Fetch results
curl -s "\${SPLUNK_URL}/services/search/jobs/\${SID}/results?output_mode=json&count=100" \\
  -H "Authorization: Bearer \${SPLUNK_TOKEN}"
\`\`\`

#### Example: Get server info (verify access)
\`\`\`bash
curl -s "\${SPLUNK_URL}/services/server/info?output_mode=json" \\
  -H "Authorization: Bearer \${SPLUNK_TOKEN}"
\`\`\``;
  }
}
