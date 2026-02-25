export interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  attributes: Record<string, unknown>;
}

export interface AggregateResult {
  service: string;
  count: number;
}

export interface LogQueryOptions {
  timeRange: string;
  serviceFilter: string;
  severity: string;
}

export interface ObservabilityProvider {
  verifyAccess(): Promise<void>;
  queryLogs(opts: LogQueryOptions): Promise<LogEntry[]>;
  aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]>;
}
