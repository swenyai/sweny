# Task: Add Prometheus observability provider

## Goal

Implement a Prometheus provider that satisfies the `ObservabilityProvider` interface so
SWEny can investigate firing alerts from Prometheus the same way it does from Datadog,
Sentry, etc.

## Interface to implement

```ts
// packages/providers/src/observability/types.ts
export interface ObservabilityProvider {
  verifyAccess(): Promise<void>;
  queryLogs(opts: LogQueryOptions): Promise<LogEntry[]>;
  aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]>;
  getAgentEnv(): Record<string, string>;
  getPromptInstructions(): string;
}
```

Read the full interface at:
`/Users/nate/src/swenyai/sweny/packages/providers/src/observability/types.ts`

Use the Datadog provider as a reference:
`/Users/nate/src/swenyai/sweny/packages/providers/src/observability/datadog.ts`

Pattern: zod config schema → factory function → class implementing the interface.

## Prometheus API details

- Base URL: configurable (e.g., `http://localhost:9090`)
- Optional bearer token auth: `Authorization: Bearer <token>`
- All requests are GET

Key endpoints:
- `GET <url>/api/v1/status/buildinfo` — verify connectivity (returns 200 + JSON)
- `GET <url>/api/v1/alerts` — list all currently firing alerts
- `GET <url>/api/v1/rules` — list alerting rules (for context)
- `GET <url>/api/v1/query?query=<promql>` — instant PromQL query

### Mapping alerts to `LogEntry`

A firing alert maps to a LogEntry like this:
```ts
{
  timestamp: alert.activeAt,  // ISO string
  service: alert.labels?.service ?? alert.labels?.job ?? "unknown",
  level: alert.labels?.severity ?? "warning",
  message: alert.annotations?.summary ?? alert.labels?.alertname ?? "",
  attributes: {
    alertname: alert.labels?.alertname,
    labels: alert.labels,
    annotations: alert.annotations,
    state: alert.state,
  }
}
```

The `alerts` array is at `response.data.alerts` when calling `/api/v1/alerts`.

### `queryLogs` behavior

- Fetch all firing alerts from `/api/v1/alerts`
- Filter by `opts.severity` if not `"*"`:
  - Match `alert.labels.severity === opts.severity`
- Filter by `opts.serviceFilter` if not `"*"`:
  - Match `alert.labels.service`, `alert.labels.job`, or `alert.labels.namespace`
- `opts.timeRange` is informational only for Prometheus (alerts are always current state)
- Return matching alerts mapped to `LogEntry[]`

### `aggregate` behavior

Group alerts by their `service` field (same logic as above) and count them.
Return `AggregateResult[]`.

### `getAgentEnv`

```ts
{
  PROMETHEUS_URL: this.url,
  ...(this.token ? { PROMETHEUS_TOKEN: this.token } : {}),
}
```

### `getPromptInstructions`

Return a markdown string with:
- What env vars are available (`PROMETHEUS_URL`, optionally `PROMETHEUS_TOKEN`)
- Auth instruction: include `Authorization: Bearer $PROMETHEUS_TOKEN` only if token is set
- Two curl examples: one for listing active alerts, one for a PromQL instant query

## Config schema

```ts
export const prometheusConfigSchema = z.object({
  url: z.string().url("Prometheus base URL is required"),
  token: z.string().optional(), // Bearer token, if auth is enabled
  logger: z.custom<Logger>().optional(),
});
export type PrometheusConfig = z.infer<typeof prometheusConfigSchema>;
export function prometheus(config: PrometheusConfig): ObservabilityProvider { ... }
```

## Files to create/edit

**IMPORTANT**: Check `packages/providers/src/observability/index.ts` before editing — a
PagerDuty export may have been added by a concurrent task. Add the Prometheus export line
without removing any existing lines.

1. **Create**: `packages/providers/src/observability/prometheus.ts`
2. **Edit**: `packages/providers/src/observability/index.ts` — add export line:
   ```ts
   export { prometheus, prometheusConfigSchema, type PrometheusConfig } from "./prometheus.js";
   ```
3. **Create**: `packages/providers/tests/observability/prometheus.test.ts` — unit tests
   using `vi.spyOn(globalThis, "fetch").mockImplementation(...)` (NOT `mockResolvedValue`).

## Tests to write

- `verifyAccess` resolves when buildinfo endpoint returns 200
- `verifyAccess` throws `ProviderApiError` when fetch returns non-200
- `queryLogs` maps firing alerts to `LogEntry[]`
- `queryLogs` filters by severity label when severity is not "*"
- `queryLogs` filters by service/job label when serviceFilter is not "*"
- `aggregate` groups alerts by service and returns counts
- `getAgentEnv` returns `PROMETHEUS_URL` and optionally `PROMETHEUS_TOKEN`
- `getPromptInstructions` returns non-empty string containing "Prometheus"

## Running tests

```bash
cd /Users/nate/src/swenyai/sweny
npm test --workspace=packages/providers -- --reporter=verbose 2>&1 | tail -40
```

## Commit

After all tests pass:
```
feat(providers): add Prometheus observability provider
```
