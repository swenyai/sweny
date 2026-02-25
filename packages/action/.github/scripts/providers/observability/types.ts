/**
 * Observability Provider Contract
 *
 * Each observability provider is a standalone TypeScript CLI that can be invoked
 * by the workflow via `npx tsx <provider>.ts <command> [options]`.
 *
 * Commands:
 *   verify-access  — Validate credentials and API connectivity. Exit 0 on success, 1 on failure.
 *   query-logs     — Query error/warning logs for a given time range and service filter.
 *                     Output JSON to stdout: { logs: LogEntry[], summary: string }
 *   aggregate      — Get error counts grouped by service.
 *                     Output JSON to stdout: { groups: { service: string, count: number }[] }
 *
 * Environment variables are provider-specific. The workflow passes them via `env:` blocks.
 *
 * Example workflow step:
 *   - name: Verify Observability Access
 *     env:
 *       DD_API_KEY: ${{ secrets.DD_API_KEY }}
 *       DD_APP_KEY: ${{ secrets.DD_APP_KEY }}
 *     run: npx tsx .github/scripts/providers/observability/datadog.ts verify-access
 */

export interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  attributes: Record<string, unknown>;
}

export interface QueryResult {
  logs: LogEntry[];
  summary: string;
}

export interface AggregateGroup {
  service: string;
  count: number;
}

export interface AggregateResult {
  groups: AggregateGroup[];
}
