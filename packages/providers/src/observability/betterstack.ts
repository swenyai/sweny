import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError, ProviderConfigError } from "../errors.js";
import type { ProviderConfigSchema } from "../config-schema.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

// ── Config ─────────────────────────────────────────────────────────────────

export const betterstackConfigSchema = z
  .object({
    apiToken: z.string().min(1, "Better Stack API token is required"),
    /**
     * Source ID shown in the Better Stack UI (e.g. 961958).
     * Used to auto-discover the ClickHouse table name via the Sources API.
     */
    sourceId: z.union([z.number(), z.string()]).optional(),
    /**
     * Full qualified ClickHouse table name (e.g. "t273774.offload_ecs_production").
     * When set, skips the Sources API discovery call.
     * Use this if you know your table name and want to avoid the extra request.
     */
    tableName: z.string().optional(),
    logger: z.custom<Logger>().optional(),
  })
  .refine((d) => d.sourceId !== undefined || d.tableName !== undefined, {
    message: "Either sourceId or tableName must be provided",
  });

export type BetterStackConfig = z.infer<typeof betterstackConfigSchema>;

export const betterstackProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Better Stack",
  fields: [
    {
      key: "apiToken",
      envVar: "BETTERSTACK_API_TOKEN",
      description: "Better Stack Telemetry API token",
    },
    {
      key: "sourceId",
      envVar: "BETTERSTACK_SOURCE_ID",
      required: false,
      description: "Better Stack log source ID (shown in the UI). Used to auto-discover the ClickHouse table.",
    },
    {
      key: "tableName",
      envVar: "BETTERSTACK_TABLE_NAME",
      required: false,
      description: 'Full qualified ClickHouse table name (e.g. "t273774.my_source"). Overrides sourceId discovery.',
    },
  ],
};

export function betterstack(config: BetterStackConfig): ObservabilityProvider & { configSchema: ProviderConfigSchema } {
  const parsed = betterstackConfigSchema.parse(config);
  const provider = new BetterStackProvider(parsed);
  return Object.assign(provider, { configSchema: betterstackProviderConfigSchema });
}

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "https://telemetry.betterstack.com";

// Matches NestJS ANSI-coloured log level tokens.
const NEST_LEVEL_RE = /\b(LOG|WARN|ERROR|DEBUG|VERBOSE)\b/;
// Matches Python/uvicorn log prefix: "INFO:     " or "WARNING:  ".
const PYTHON_LEVEL_RE = /^(INFO|WARNING|ERROR|DEBUG|CRITICAL):\s+/i;
// Strips ANSI escape sequences.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
// Strips NestJS "[Context] " bracket tokens so only the message remains.
const NEST_CONTEXT_RE = /\[[^\]]+\]\s*/g;

// ── Utilities ──────────────────────────────────────────────────────────────

/** Escape a string value for use inside a ClickHouse SQL single-quoted literal. */
function escapeSql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Normalise a raw log level token to a lowercase canonical value. */
function normalizeLevel(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (u === "LOG") return "info";
  if (u === "VERBOSE") return "debug";
  if (u === "WARNING") return "warn";
  if (u === "CRITICAL") return "error";
  return u.toLowerCase(); // error | warn | debug | info
}

/**
 * Parse a raw stdout log line into { level, message }.
 * Handles NestJS ANSI-coloured output and Python/uvicorn plain text.
 */
function parseLogLine(raw: string): { level: string; message: string } {
  const clean = raw.replace(ANSI_RE, "").trim();

  // Python/uvicorn: "INFO:     10.0.0.1:123 - "GET / HTTP/1.1" 200 OK"
  const pythonMatch = PYTHON_LEVEL_RE.exec(clean);
  if (pythonMatch) {
    return {
      level: normalizeLevel(pythonMatch[1]),
      message: clean.slice(pythonMatch[0].length).trim(),
    };
  }

  // NestJS: "[Nest] 1  - 03/20/2026, 7:04 PM   WARN [Gateway] Something went wrong"
  const nestMatch = NEST_LEVEL_RE.exec(clean);
  if (nestMatch) {
    const afterLevel = clean.slice(nestMatch.index + nestMatch[0].length);
    const message = afterLevel.replace(NEST_CONTEXT_RE, "").trim();
    return { level: normalizeLevel(nestMatch[1]), message: message || clean };
  }

  return { level: "info", message: clean };
}

/**
 * Derive a human-readable service name from an ECS container_name field.
 * "/ecs-offload-server-prod-285-offload-server-e0c69fbbb5edf0be5900" → "offload-server-prod"
 */
function parseServiceName(containerName: string): string {
  const name = containerName.replace(/^\//, "");
  const withoutHash = name.replace(/-[0-9a-f]{16,}$/i, "");
  const withoutRevision = withoutHash.replace(/-\d+-[^-].*$/, "");
  return withoutRevision.replace(/^ecs-/, "") || withoutHash;
}

/** Derive hot/cold ClickHouse collection identifiers from a full table name. */
function deriveCollections(fullTableName: string): { hot: string; cold: string } {
  // "t273774.offload_ecs_production" → "t273774_offload_ecs_production"
  const slug = fullTableName.replace(".", "_");
  return { hot: `${slug}_logs`, cold: `${slug}_s3` };
}

/** Returns true when the time range fits entirely within the hot-storage window (≤ 30 min). */
function isHotRange(timeRange: string): boolean {
  const m = /^(\d+)m$/i.exec(timeRange);
  return m !== null && parseInt(m[1], 10) <= 30;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ClickHouseRow {
  dt?: string;
  log?: string;
  container_name?: string;
  cnt?: number | string;
  [key: string]: unknown;
}

interface ClickHouseQueryResponse {
  data?: ClickHouseRow[];
}

interface BetterStackSourceAttributes {
  // Possible field names for the full qualified table name across API versions
  clickhouse_table_name?: string;
  qualified_table_name?: string;
  table_name?: string;
  team_id?: number | string;
  [key: string]: unknown;
}

interface BetterStackSourceResponse {
  data?: { attributes?: BetterStackSourceAttributes };
}

// ── Provider ───────────────────────────────────────────────────────────────

class BetterStackProvider implements ObservabilityProvider {
  private readonly apiToken: string;
  private readonly sourceId: string | undefined;
  private readonly configuredTableName: string | undefined;
  private readonly log: Logger;

  /** Resolved once on first use and cached for the lifetime of this instance. */
  private collections: { hot: string; cold: string } | null = null;

  constructor(config: BetterStackConfig) {
    this.apiToken = config.apiToken;
    this.sourceId = config.sourceId !== undefined ? String(config.sourceId) : undefined;
    this.configuredTableName = config.tableName;
    this.log = config.logger ?? consoleLogger;
  }

  private get authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" };
  }

  private timeRangeToInterval(timeRange: string): string {
    const m = /^(\d+)([hdm])$/i.exec(timeRange);
    if (!m) return "1 DAY";
    const v = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit === "m") return `${v} MINUTE`;
    if (unit === "h") return `${v} HOUR`;
    return `${v} DAY`;
  }

  /**
   * Resolve the ClickHouse collection names for this source.
   *
   * - If `tableName` is configured → derive collections directly (no API call).
   * - If only `sourceId` is configured → fetch source details from the API once,
   *   extract the qualified table name, then derive collections.
   *
   * The result is cached so subsequent calls are free.
   */
  private async resolveCollections(): Promise<{ hot: string; cold: string }> {
    if (this.collections) return this.collections;

    if (this.configuredTableName) {
      this.collections = deriveCollections(this.configuredTableName);
      this.log.debug(`Using configured table: ${this.configuredTableName}`);
      return this.collections;
    }

    this.log.debug(`Discovering ClickHouse table for source ${this.sourceId}`);
    const res = await fetch(`${BASE_URL}/api/v1/sources/${this.sourceId}`, {
      headers: this.authHeaders,
    });
    if (!res.ok) {
      throw new ProviderApiError("BetterStack", res.status, res.statusText, await res.text().catch(() => ""));
    }

    const body = (await res.json()) as BetterStackSourceResponse;
    const attrs = body.data?.attributes ?? {};

    const fullTable =
      attrs.clickhouse_table_name ??
      attrs.qualified_table_name ??
      (attrs.team_id && attrs.table_name ? `t${attrs.team_id}.${attrs.table_name}` : undefined);

    if (!fullTable) {
      throw new ProviderConfigError(
        "BetterStack",
        `Could not determine ClickHouse table name from source ${this.sourceId}. ` +
          'Please set tableName directly (e.g. "t273774.my_source").',
      );
    }

    this.log.debug(`Resolved table: ${fullTable}`);
    this.collections = deriveCollections(fullTable);
    return this.collections;
  }

  /**
   * Build a SQL SELECT that spans both hot (remote) and cold (s3Cluster) storage,
   * using non-overlapping time boundaries to avoid duplicate rows.
   * For ranges ≤ 30 min, only hot storage is queried.
   */
  private buildLogQuery(
    cols: { hot: string; cold: string },
    fields: string,
    conditions: string[],
    timeRange: string,
    limit: number,
  ): string {
    const where = conditions.join(" AND ");

    if (isHotRange(timeRange)) {
      return `SELECT ${fields} FROM remote(${cols.hot}) WHERE ${where} ORDER BY dt DESC LIMIT ${limit}`;
    }

    return `
SELECT * FROM (
  SELECT ${fields} FROM remote(${cols.hot})
    WHERE ${where} AND dt > now() - INTERVAL 30 MINUTE
  UNION ALL
  SELECT ${fields} FROM s3Cluster(primary, ${cols.cold})
    WHERE _row_type = 1 AND ${where} AND dt <= now() - INTERVAL 30 MINUTE
)
ORDER BY dt DESC
LIMIT ${limit}`.trim();
  }

  private async runQuery(sql: string): Promise<ClickHouseRow[]> {
    const res = await fetch(`${BASE_URL}/api/v1/query`, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({ query: sql, format: "JSON" }),
    });
    if (!res.ok) {
      throw new ProviderApiError("BetterStack", res.status, res.statusText, await res.text().catch(() => ""));
    }
    const body = (await res.json()) as ClickHouseQueryResponse;
    return body.data ?? [];
  }

  private rowToLogEntry(row: ClickHouseRow): LogEntry {
    const timestamp = String(row.dt ?? new Date().toISOString());
    const { level, message } = parseLogLine(String(row.log ?? ""));
    const service = row.container_name ? parseServiceName(String(row.container_name)) : "unknown";

    const RESERVED = new Set(["dt", "log", "container_name"]);
    const attributes = Object.fromEntries(Object.entries(row).filter(([k]) => !RESERVED.has(k)));

    return { timestamp, service, level, message, attributes };
  }

  // ── ObservabilityProvider ────────────────────────────────────────────────

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying Better Stack access");
    // Validates the token and (when sourceId is set) confirms the source exists.
    // Also warms the collections cache so the first query pays no extra cost.
    await this.resolveCollections();
    // If only tableName was provided (no sourceId), make a lightweight token check.
    if (!this.sourceId) {
      const res = await fetch(`${BASE_URL}/api/v1/sources?per_page=1`, { headers: this.authHeaders });
      if (!res.ok) {
        throw new ProviderApiError("BetterStack", res.status, res.statusText, await res.text().catch(() => ""));
      }
    }
    this.log.info("Better Stack access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    this.log.info(`Querying Better Stack logs (range: ${opts.timeRange})`);
    const cols = await this.resolveCollections();
    const interval = this.timeRangeToInterval(opts.timeRange);

    const conditions: string[] = [`dt >= now() - INTERVAL ${interval}`];

    if (opts.severity !== "*") {
      // Level is embedded in the raw log line; use case-insensitive substring match.
      conditions.push(
        `JSONExtract(raw, 'log', 'Nullable(String)') ILIKE '%${escapeSql(opts.severity.toUpperCase())}%'`,
      );
    }
    if (opts.serviceFilter !== "*") {
      conditions.push(
        `JSONExtract(raw, 'container_name', 'Nullable(String)') ILIKE '%${escapeSql(opts.serviceFilter)}%'`,
      );
    }

    const fields = [
      "dt",
      "JSONExtract(raw, 'log', 'Nullable(String)') AS log",
      "JSONExtract(raw, 'container_name', 'Nullable(String)') AS container_name",
    ].join(", ");

    const sql = this.buildLogQuery(cols, fields, conditions, opts.timeRange, 200);
    const rows = await this.runQuery(sql);
    const entries = rows.map((r) => this.rowToLogEntry(r));
    this.log.info(`Found ${entries.length} log entries`);
    return entries;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    this.log.info("Aggregating Better Stack error counts by service");
    const cols = await this.resolveCollections();
    const interval = this.timeRangeToInterval(opts.timeRange);

    const conditions: string[] = [
      `dt >= now() - INTERVAL ${interval}`,
      `JSONExtract(raw, 'log', 'Nullable(String)') ILIKE '%ERROR%'`,
    ];
    if (opts.serviceFilter !== "*") {
      conditions.push(
        `JSONExtract(raw, 'container_name', 'Nullable(String)') ILIKE '%${escapeSql(opts.serviceFilter)}%'`,
      );
    }

    const where = conditions.join(" AND ");
    const selectCnt = (from: string, extra?: string) =>
      `SELECT JSONExtract(raw, 'container_name', 'Nullable(String)') AS container_name, count() AS cnt
       FROM ${from}
       WHERE ${extra ? `${extra} AND ` : ""}${where}
       GROUP BY container_name`;

    let sql: string;
    if (isHotRange(opts.timeRange)) {
      sql = `${selectCnt(`remote(${cols.hot})`)} ORDER BY cnt DESC`;
    } else {
      sql = `
SELECT container_name, sum(cnt) AS cnt FROM (
  ${selectCnt(`remote(${cols.hot})`, "dt > now() - INTERVAL 30 MINUTE")}
  UNION ALL
  ${selectCnt(`s3Cluster(primary, ${cols.cold})`, "_row_type = 1 AND dt <= now() - INTERVAL 30 MINUTE")}
)
GROUP BY container_name
ORDER BY cnt DESC`.trim();
    }

    const rows = await this.runQuery(sql);
    const results: AggregateResult[] = rows
      .filter((r) => r.container_name && Number(r.cnt ?? 0) > 0)
      .map((r) => ({
        service: parseServiceName(String(r.container_name)),
        count: Number(r.cnt),
      }));

    this.log.info(`Aggregated ${results.length} service groups`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    const env: Record<string, string> = { BETTERSTACK_API_TOKEN: this.apiToken };
    if (this.sourceId) env.BETTERSTACK_SOURCE_ID = this.sourceId;
    if (this.configuredTableName) env.BETTERSTACK_TABLE_NAME = this.configuredTableName;
    if (this.collections) {
      env.BETTERSTACK_HOT_COLLECTION = this.collections.hot;
      env.BETTERSTACK_COLD_COLLECTION = this.collections.cold;
    }
    return env;
  }

  getPromptInstructions(): string {
    const cols = this.collections;
    const hot = cols?.hot ?? "<hot_collection>";
    const cold = cols?.cold ?? "<cold_collection>";

    return `### Better Stack Telemetry
- \`BETTERSTACK_API_TOKEN\` - API token (\`Authorization: Bearer $BETTERSTACK_API_TOKEN\`)
${cols ? `- Hot collection (last 30 min): \`${hot}\`\n- Cold collection (historical): \`${cold}\`` : ""}

**DO NOT make up data.** Only use real data from the API. If no data is found, say so.

You have access to the Better Stack MCP server with ClickHouse SQL query tools.

#### Log structure
All fields live inside the \`raw\` JSON column — extract with \`JSONExtract(raw, 'field', 'Nullable(String)')\`.
Key fields: \`log\` (raw stdout line, may have ANSI codes), \`container_name\` (ECS container), \`ecs_task_definition\`.
Level and message must be parsed from the \`log\` string (NestJS ANSI format or Python plain text).

#### Example: Recent errors (hot storage only)
\`\`\`sql
SELECT dt,
  JSONExtract(raw, 'log', 'Nullable(String)') AS log,
  JSONExtract(raw, 'container_name', 'Nullable(String)') AS container_name
FROM remote(${hot})
WHERE dt > now() - INTERVAL 1 HOUR
  AND JSONExtract(raw, 'log', 'Nullable(String)') ILIKE '%ERROR%'
ORDER BY dt DESC
LIMIT 100
\`\`\`

#### Example: Error counts by service spanning 24h (hot + cold)
\`\`\`sql
SELECT container_name, sum(cnt) AS total FROM (
  SELECT JSONExtract(raw, 'container_name', 'Nullable(String)') AS container_name, count() AS cnt
  FROM remote(${hot})
  WHERE dt > now() - INTERVAL 30 MINUTE
    AND JSONExtract(raw, 'log', 'Nullable(String)') ILIKE '%ERROR%'
  GROUP BY container_name
  UNION ALL
  SELECT JSONExtract(raw, 'container_name', 'Nullable(String)') AS container_name, count() AS cnt
  FROM s3Cluster(primary, ${cold})
  WHERE _row_type = 1
    AND dt <= now() - INTERVAL 30 MINUTE
    AND dt > now() - INTERVAL 24 HOUR
    AND JSONExtract(raw, 'log', 'Nullable(String)') ILIKE '%ERROR%'
  GROUP BY container_name
)
GROUP BY container_name
ORDER BY total DESC
\`\`\``;
  }
}
