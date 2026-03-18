import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";
import type { ProviderConfigSchema } from "../config-schema.js";

export const vercelConfigSchema = z.object({
  token: z.string().min(1, "Vercel token is required"),
  projectId: z.string().min(1, "Vercel project ID is required"),
  teamId: z.string().optional(),
  logger: z.custom<Logger>().optional(),
});

export type VercelConfig = z.infer<typeof vercelConfigSchema>;

export const vercelProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Vercel",
  fields: [
    { key: "token", envVar: "VERCEL_TOKEN", description: "Vercel personal access token" },
    { key: "projectId", envVar: "VERCEL_PROJECT_ID", description: "Vercel project ID" },
    { key: "teamId", envVar: "VERCEL_TEAM_ID", description: "Vercel team ID (optional)", required: false },
  ],
};

export function vercel(config: VercelConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = vercelConfigSchema.parse(config);
  const provider = new VercelProvider(parsed);
  return Object.assign(provider, { configSchema: vercelProviderConfigSchema });
}

function timeRangeToMs(range: string): number {
  const match = /^(\d+)(h|d|w)$/.exec(range);
  if (!match) return Date.now() - 3_600_000;
  const [, n, unit] = match;
  const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit as "h" | "d" | "w"]!;
  return Date.now() - parseInt(n, 10) * ms;
}

class VercelProvider implements ObservabilityProvider {
  private readonly token: string;
  private readonly projectId: string;
  private readonly teamId: string | undefined;
  private readonly log: Logger;

  constructor(config: VercelConfig) {
    this.token = config.token;
    this.projectId = config.projectId;
    this.teamId = config.teamId;
    this.log = config.logger ?? consoleLogger;
  }

  private teamParam(): string {
    return this.teamId ? `&teamId=${encodeURIComponent(this.teamId)}` : "";
  }

  private async get<T>(path: string): Promise<T> {
    const url = `https://api.vercel.com${path}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Vercel", response.status, response.statusText, body);
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Vercel access (project: ${this.projectId})`);

    await this.get(
      `/v9/projects/${encodeURIComponent(this.projectId)}${this.teamId ? `?teamId=${encodeURIComponent(this.teamId)}` : ""}`,
    );

    this.log.info("Vercel API access verified");
  }

  private async listDeployments(): Promise<Array<{ uid: string; name: string }>> {
    const result = await this.get<{
      deployments?: Array<{ uid: string; name: string; readyState: string }>;
    }>(`/v6/deployments?projectId=${encodeURIComponent(this.projectId)}&limit=5&state=READY${this.teamParam()}`);
    return result.deployments ?? [];
  }

  private async getDeploymentEvents(
    deploymentId: string,
    sinceMs: number,
  ): Promise<Array<{ type: string; created: number; payload?: { text?: string } }>> {
    const result = await this.get<Array<{ type: string; created: number; payload?: { text?: string } }>>(
      `/v3/deployments/${encodeURIComponent(deploymentId)}/events?direction=backward&limit=200&since=${sinceMs}${this.teamParam()}`,
    );
    return Array.isArray(result) ? result : [];
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Vercel logs (severity: ${opts.severity}, range: ${opts.timeRange})`);

    const sinceMs = timeRangeToMs(opts.timeRange);
    const deployments = await this.listDeployments();

    const entries: LogEntry[] = [];

    for (const deployment of deployments) {
      if (opts.serviceFilter !== "*" && !deployment.name.includes(opts.serviceFilter)) {
        continue;
      }

      const events = await this.getDeploymentEvents(deployment.uid, sinceMs);

      for (const event of events) {
        if (event.type !== "stdout" && event.type !== "stderr") continue;
        if (opts.severity === "error" && event.type !== "stderr") continue;

        entries.push({
          timestamp: new Date(event.created).toISOString(),
          service: deployment.name,
          level: event.type === "stderr" ? "error" : "info",
          message: event.payload?.text ?? "",
          attributes: { deploymentId: deployment.uid, eventType: event.type },
        });
      }
    }

    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const result = entries.slice(0, 200);

    this.log.info(`Found ${result.length} Vercel log entries`);
    return result;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Vercel errors (range: ${opts.timeRange})`);

    const sinceMs = timeRangeToMs(opts.timeRange);
    const deployments = await this.listDeployments();

    const counts = new Map<string, number>();

    for (const deployment of deployments) {
      if (opts.serviceFilter !== "*" && !deployment.name.includes(opts.serviceFilter)) {
        continue;
      }

      const events = await this.getDeploymentEvents(deployment.uid, sinceMs);
      const errorCount = events.filter((e) => e.type === "stderr").length;

      if (errorCount > 0) {
        counts.set(deployment.name, (counts.get(deployment.name) ?? 0) + errorCount);
      }
    }

    const results: AggregateResult[] = Array.from(counts.entries())
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count);

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    const env: Record<string, string> = {
      VERCEL_TOKEN: this.token,
      VERCEL_PROJECT_ID: this.projectId,
    };
    if (this.teamId) env.VERCEL_TEAM_ID = this.teamId;
    return env;
  }

  getPromptInstructions(): string {
    const teamParam = this.teamId ? "?teamId=${VERCEL_TEAM_ID}" : "";
    const teamSuffix = this.teamId ? "&teamId=${VERCEL_TEAM_ID}" : "";

    return `### Vercel Runtime Logs API
- \`VERCEL_TOKEN\` - Personal access token (use in Authorization: Bearer header)
- \`VERCEL_PROJECT_ID\` - Project ID (${this.projectId})
${this.teamId ? `- \`VERCEL_TEAM_ID\` - Team ID (${this.teamId})\n` : ""}
**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to Vercel's API via curl commands to investigate serverless function logs.

#### Example: Get project info (verify access)
\`\`\`bash
curl -s "https://api.vercel.com/v9/projects/\${VERCEL_PROJECT_ID}${teamParam}" \\
  -H "Authorization: Bearer \${VERCEL_TOKEN}"
\`\`\`

#### Example: List recent deployments
\`\`\`bash
curl -s "https://api.vercel.com/v6/deployments?projectId=\${VERCEL_PROJECT_ID}&limit=5&state=READY${teamSuffix}" \\
  -H "Authorization: Bearer \${VERCEL_TOKEN}"
\`\`\`

#### Example: Get runtime logs for a deployment
\`\`\`bash
# Replace DEPLOYMENT_ID with a uid from the deployments list above
curl -s "https://api.vercel.com/v3/deployments/DEPLOYMENT_ID/events?direction=backward&limit=200${teamSuffix}" \\
  -H "Authorization: Bearer \${VERCEL_TOKEN}"
\`\`\`

Event types: \`stdout\` = info logs, \`stderr\` = error logs, \`command\`/\`exit\` = lifecycle events.
Filter for errors: look for \`"type": "stderr"\` entries.`;
  }
}
