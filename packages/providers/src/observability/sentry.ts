import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  ObservabilityProvider,
  LogQueryOptions,
  LogEntry,
  AggregateResult,
} from "./types.js";

export const sentryConfigSchema = z.object({
  authToken: z.string().min(1, "Sentry auth token is required"),
  organization: z.string().min(1, "Sentry organization slug is required"),
  project: z.string().min(1, "Sentry project slug is required"),
  baseUrl: z.string().default("https://sentry.io"),
  logger: z.custom<Logger>().optional(),
});

export type SentryConfig = z.infer<typeof sentryConfigSchema>;

export function sentry(config: SentryConfig): ObservabilityProvider {
  const parsed = sentryConfigSchema.parse(config);
  return new SentryProvider(parsed);
}

class SentryProvider implements ObservabilityProvider {
  private readonly authToken: string;
  private readonly org: string;
  private readonly project: string;
  private readonly baseUrl: string;
  private readonly log: Logger;

  constructor(config: SentryConfig) {
    this.authToken = config.authToken;
    this.org = config.organization;
    this.project = config.project;
    this.baseUrl = config.baseUrl;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`/api/0${path}`, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Sentry API error: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying Sentry access (org: ${this.org})`);

    await this.request(`/organizations/${this.org}/`);

    this.log.info("Sentry API access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(
      `Querying Sentry issues (severity: ${opts.severity}, range: ${opts.timeRange})`,
    );

    const levelMap: Record<string, string> = {
      error: "error",
      errors: "error",
      warning: "warning",
      warnings: "warning",
    };
    const level = levelMap[opts.severity] ?? opts.severity;

    const params: Record<string, string> = {
      query: `level:${level}`,
      statsPeriod: opts.timeRange,
      sort: "date",
    };

    if (opts.serviceFilter && opts.serviceFilter !== "*") {
      params.query += ` transaction:${opts.serviceFilter}`;
    }

    const issues = await this.request<
      Array<{
        id: string;
        title: string;
        culprit: string;
        level: string;
        firstSeen: string;
        lastSeen: string;
        count: string;
        metadata: Record<string, unknown>;
      }>
    >(`/projects/${this.org}/${this.project}/issues/`, params);

    const logs: LogEntry[] = issues.map((issue) => ({
      timestamp: issue.lastSeen,
      service: issue.culprit || "unknown",
      level: issue.level,
      message: issue.title,
      attributes: {
        issueId: issue.id,
        count: parseInt(issue.count, 10),
        firstSeen: issue.firstSeen,
        ...issue.metadata,
      },
    }));

    this.log.info(`Found ${logs.length} Sentry issues`);

    return logs;
  }

  async aggregate(
    opts: Omit<LogQueryOptions, "severity">,
  ): Promise<AggregateResult[]> {
    this.log.info(
      `Aggregating Sentry errors (range: ${opts.timeRange})`,
    );

    const params: Record<string, string> = {
      query: "level:error",
      statsPeriod: opts.timeRange,
      sort: "freq",
    };

    if (opts.serviceFilter && opts.serviceFilter !== "*") {
      params.query += ` transaction:${opts.serviceFilter}`;
    }

    const issues = await this.request<
      Array<{
        culprit: string;
        count: string;
      }>
    >(`/projects/${this.org}/${this.project}/issues/`, params);

    // Group by culprit (service/module)
    const groups = new Map<string, number>();
    for (const issue of issues) {
      const service = issue.culprit || "unknown";
      groups.set(service, (groups.get(service) ?? 0) + parseInt(issue.count, 10));
    }

    const results: AggregateResult[] = Array.from(groups.entries())
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count);

    this.log.info(`Aggregated ${results.length} service groups`);

    return results;
  }
}
