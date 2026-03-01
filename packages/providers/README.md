# @swenyai/providers

Shared provider interfaces and implementations for [SWEny](https://sweny.ai) — pluggable integrations for the `@swenyai/engine` workflow runner.

Providers map to the three workflow phases:

- **Learn** — Observability providers query logs and metrics from your production systems
- **Act** — Issue tracking, source control, incident management, and coding agent providers take action based on AI analysis
- **Report** — Notification and messaging providers deliver results through your team's channels

## Install

```bash
npm install @swenyai/providers
```

## Providers

### Observability (7 providers)

| Provider | Factory | Config |
|----------|---------|--------|
| Datadog | `datadog()` | `apiKey`, `appKey`, `site` |
| Sentry | `sentry()` | `authToken`, `organization`, `project` |
| CloudWatch | `cloudwatch()` | `region`, `logGroupPrefix` |
| Splunk | `splunk()` | `baseUrl`, `token`, `index` |
| Elasticsearch | `elastic()` | `baseUrl`, `apiKey` or `username`/`password`, `index` |
| Grafana Loki | `loki()` | `baseUrl`, `apiKey`, `orgId` |
| New Relic | `newrelic()` | `apiKey`, `accountId`, `region` |

```typescript
import { datadog, splunk, loki } from "@swenyai/providers/observability";
```

### Issue Tracking (3 providers)

| Provider | Factory | Config |
|----------|---------|--------|
| Linear | `linear()` | `apiKey` |
| GitHub Issues | `githubIssues()` | `token`, `owner`, `repo` |
| Jira | `jira()` | `baseUrl`, `email`, `apiToken` |

```typescript
import { linear, githubIssues, jira } from "@swenyai/providers/issue-tracking";
```

### Source Control (2 providers)

| Provider | Factory | Config |
|----------|---------|--------|
| GitHub | `github()` | `token`, `owner`, `repo` |
| GitLab | `gitlab()` | `token`, `projectId`, `baseUrl` |

```typescript
import { github, gitlab } from "@swenyai/providers/source-control";
```

### Incident Management (2 providers)

| Provider | Factory | Config |
|----------|---------|--------|
| PagerDuty | `pagerduty()` | `apiToken`, `routingKey` |
| OpsGenie | `opsgenie()` | `apiKey`, `region` |

```typescript
import { pagerduty, opsgenie } from "@swenyai/providers/incident";
```

### Messaging (2 providers)

| Provider | Factory | Config |
|----------|---------|--------|
| Slack | `slack()` | `token` |
| Microsoft Teams | `teams()` | `tenantId`, `clientId`, `clientSecret` |

```typescript
import { slack, teams } from "@swenyai/providers/messaging";
```

### Notification (6 providers)

| Provider | Factory | Config |
|----------|---------|--------|
| GitHub Summary | `githubSummary()` | — |
| Slack Webhook | `slackWebhook()` | `webhookUrl` |
| Teams Webhook | `teamsWebhook()` | `webhookUrl` |
| Discord Webhook | `discordWebhook()` | `webhookUrl` |
| Email (SendGrid) | `email()` | `apiKey`, `from`, `to` |
| Generic Webhook | `webhook()` | `url`, `headers`, `method`, `signingSecret` |

```typescript
import { githubSummary, slackWebhook, teamsWebhook, discordWebhook, email, webhook } from "@swenyai/providers/notification";
```

### Storage (3 backends)

| Provider | Factory | Config |
|----------|---------|--------|
| Filesystem | `fsStorage()` | `baseDir` |
| AWS S3 | `s3Storage()` | `bucket`, `prefix`, `region` |
| CSI / Kubernetes PVC | `csiStorage()` | `mountPath`, `volumeName`, `namespace` |

```typescript
import { fsStorage, s3Storage, csiStorage } from "@swenyai/providers/storage";
```

### Credential Vault (2 backends)

| Provider | Factory | Config |
|----------|---------|--------|
| Environment Variables | `envVault()` | `prefix` |
| AWS Secrets Manager | `awsSecretsManager()` | `region`, `prefix` |

```typescript
import { envVault, awsSecretsManager } from "@swenyai/providers/credential-vault";
```

### Auth (2 providers)

| Provider | Factory |
|----------|---------|
| No Auth | `noAuth()` |
| API Key Auth | `apiKeyAuth()` |

```typescript
import { noAuth, apiKeyAuth } from "@swenyai/providers/auth";
```

### Access (2 guards)

| Provider | Factory |
|----------|---------|
| Allow All | `allowAllGuard()` |
| Role-Based | `roleBasedGuard()` |

```typescript
import { allowAllGuard, roleBasedGuard } from "@swenyai/providers/access";
```

### Coding Agent

| Provider | Factory |
|----------|---------|
| Claude Code | `claudeCode()` |

```typescript
import { claudeCode } from "@swenyai/providers/coding-agent";
```

### Agent Tool

| Provider | Factory |
|----------|---------|
| Agent Tool | `agentTool()` |

```typescript
import { agentTool } from "@swenyai/providers/agent-tool";
```

## Usage

Every provider follows the factory function pattern with Zod-validated config:

```typescript
import { datadog } from "@swenyai/providers/observability";
import { jira } from "@swenyai/providers/issue-tracking";
import { github } from "@swenyai/providers/source-control";
import { pagerduty } from "@swenyai/providers/incident";

const obs = datadog({
  apiKey: process.env.DD_API_KEY!,
  appKey: process.env.DD_APP_KEY!,
  site: "datadoghq.com",
});

const issues = jira({
  baseUrl: "https://your-org.atlassian.net",
  email: process.env.JIRA_EMAIL!,
  apiToken: process.env.JIRA_API_TOKEN!,
});

const sc = github({
  token: process.env.GITHUB_TOKEN!,
  owner: "your-org",
  repo: "your-repo",
});

const incidents = pagerduty({
  apiToken: process.env.PD_API_TOKEN!,
  routingKey: process.env.PD_ROUTING_KEY!,
});

// All providers expose verifyAccess() for health checks
await obs.verifyAccess();
await issues.verifyAccess();
await sc.verifyAccess();
await incidents.verifyAccess();

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

# For CSI / Kubernetes PVC storage
npm install @kubernetes/client-node

# For CloudWatch observability
npm install @aws-sdk/client-cloudwatch-logs

# For AWS Secrets Manager credential vault
npm install @aws-sdk/client-secrets-manager

# For Slack messaging
npm install @slack/web-api

# For GitHub Actions notification
npm install @actions/core

# For Microsoft Teams messaging
npm install @azure/identity @microsoft/microsoft-graph-client
```

## Implementing a custom provider

Each provider category defines a TypeScript interface. Implement the interface and pass your instance wherever a provider is expected:

```typescript
import type { ObservabilityProvider } from "@swenyai/providers/observability";

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
