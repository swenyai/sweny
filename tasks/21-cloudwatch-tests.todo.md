# Task 21 — Tests for CloudWatch Provider

## Objective

Add unit tests for the `cloudwatch` observability provider. Datadog and Sentry have tests in `packages/providers/tests/observability.test.ts` — CloudWatch does not.

## File Under Test

`packages/providers/src/observability/cloudwatch.ts` (194 lines)

### Exports

- `cloudwatchConfigSchema` — Zod schema: `{ region: string (default "us-east-1"), logGroupPrefix: string (required), logger?: Logger }`
- `cloudwatch(config): ObservabilityProvider` — factory function
- Internal: `CloudWatchProvider` class, `parseTimeRange(timeRange)` helper

### Methods

1. **`verifyAccess()`** — Sends `DescribeLogGroupsCommand` to verify AWS credentials
2. **`queryLogs(opts)`** — Runs CloudWatch Logs Insights query (`StartQueryCommand` → polls `GetQueryResultsCommand` until `Complete`), returns `LogEntry[]`
3. **`aggregate(opts)`** — Similar query for error aggregation by `@logStream`, returns `AggregateResult[]`

### Internal Helper

`parseTimeRange(timeRange: string): number` — Parses `"1h"`, `"30m"`, `"7d"` into milliseconds. Throws on invalid format.

## Test File

`packages/providers/tests/cloudwatch.test.ts`

## Test Cases

### Config validation
1. Validates complete config with region and logGroupPrefix
2. Applies default region `"us-east-1"` when not specified
3. Rejects missing logGroupPrefix
4. Rejects empty logGroupPrefix

### Factory
5. Returns an `ObservabilityProvider` with correct methods
6. Throws on invalid config

### verifyAccess
7. Calls `DescribeLogGroupsCommand` with correct prefix and limit
8. Throws when AWS client throws

### queryLogs
9. Starts query with correct time range, service filter, and severity
10. Polls for results and returns mapped `LogEntry[]`
11. Handles empty results
12. Applies service filter when not `"*"`

### aggregate
13. Starts aggregation query
14. Returns mapped `AggregateResult[]` with service and count
15. Handles empty results

### parseTimeRange (test via queryLogs/aggregate behavior)
16. `"1h"` → 3,600,000ms
17. `"30m"` → 1,800,000ms
18. `"7d"` → 604,800,000ms
19. Invalid format throws

## Mock Strategy

Mock the AWS SDK CloudWatch client. The provider uses dynamic imports:
```ts
const { CloudWatchLogsClient } = await import("@aws-sdk/client-cloudwatch-logs");
```

Use `vi.mock("@aws-sdk/client-cloudwatch-logs")` to mock the entire module:
```ts
vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  const mockSend = vi.fn();
  return {
    CloudWatchLogsClient: vi.fn(() => ({ send: mockSend })),
    DescribeLogGroupsCommand: vi.fn(),
    StartQueryCommand: vi.fn(),
    GetQueryResultsCommand: vi.fn(),
  };
});
```

## Existing Pattern (from observability.test.ts)

Follow the same structure as the Datadog and Sentry tests — config validation, factory, and mocked API calls.

## Verification

1. `npm test --workspace=packages/providers` — new tests pass
2. `npm test` — all tests pass
