---
title: Provider Architecture
description: How SWEny's plugin system works and how to extend it.
---

SWEny is built on a provider/plugin architecture. The core engine is provider-agnostic — it delegates all external interactions to pluggable implementations.

## The pattern

Every provider follows the same factory function pattern:

```typescript
import { datadog } from "@sweny-ai/providers/observability";

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
| **Observability** | `ObservabilityProvider` | `datadog`, `sentry`, `cloudwatch`, `splunk`, `elastic`, `newrelic`, `loki` |
| **Issue Tracking** | `IssueTrackingProvider` | `linear`, `githubIssues`, `jira` |
| **Source Control** | `SourceControlProvider` | `github`, `gitlab` |
| **Notification** | `NotificationProvider` | `githubSummary`, `slackWebhook`, `teamsWebhook`, `discordWebhook`, `email`, `webhook` |
| **Incident** | `IncidentProvider` | `pagerduty`, `opsgenie` |
| **Messaging** | `MessagingProvider` | `slack`, `teams` |
| **Coding Agent** | `CodingAgent` | `claudeCode`, `openaiCodex`, `googleGemini` |
| **Auth** | `AuthProvider` | `noAuth`, `apiKeyAuth` |
| **Access** | `AccessGuard` | `allowAllGuard`, `roleBasedGuard` |
| **Storage** | `StorageProvider` | `fsStorage`, `s3Storage`, `csiStorage` |

## Subpath imports

Each category has its own import path to keep your bundle lean:

```typescript
import { datadog } from "@sweny-ai/providers/observability";
import { linear } from "@sweny-ai/providers/issue-tracking";
import { github } from "@sweny-ai/providers/source-control";
import { slackWebhook } from "@sweny-ai/providers/notification";
import { pagerduty } from "@sweny-ai/providers/incident";
import { slack } from "@sweny-ai/providers/messaging";
import { apiKeyAuth } from "@sweny-ai/providers/auth";
import { roleBasedGuard } from "@sweny-ai/providers/access";
import { s3Storage } from "@sweny-ai/providers/storage";
```

## Optional capabilities

Some providers support optional capabilities beyond the base interface. Use type guards to check:

```typescript
import { linear, canLinkPr, canSearchByFingerprint, canListTriageHistory } from "@sweny-ai/providers/issue-tracking";

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
import type { ObservabilityProvider } from "@sweny-ai/providers/observability";

export function myObservabilityPlatform(config: MyConfig): ObservabilityProvider {
  return {
    async verifyAccess() {
      // Verify credentials are valid
    },
    async queryLogs(opts) {
      // Query your platform's API
      return [];
    },
    async aggregate(opts) {
      // Aggregate by service
      return [];
    },
    getAgentEnv() {
      return {};
    },
    getPromptInstructions() {
      return "";
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
