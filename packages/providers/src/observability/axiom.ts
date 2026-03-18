import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const axiomConfigSchema = z.object({
  apiToken: z.string().min(1, "Axiom API token is required"),
  dataset: z.string().min(1, "Axiom dataset name is required"),
  orgId: z.string().optional(),
  logger: z.custom<Logger>().optional(),
});

export type AxiomConfig = z.infer<typeof axiomConfigSchema>;

export function axiom(config: AxiomConfig): ObservabilityProvider {
  const parsed = axiomConfigSchema.parse(config);
  return new AxiomProvider(parsed);
}

const BASE_URL = "https://api.axiom.co";

interface AxiomMatch {
  _time: string;
  data: Record<string, unknown>;
}

interface AxiomQueryResponse {
  matches?: AxiomMatch[];
}

class AxiomProvider implements ObservabilityProvider {
  private readonly apiToken: string;
  private readonly dataset: string;
  private readonly orgId: string | undefined;
  private readonly log: Logger;

  constructor(config: AxiomConfig) {
    this.apiToken = config.apiToken;
    this.dataset = config.dataset;
    this.orgId = config.orgId;
    this.log = config.logger ?? consoleLogger;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
    if (this.orgId) h["X-Axiom-Org-Id"] = this.orgId;
    return h;
  }

  private timeRangeToWindow(timeRange: string): { startTime: string; endTime: string } {
    const match = /^(\d+)([hdm])$/.exec(timeRange);
    let ms = 86400 * 1000;
    if (match) {
      const v = parseInt(match[1], 10);
      if (match[2] === "m") ms = v * 60 * 1000;
      else if (match[2] === "h") ms = v * 3600 * 1000;
      else ms = v * 86400 * 1000;
    }
    const now = Date.now();
    return {
      startTime: new Date(now - ms).toISOString(),
      endTime: new Date(now).toISOString(),
    };
  }

  private async runApl(apl: string, startTime: string, endTime: string): Promise<AxiomMatch[]> {
    const response = await fetch(`${BASE_URL}/v1/datasets/_apl?format=legacy`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ apl, startTime, endTime }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderApiError("Axiom", response.status, response.statusText, text);
    }
    const result = (await response.json()) as AxiomQueryResponse;
    return result.matches ?? [];
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying Axiom access");
    const response = await fetch(`${BASE_URL}/v1/datasets`, {
      method: "GET",
      headers: this.headers,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderApiError("Axiom", response.status, response.statusText, text);
    }
    this.log.info("Axiom API access verified");
  }

  private matchToLogEntry(match: AxiomMatch): LogEntry {
    const d = match.data;
    const level = String(d.level ?? d.severity ?? d["@level"] ?? "info").toLowerCase();
    const message = String(d.message ?? d.msg ?? d["@message"] ?? d.body ?? "");
    const service = String(d["service.name"] ?? d.service ?? d.app ?? "unknown");
    const timestamp = match._time || new Date().toISOString();

    const RESERVED = new Set([
      "level",
      "severity",
      "@level",
      "message",
      "msg",
      "@message",
      "body",
      "service.name",
      "service",
      "app",
    ]);
    const attributes = Object.fromEntries(
      Object.entries(d)
        .filter(([k]) => !RESERVED.has(k))
        .map(([k, v]) => [k, String(v)]),
    );

    return { timestamp, service, level, message, attributes };
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Axiom dataset: ${this.dataset} (range: ${opts.timeRange})`);
    const { startTime, endTime } = this.timeRangeToWindow(opts.timeRange);

    const parts: string[] = [`['${this.dataset}']`];
    if (opts.severity !== "*") {
      parts.push(`| where level == "${opts.severity}"`);
    }
    if (opts.serviceFilter !== "*") {
      parts.push(`| where service == "${opts.serviceFilter}"`);
    }
    parts.push("| sort by _time desc | limit 200");
    const apl = parts.join(" ");

    const matches = await this.runApl(apl, startTime, endTime);
    const entries = matches.map((m) => this.matchToLogEntry(m));
    this.log.info(`Found ${entries.length} log entries`);
    return entries;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info(`Aggregating Axiom error counts in dataset: ${this.dataset}`);
    const { startTime, endTime } = this.timeRangeToWindow(opts.timeRange);

    const parts: string[] = [`['${this.dataset}']`, `| where level == "error"`];
    if (opts.serviceFilter !== "*") {
      parts.push(`| where service == "${opts.serviceFilter}"`);
    }
    parts.push("| summarize count() by service");
    parts.push("| sort by _count desc");
    const apl = parts.join(" ");

    const matches = await this.runApl(apl, startTime, endTime);
    const results: AggregateResult[] = matches
      .map((m) => ({
        service: String(m.data.service ?? "unknown"),
        count: Number(m.data["_count"] ?? m.data["count()"] ?? m.data.count ?? 0),
      }))
      .filter((r) => r.count > 0);

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    const env: Record<string, string> = {
      AXIOM_TOKEN: this.apiToken,
      AXIOM_DATASET: this.dataset,
    };
    if (this.orgId) env.AXIOM_ORG_ID = this.orgId;
    return env;
  }

  getPromptInstructions(): string {
    const orgLine = this.orgId ? `\n  -H "X-Axiom-Org-Id: $AXIOM_ORG_ID" \\` : "";
    const orgNote = this.orgId ? `\n- \`AXIOM_ORG_ID\` - Axiom org ID (\`${this.orgId}\`)` : "";
    return `### Axiom Query API (APL)
- \`AXIOM_TOKEN\` - Axiom API token (use as \`Authorization: Bearer $AXIOM_TOKEN\` header)
- \`AXIOM_DATASET\` - Axiom dataset name (\`${this.dataset}\`)${orgNote}

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

You have DIRECT ACCESS to the Axiom APL Query API via curl commands.

#### Example: Count errors by service in the last hour
\`\`\`bash
START=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST "https://api.axiom.co/v1/datasets/_apl?format=legacy" \\
  -H "Authorization: Bearer $AXIOM_TOKEN" \\${orgLine}
  -H "Content-Type: application/json" \\
  -d "{\\"apl\\":\\"['${this.dataset}'] | where level == 'error' | summarize count() by service | sort by _count desc\\",\\"startTime\\":\\"$START\\",\\"endTime\\":\\"$END\\"}"
\`\`\`

#### Example: Fetch recent raw events
\`\`\`bash
START=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST "https://api.axiom.co/v1/datasets/_apl?format=legacy" \\
  -H "Authorization: Bearer $AXIOM_TOKEN" \\${orgLine}
  -H "Content-Type: application/json" \\
  -d "{\\"apl\\":\\"['${this.dataset}'] | sort by _time desc | limit 100\\",\\"startTime\\":\\"$START\\",\\"endTime\\":\\"$END\\"}"
\`\`\``;
  }
}
