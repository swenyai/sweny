---
title: Observability
description: Query logs and aggregate errors from your monitoring stack.
---

```typescript
import { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki } from "@sweny/providers/observability";
```

## Interface

```typescript
interface ObservabilityProvider {
  verifyAccess(): Promise<void>;
  queryLogs(opts: LogQueryOptions): Promise<LogEntry[]>;
  aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]>;
  getAgentEnv(): Record<string, string>;
  getPromptInstructions(): string;
}

interface LogQueryOptions {
  timeRange: string;      // "1h", "6h", "24h", "7d"
  serviceFilter: string;  // "my-svc", "api-*", "*"
  severity: string;       // "error", "warning", "all"
}
```

## Datadog

```typescript
const obs = datadog({
  apiKey: process.env.DD_API_KEY!,
  appKey: process.env.DD_APP_KEY!,
  site: "datadoghq.com",   // optional
  logger: myLogger,         // optional
});
```

Uses the Datadog Logs API v2. Zero external dependencies — native `fetch` only.

### Querying logs

```typescript
const errors = await obs.queryLogs({
  timeRange: "24h",
  serviceFilter: "payment-*",
  severity: "error",
});
// Returns: LogEntry[] — each with message, timestamp, service, severity, attributes
```

### Aggregating errors

```typescript
const groups = await obs.aggregate({
  timeRange: "24h",
  serviceFilter: "*",
});
// Returns: AggregateResult[] — grouped by service + error pattern with occurrence counts
// e.g., [{ key: "payment-api::NullPointerException", count: 312, ... }]
```

## Sentry

```typescript
const obs = sentry({
  authToken: process.env.SENTRY_AUTH_TOKEN!,
  organization: "my-org",
  project: "my-project",
  logger: myLogger,
});
```

## CloudWatch

```typescript
const obs = cloudwatch({
  region: "us-east-1",
  logGroupPrefix: "/aws/lambda/my-function",
  logger: myLogger,
});
```

Requires `@aws-sdk/client-cloudwatch-logs` as a peer dependency.

## Splunk

```typescript
const obs = splunk({
  baseUrl: "https://splunk.example.com:8089",
  token: process.env.SPLUNK_TOKEN!,
  index: "main",  // optional, defaults to "main"
  logger: myLogger,
});
```

Uses the Splunk REST API. Native `fetch` only.

## Elasticsearch

```typescript
const obs = elastic({
  baseUrl: "https://elastic.example.com:9200",
  apiKey: process.env.ELASTIC_API_KEY!,
  index: "logs-*",  // optional, defaults to "logs-*"
  logger: myLogger,
});
```

## New Relic

```typescript
const obs = newrelic({
  apiKey: process.env.NR_API_KEY!,
  accountId: "12345",
  region: "us",  // optional, "us" or "eu", defaults to "us"
  logger: myLogger,
});
```

Uses the NerdGraph (GraphQL) API.

## Grafana Loki

```typescript
const obs = loki({
  baseUrl: "https://loki.example.com",
  apiKey: process.env.LOKI_API_KEY,  // optional
  orgId: "tenant-1",  // optional
  logger: myLogger,
});
```
