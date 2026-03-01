---
title: Provider Architecture
description: How SWEny's plugin system works and how to extend it.
---

SWEny is built on a provider/plugin architecture. The core engine is provider-agnostic — it delegates all external interactions to pluggable implementations.

## The pattern

Every provider follows the same factory function pattern:

```typescript
import { datadog } from "@swenyai/providers/observability";

const obs = datadog({
  apiKey: "your-api-key",
  appKey: "your-app-key",
  site: "datadoghq.com",  // optional, defaults shown
});

await obs.verifyAccess();  // health check
const logs = await obs.queryLogs({
  timeRange: "24h",
  serviceFilter: "*",
  severity: "error",
});
```

Config is validated at construction time using Zod. If you pass an invalid config, you get a clear error immediately — not at request time.

## Provider categories

| Category | Interface | Implementations |
|----------|-----------|-----------------|
| **Observability** | `ObservabilityProvider` | `datadog`, `sentry`, `cloudwatch` |
| **Issue Tracking** | `IssueTrackingProvider` | `linear`, `githubIssues` |
| **Source Control** | `SourceControlProvider` | `github` |
| **Notification** | `NotificationProvider` | `githubSummary`, `slackWebhook`, `teamsWebhook`, `discordWebhook` |
| **Incident** | `IncidentProvider` | `pagerduty` |
| **Messaging** | `MessagingProvider` | `slack` |
| **Auth** | `AuthProvider` | `noAuth`, `apiKeyAuth` |
| **Access** | `AccessGuard` | `allowAllGuard`, `roleBasedGuard` |
| **Storage** | `StorageProvider` | `fsStorage`, `s3Storage` |

## Subpath imports

Each category has its own import path to keep your bundle lean:

```typescript
import { datadog } from "@swenyai/providers/observability";
import { linear } from "@swenyai/providers/issue-tracking";
import { github } from "@swenyai/providers/source-control";
import { slackWebhook } from "@swenyai/providers/notification";
import { pagerduty } from "@swenyai/providers/incident";
import { slack } from "@swenyai/providers/messaging";
import { apiKeyAuth } from "@swenyai/providers/auth";
import { roleBasedGuard } from "@swenyai/providers/access";
import { s3Storage } from "@swenyai/providers/storage";
```

## Optional capabilities

Some providers support optional capabilities beyond the base interface. Use type guards to check:

```typescript
import { linear, canLinkPr, canListTriageHistory } from "@swenyai/providers/issue-tracking";

const tracker = linear({ apiKey: "..." });

if (canLinkPr(tracker)) {
  await tracker.linkPr(issueId, prUrl, prNumber);
}

if (canListTriageHistory(tracker)) {
  const history = await tracker.listTriageHistory(projectId, labelId);
}
```

Available capabilities:
- **`PrLinkCapable`** — link a PR to an issue (`linear`, `githubIssues`)
- **`FingerprintCapable`** — search issues by error fingerprint (`linear`)
- **`TriageHistoryCapable`** — list past triage results (`linear`)

## Implementing your own provider

Implement the TypeScript interface and pass your instance wherever a provider is expected:

```typescript
import type { ObservabilityProvider } from "@swenyai/providers/observability";

export function grafanaLoki(config: LokiConfig): ObservabilityProvider {
  return {
    async verifyAccess() {
      // Check Loki is reachable
    },
    async queryLogs(opts) {
      // Query Loki's HTTP API
      return [];
    },
    async aggregate(opts) {
      // Aggregate by service
      return [];
    },
  };
}
```

All providers accept an optional `logger` in their config for structured logging:

```typescript
const obs = datadog({
  apiKey: "...",
  appKey: "...",
  logger: myLogger,  // { info, debug, warn, error }
});
```
