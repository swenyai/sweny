import type { MCPServerConfig } from "../mcp/index.js";

/** A single log entry returned from an observability provider. */
export interface LogEntry {
  /** ISO 8601 timestamp of the log entry. */
  timestamp: string;
  /** Service or application name that emitted the log. */
  service: string;
  /** Log severity level (e.g., "error", "warning", "info"). */
  level: string;
  /** Log message content. */
  message: string;
  /** Additional structured attributes from the log entry. */
  attributes: Record<string, unknown>;
}

/** Aggregated error count grouped by service. */
export interface AggregateResult {
  /** Service or application name. */
  service: string;
  /** Number of matching log entries for this service. */
  count: number;
}

/** Options for querying logs from an observability provider. */
export interface LogQueryOptions {
  /** Relative time range (e.g., "1h", "24h", "7d"). */
  timeRange: string;
  /** Service name filter. Use "*" for all services. */
  serviceFilter: string;
  /** Log severity level to filter by (e.g., "error", "warning"). */
  severity: string;
}

/** Provider interface for querying logs and aggregating metrics from observability platforms. */
export interface ObservabilityProvider {
  /**
   * Verify that the provider credentials and connection are valid.
   * @returns Resolves if access is valid; rejects otherwise.
   */
  verifyAccess(): Promise<void>;

  /**
   * Query logs matching the given options.
   * @param opts - Log query filters (time range, service, severity).
   * @returns Matching log entries.
   */
  queryLogs(opts: LogQueryOptions): Promise<LogEntry[]>;

  /**
   * Aggregate log counts grouped by service.
   * @param opts - Query filters excluding severity.
   * @returns Aggregated counts per service.
   */
  aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]>;

  /** Env vars the coding agent needs for direct API access (e.g., curl). */
  getAgentEnv(): Record<string, string>;

  /** Provider-specific API documentation injected into the investigation prompt. */
  getPromptInstructions(): string;

  /**
   * Optional: MCP servers this provider contributes to the coding agent.
   * When present, the returned servers are auto-injected into every agent run
   * alongside any user-supplied mcpServers in the job config.
   */
  getMcpServers?(): Record<string, MCPServerConfig>;
}
