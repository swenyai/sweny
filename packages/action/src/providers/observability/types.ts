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

export interface QueryOptions {
  timeRange: string;
  serviceFilter: string;
  severity: string;
}

export interface ObservabilityProvider {
  verifyAccess(): Promise<void>;
  queryLogs(opts: QueryOptions): Promise<LogEntry[]>;
  aggregate(opts: Omit<QueryOptions, "severity">): Promise<AggregateResult[]>;
}
