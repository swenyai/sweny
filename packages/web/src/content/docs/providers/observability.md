---
title: Observability
description: Query logs and aggregate errors from your monitoring stack.
---

```typescript
import { datadog, sentry, cloudwatch } from "@sweny/providers/observability";
```

## Interface

```typescript
interface ObservabilityProvider {
  verifyAccess(): Promise<void>;
  queryLogs(opts: LogQueryOptions): Promise<LogEntry[]>;
  aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]>;
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
