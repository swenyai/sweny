# @sweny/providers

Shared provider interfaces and implementations for [SWEny](https://sweny.ai) — autonomous engineering tools powered by Claude AI.

## Install

```bash
npm install @sweny/providers
```

## Providers

| Category | Import | Implementations |
|----------|--------|-----------------|
| Observability | `@sweny/providers/observability` | `datadog`, `sentry`, `cloudwatch` |
| Issue Tracking | `@sweny/providers/issue-tracking` | `linear`, `githubIssues` |
| Notification | `@sweny/providers/notification` | `githubSummary`, `slackWebhook`, `teamsWebhook`, `discordWebhook` |
| Source Control | `@sweny/providers/source-control` | `github` |
| Incident | `@sweny/providers/incident` | `pagerduty` |
| Messaging | `@sweny/providers/messaging` | `slack` |
| Auth | `@sweny/providers/auth` | `noAuth`, `apiKeyAuth` |
| Access | `@sweny/providers/access` | `allowAllGuard`, `roleBasedGuard` |
| Storage | `@sweny/providers/storage` | `fsStorage`, `s3Storage` |

## Usage

Every provider follows the factory function pattern with Zod-validated config:

```typescript
import { datadog } from "@sweny/providers/observability";
import { linear } from "@sweny/providers/issue-tracking";
import { github } from "@sweny/providers/source-control";

const obs = datadog({
  apiKey: process.env.DD_API_KEY!,
  appKey: process.env.DD_APP_KEY!,
});

const issues = linear({
  apiKey: process.env.LINEAR_API_KEY!,
});

const sc = github({
  token: process.env.GITHUB_TOKEN!,
  owner: "your-org",
  repo: "your-repo",
});

// All providers expose verifyAccess() for health checks
await obs.verifyAccess();
await issues.verifyAccess();
await sc.verifyAccess();

// Query observability logs
const logs = await obs.queryLogs({
  timeRange: "24h",
  serviceFilter: "*",
  severity: "error",
});

// Create an issue
const issue = await issues.createIssue({
  title: "Fix authentication timeout",
  description: "Users are experiencing 504s on login",
  projectId: "team-id",
});
```

## Optional dependencies

Heavy SDKs are optional peer dependencies. Only install what you use:

```bash
# For S3 storage
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# For CloudWatch observability
npm install @aws-sdk/client-cloudwatch-logs

# For Slack messaging
npm install @slack/web-api

# For GitHub Actions notification
npm install @actions/core
```

## Implementing a custom provider

Each provider category defines a TypeScript interface. Implement the interface and pass your instance wherever a provider is expected:

```typescript
import type { ObservabilityProvider } from "@sweny/providers/observability";

export function myCustomProvider(config: MyConfig): ObservabilityProvider {
  return {
    async verifyAccess() { /* ... */ },
    async queryLogs(opts) { /* ... */ },
    async aggregate(opts) { /* ... */ },
  };
}
```

## License

[MIT](../../LICENSE)
