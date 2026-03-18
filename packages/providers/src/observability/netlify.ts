import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";
import type { ProviderConfigSchema } from "../config-schema.js";

export const netlifyConfigSchema = z.object({
  token: z.string().min(1, "Netlify token is required"),
  siteId: z.string().min(1, "Netlify site ID is required"),
  logger: z.custom<Logger>().optional(),
});

export type NetlifyConfig = z.infer<typeof netlifyConfigSchema>;

export const netlifyProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Netlify",
  fields: [
    { key: "token", envVar: "NETLIFY_TOKEN", description: "Netlify personal access token" },
    { key: "siteId", envVar: "NETLIFY_SITE_ID", description: "Netlify site ID" },
  ],
};

export function netlify(config: NetlifyConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = netlifyConfigSchema.parse(config);
  const provider = new NetlifyProvider(parsed);
  return Object.assign(provider, { configSchema: netlifyProviderConfigSchema });
}

function timeRangeToMs(range: string): number {
  const match = /^(\d+)(h|d|w)$/.exec(range);
  if (!match) return Date.now() - 3_600_000;
  const [, n, unit] = match;
  const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit as "h" | "d" | "w"]!;
  return Date.now() - parseInt(n, 10) * ms;
}

function inferLevel(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(fatal|error|exception|panic|failed)\b/.test(lower)) return "error";
  if (/\b(warn|warning)\b/.test(lower)) return "warning";
  return "info";
}

interface NetlifyDeploy {
  id: string;
  state: string;
  created_at: string;
  context: string | null;
  error_message: string | null;
  deploy_time: number;
  title?: string;
}

class NetlifyProvider implements ObservabilityProvider {
  private readonly token: string;
  private readonly siteId: string;
  private readonly log: Logger;

  constructor(config: NetlifyConfig) {
    this.token = config.token;
    this.siteId = config.siteId;
    this.log = config.logger ?? consoleLogger;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `https://api.netlify.com${path}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Netlify", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying Netlify access");
    await this.get("/api/v1/user");
    this.log.info("Netlify API access verified");
  }

  private async listDeploys(sinceMs: number): Promise<NetlifyDeploy[]> {
    const deploys = await this.get<NetlifyDeploy[]>(
      `/api/v1/sites/${encodeURIComponent(this.siteId)}/deploys?page=1&per_page=10`,
    );
    const sinceIso = new Date(sinceMs).toISOString();
    return deploys.filter((d) => d.created_at > sinceIso);
  }

  private async getDeployLog(deployId: string): Promise<string> {
    const result = await this.get<{ log?: string }>(`/api/v1/deploys/${encodeURIComponent(deployId)}/log`);
    return result.log ?? "";
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Netlify logs (severity: ${opts.severity}, range: ${opts.timeRange})`);

    const deploys = await this.listDeploys(timeRangeToMs(opts.timeRange));
    const entries: LogEntry[] = [];

    for (const deploy of deploys) {
      if (opts.serviceFilter !== "*" && !(deploy.context ?? "").includes(opts.serviceFilter)) {
        continue;
      }

      const logText = await this.getDeployLog(deploy.id);
      const lines = logText.split("\n").filter(Boolean);

      for (const line of lines) {
        const level = inferLevel(line);
        if (opts.severity === "error" && level !== "error") continue;
        if (opts.severity === "warning" && level !== "warning") continue;

        entries.push({
          timestamp: deploy.created_at,
          service: deploy.context ?? "production",
          level,
          message: line.trim(),
          attributes: { deployId: deploy.id, state: deploy.state },
        });
      }
    }

    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const result = entries.slice(0, 200);

    this.log.info(`Found ${result.length} Netlify log entries`);
    return result;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Netlify errors (range: ${opts.timeRange})`);

    const deploys = await this.listDeploys(timeRangeToMs(opts.timeRange));
    const counts = new Map<string, number>();

    for (const deploy of deploys) {
      if (opts.serviceFilter !== "*" && !(deploy.context ?? "").includes(opts.serviceFilter)) {
        continue;
      }

      const logText = await this.getDeployLog(deploy.id);
      const lines = logText.split("\n").filter(Boolean);
      const errorCount = lines.filter((l) => inferLevel(l) === "error").length;

      if (errorCount > 0) {
        const service = deploy.context ?? "production";
        counts.set(service, (counts.get(service) ?? 0) + errorCount);
      }
    }

    const results: AggregateResult[] = Array.from(counts.entries())
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count);

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    return { NETLIFY_TOKEN: this.token, NETLIFY_SITE_ID: this.siteId };
  }

  getPromptInstructions(): string {
    return `### Netlify Logs API
- \`NETLIFY_TOKEN\` - Personal access token (use in Authorization: Bearer header)
- \`NETLIFY_SITE_ID\` - Site ID (${this.siteId})

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to Netlify's API to query build and deploy logs.

#### Example: Verify access (get current user)
\`\`\`bash
curl -s "https://api.netlify.com/api/v1/user" \\
  -H "Authorization: Bearer \${NETLIFY_TOKEN}"
\`\`\`

#### Example: List recent deploys for a site
\`\`\`bash
curl -s "https://api.netlify.com/api/v1/sites/\${NETLIFY_SITE_ID}/deploys?page=1&per_page=5" \\
  -H "Authorization: Bearer \${NETLIFY_TOKEN}"
\`\`\`

#### Example: Get build log for a specific deploy
\`\`\`bash
# Replace DEPLOY_ID with an id from the deploys list above
curl -s "https://api.netlify.com/api/v1/deploys/DEPLOY_ID/log" \\
  -H "Authorization: Bearer \${NETLIFY_TOKEN}"
\`\`\`

Build log severity: lines containing 'error', 'failed', 'ERR' = error; 'warn', 'WARNING' = warning; otherwise info.
Service grouping: use \`context\` field from deploy (e.g. "production", "staging", "deploy-preview").`;
  }
}
