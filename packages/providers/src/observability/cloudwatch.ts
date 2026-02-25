import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  ObservabilityProvider,
  LogQueryOptions,
  LogEntry,
  AggregateResult,
} from "./types.js";

export const cloudwatchConfigSchema = z.object({
  region: z.string().default("us-east-1"),
  logGroupPrefix: z.string().min(1, "CloudWatch log group prefix is required"),
  logger: z.custom<Logger>().optional(),
});

export type CloudWatchConfig = z.infer<typeof cloudwatchConfigSchema>;

export function cloudwatch(config: CloudWatchConfig): ObservabilityProvider {
  const parsed = cloudwatchConfigSchema.parse(config);
  return new CloudWatchProvider(parsed);
}

function parseTimeRange(timeRange: string): number {
  const match = timeRange.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid time range: ${timeRange}`);
  const [, value, unit] = match;
  const ms: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
  return parseInt(value, 10) * ms[unit];
}

class CloudWatchProvider implements ObservabilityProvider {
  private readonly region: string;
  private readonly logGroupPrefix: string;
  private readonly log: Logger;
  private client: unknown;

  constructor(config: CloudWatchConfig) {
    this.region = config.region;
    this.logGroupPrefix = config.logGroupPrefix;
    this.log = config.logger ?? consoleLogger;
  }

  private async getClient() {
    if (!this.client) {
      const { CloudWatchLogsClient } = await import("@aws-sdk/client-cloudwatch-logs");
      this.client = new CloudWatchLogsClient({ region: this.region });
    }
    return this.client;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying CloudWatch access (region: ${this.region})`);

    const client = await this.getClient() as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;
    const { DescribeLogGroupsCommand } = await import("@aws-sdk/client-cloudwatch-logs");

    await client.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: this.logGroupPrefix,
        limit: 1,
      }),
    );

    this.log.info("CloudWatch access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(
      `Querying CloudWatch logs (range: ${opts.timeRange}, severity: ${opts.severity})`,
    );

    const client = await this.getClient() as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;
    const { StartQueryCommand, GetQueryResultsCommand } = await import("@aws-sdk/client-cloudwatch-logs");

    const endTime = Date.now();
    const startTime = endTime - parseTimeRange(opts.timeRange);

    const serviceFilter =
      opts.serviceFilter && opts.serviceFilter !== "*"
        ? `| filter @logStream like /${opts.serviceFilter}/`
        : "";

    const queryString = `fields @timestamp, @message, @logStream
      ${serviceFilter}
      | filter @message like /(?i)${opts.severity}/
      | sort @timestamp desc
      | limit 100`;

    const startResult = await client.send(
      new StartQueryCommand({
        logGroupName: this.logGroupPrefix,
        startTime: Math.floor(startTime / 1000),
        endTime: Math.floor(endTime / 1000),
        queryString,
      }),
    );

    const queryId = startResult.queryId!;

    // Poll for results
    let results: Array<Array<{ field?: string; value?: string }>> = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const queryResult = await client.send(
        new GetQueryResultsCommand({ queryId }),
      );
      if (queryResult.status === "Complete") {
        results = queryResult.results ?? [];
        break;
      }
    }

    const logs: LogEntry[] = results.map((row) => {
      const fields = Object.fromEntries(
        row.map((f) => [f.field, f.value]),
      );
      return {
        timestamp: fields["@timestamp"] || "",
        service: fields["@logStream"] || "unknown",
        level: opts.severity,
        message: fields["@message"] || "",
        attributes: {},
      };
    });

    this.log.info(`Found ${logs.length} CloudWatch log entries`);

    return logs;
  }

  async aggregate(
    opts: Omit<LogQueryOptions, "severity">,
  ): Promise<AggregateResult[]> {
    this.log.info(
      `Aggregating CloudWatch errors (range: ${opts.timeRange})`,
    );

    const client = await this.getClient() as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;
    const { StartQueryCommand, GetQueryResultsCommand } = await import("@aws-sdk/client-cloudwatch-logs");

    const endTime = Date.now();
    const startTime = endTime - parseTimeRange(opts.timeRange);

    const serviceFilter =
      opts.serviceFilter && opts.serviceFilter !== "*"
        ? `| filter @logStream like /${opts.serviceFilter}/`
        : "";

    const queryString = `fields @logStream
      ${serviceFilter}
      | filter @message like /(?i)error/
      | stats count(*) as errorCount by @logStream
      | sort errorCount desc
      | limit 20`;

    const startResult = await client.send(
      new StartQueryCommand({
        logGroupName: this.logGroupPrefix,
        startTime: Math.floor(startTime / 1000),
        endTime: Math.floor(endTime / 1000),
        queryString,
      }),
    );

    const queryId = startResult.queryId!;

    let results: Array<Array<{ field?: string; value?: string }>> = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const queryResult = await client.send(
        new GetQueryResultsCommand({ queryId }),
      );
      if (queryResult.status === "Complete") {
        results = queryResult.results ?? [];
        break;
      }
    }

    const groups: AggregateResult[] = results.map((row) => {
      const fields = Object.fromEntries(
        row.map((f) => [f.field, f.value]),
      );
      return {
        service: fields["@logStream"] || "unknown",
        count: parseInt(fields["errorCount"] || "0", 10),
      };
    });

    this.log.info(`Aggregated ${groups.length} service groups`);

    return groups;
  }
}
