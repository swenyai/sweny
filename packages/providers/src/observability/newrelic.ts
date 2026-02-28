import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const newrelicConfigSchema = z.object({
  apiKey: z.string().min(1, "New Relic User API key is required"),
  accountId: z.string().min(1, "New Relic account ID is required"),
  region: z.enum(["us", "eu"]).default("us"),
  logger: z.custom<Logger>().optional(),
});

export type NewRelicConfig = z.infer<typeof newrelicConfigSchema>;

export function newrelic(config: NewRelicConfig): ObservabilityProvider {
  const parsed = newrelicConfigSchema.parse(config);
  return new NewRelicProvider(parsed);
}

class NewRelicProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly accountId: string;
  private readonly region: string;
  private readonly log: Logger;

  constructor(config: NewRelicConfig) {
    this.apiKey = config.apiKey;
    this.accountId = config.accountId;
    this.region = config.region;
    this.log = config.logger ?? consoleLogger;
  }

  private get endpoint(): string {
    return this.region === "eu" ? "https://api.eu.newrelic.com/graphql" : "https://api.newrelic.com/graphql";
  }

  private async nerdgraph<T>(query: string): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-Key": this.apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`New Relic NerdGraph API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { errors?: Array<{ message: string }>; data?: T };

    if (json.errors && json.errors.length > 0) {
      throw new Error(`New Relic NerdGraph query error: ${json.errors[0].message}`);
    }

    return json.data as T;
  }

  private nrql<T>(nrqlQuery: string): Promise<T> {
    const graphql = `{ actor { account(id: ${this.accountId}) { nrql(query: "${nrqlQuery}") { results } } } }`;
    return this.nerdgraph<T>(graphql);
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying New Relic access (account: ${this.accountId}, region: ${this.region})`);

    const query = `{ actor { account(id: ${this.accountId}) { name } } }`;
    const result = await this.nerdgraph<{
      actor?: { account?: { name?: string } };
    }>(query);

    const name = result.actor?.account?.name;
    if (!name) {
      throw new Error("New Relic access verification failed: could not retrieve account name");
    }

    this.log.info(`New Relic API access verified (account: ${name})`);
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    const nrqlQuery = `SELECT timestamp, service, level, message FROM Log WHERE level = '${opts.severity}' AND service LIKE '%${opts.serviceFilter}%' SINCE ${opts.timeRange} ago LIMIT 100`;
    this.log.info(`Querying New Relic logs: ${nrqlQuery}`);

    const result = await this.nrql<{
      actor?: {
        account?: {
          nrql?: {
            results?: Array<{
              timestamp?: number | string;
              service?: string;
              level?: string;
              message?: string;
              [key: string]: unknown;
            }>;
          };
        };
      };
    }>(nrqlQuery);

    const rawResults = result.actor?.account?.nrql?.results || [];

    const logs: LogEntry[] = rawResults.map((row) => {
      const { timestamp, service, level, message, ...rest } = row;
      return {
        timestamp: typeof timestamp === "number" ? new Date(timestamp).toISOString() : String(timestamp || ""),
        service: service || "unknown",
        level: level || opts.severity,
        message: message || "",
        attributes: rest as Record<string, unknown>,
      };
    });

    this.log.info(`Found ${logs.length} ${opts.severity} logs for ${opts.serviceFilter} in last ${opts.timeRange}`);

    return logs;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    const nrqlQuery = `SELECT count(*) FROM Log WHERE level = 'error' AND service LIKE '%${opts.serviceFilter}%' SINCE ${opts.timeRange} ago FACET service LIMIT 20`;
    this.log.info(`Aggregating New Relic errors: ${nrqlQuery}`);

    const result = await this.nrql<{
      actor?: {
        account?: {
          nrql?: {
            results?: Array<{
              service?: string;
              count?: number;
              [key: string]: unknown;
            }>;
          };
        };
      };
    }>(nrqlQuery);

    const rawResults = result.actor?.account?.nrql?.results || [];

    const groups: AggregateResult[] = rawResults.map((row) => ({
      service: row.service || "unknown",
      count: row.count || 0,
    }));

    this.log.info(`Aggregated ${groups.length} service groups`);

    return groups;
  }

  getAgentEnv(): Record<string, string> {
    return {
      NR_API_KEY: this.apiKey,
      NR_ACCOUNT_ID: this.accountId,
      NR_REGION: this.region,
    };
  }

  getPromptInstructions(): string {
    return `### New Relic NerdGraph API (NRQL)
- \`NR_API_KEY\` - User API key (use in API-Key header)
- \`NR_ACCOUNT_ID\` - New Relic account ID (${this.accountId})
- \`NR_REGION\` - Region: ${this.region} (endpoint: ${this.endpoint})

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

Investigate logs from New Relic across **BOTH production AND staging environments** to find bugs and issues.
You have DIRECT ACCESS to New Relic's NerdGraph (GraphQL) API via curl commands.

**Key Insight**: Catching issues in staging BEFORE they hit production is extremely valuable!
- Issues in staging only → Fix before users are affected
- Issues in both environments → Critical, affects users now
- Issues in production only → May be load/scale related

Use these environment variables in your curl commands:
- \`NR_API_KEY\` - User API key (use in API-Key header)
- \`NR_ACCOUNT_ID\` - New Relic account ID (${this.accountId})
- \`NR_REGION\` - Region: ${this.region}

#### Example: Get error counts by service
\`\`\`bash
curl -s -X POST "${this.endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "API-Key: \${NR_API_KEY}" \\
  -d '{"query":"{ actor { account(id: '\${NR_ACCOUNT_ID}') { nrql(query: \\"SELECT count(*) FROM Log WHERE level = '"'"'error'"'"' SINCE 1 hour ago FACET service LIMIT 20\\") { results } } } }"}'
\`\`\`

#### Example: Get recent error logs
\`\`\`bash
curl -s -X POST "${this.endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "API-Key: \${NR_API_KEY}" \\
  -d '{"query":"{ actor { account(id: '\${NR_ACCOUNT_ID}') { nrql(query: \\"SELECT timestamp, service, level, message FROM Log WHERE level = '"'"'error'"'"' SINCE 1 hour ago LIMIT 100\\") { results } } } }"}'
\`\`\`

#### Example: Verify access (get account name)
\`\`\`bash
curl -s -X POST "${this.endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "API-Key: \${NR_API_KEY}" \\
  -d '{"query":"{ actor { account(id: '\${NR_ACCOUNT_ID}') { name } } }"}'
\`\`\``;
  }
}
