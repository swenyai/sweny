# Task 10: Browser-safe Provider Catalog

## Goal
Create a catalog of all available provider implementations that the Studio
can use to show configuration options. Must be browser-safe (no Node.js imports).

## File: packages/providers/src/catalog.ts

Export:
```typescript
export interface ProviderOption {
  id: string;           // e.g. "datadog"
  name: string;         // "Datadog"
  category: string;     // matches StateDefinition.provider
  description: string;  // one-liner
  color: string;        // hex for icon/badge
  icon: string;         // emoji or short text badge
  envVars: EnvVarSpec[];
  docsUrl?: string;
}

export interface EnvVarSpec {
  key: string;
  description: string;
  required: boolean;
  example?: string;
  secret: boolean;      // true = mask in UI
}

export const PROVIDER_CATALOG: ProviderOption[] = [
  // observability
  { id: "datadog", name: "Datadog", category: "observability", ... envVars: [
    { key: "DATADOG_API_KEY", description: "Datadog API key", required: true, secret: true, example: "abc123..." },
    { key: "DATADOG_APP_KEY", ... },
    { key: "DATADOG_SITE", description: "Datadog site (default: datadoghq.com)", required: false, example: "datadoghq.eu" },
  ]},
  { id: "sentry", name: "Sentry", category: "observability", ... envVars: [
    { key: "SENTRY_AUTH_TOKEN", required: true, secret: true },
    { key: "SENTRY_ORG", required: true, secret: false },
    { key: "SENTRY_PROJECT", required: false },
  ]},
  { id: "cloudwatch", name: "CloudWatch", category: "observability", ... envVars: [
    { key: "AWS_ACCESS_KEY_ID", required: true, secret: true },
    { key: "AWS_SECRET_ACCESS_KEY", required: true, secret: true },
    { key: "AWS_REGION", required: true, example: "us-east-1" },
    { key: "CLOUDWATCH_LOG_GROUP", required: false },
  ]},
  { id: "elastic", name: "Elastic", ... },
  { id: "newrelic", name: "New Relic", ... },
  { id: "loki", name: "Grafana Loki", ... },

  // issueTracking
  { id: "linear", name: "Linear", category: "issueTracking", envVars: [
    { key: "LINEAR_API_KEY", required: true, secret: true },
    { key: "LINEAR_TEAM_ID", required: true },
    { key: "LINEAR_PROJECT_ID", required: false },
  ]},
  { id: "github-issues", name: "GitHub Issues", category: "issueTracking", envVars: [
    { key: "GITHUB_TOKEN", required: true, secret: true },
    { key: "GITHUB_OWNER", required: true },
    { key: "GITHUB_REPO", required: true },
  ]},
  { id: "jira", name: "Jira", category: "issueTracking", envVars: [
    { key: "JIRA_URL", required: true, example: "https://mycompany.atlassian.net" },
    { key: "JIRA_EMAIL", required: true },
    { key: "JIRA_API_TOKEN", required: true, secret: true },
    { key: "JIRA_PROJECT_KEY", required: true },
  ]},

  // sourceControl
  { id: "github", name: "GitHub", category: "sourceControl", envVars: [
    { key: "GITHUB_TOKEN", required: true, secret: true },
    { key: "GITHUB_OWNER", required: true },
    { key: "GITHUB_REPO", required: true },
  ]},
  { id: "gitlab", name: "GitLab", category: "sourceControl", envVars: [
    { key: "GITLAB_TOKEN", required: true, secret: true },
    { key: "GITLAB_URL", required: false, example: "https://gitlab.com" },
    { key: "GITLAB_PROJECT_ID", required: true },
  ]},

  // codingAgent
  { id: "claude-code", name: "Claude Code", category: "codingAgent", envVars: [
    { key: "ANTHROPIC_API_KEY", required: true, secret: true },
  ]},
  { id: "openai-codex", name: "OpenAI Codex", category: "codingAgent", envVars: [
    { key: "OPENAI_API_KEY", required: true, secret: true },
  ]},

  // notification
  { id: "slack-webhook", name: "Slack Webhook", category: "notification", envVars: [
    { key: "SLACK_WEBHOOK_URL", required: true, secret: true, example: "https://hooks.slack.com/..." },
  ]},
  { id: "discord-webhook", name: "Discord Webhook", category: "notification", envVars: [
    { key: "DISCORD_WEBHOOK_URL", required: true, secret: true },
  ]},
  { id: "teams-webhook", name: "Teams Webhook", category: "notification", envVars: [
    { key: "TEAMS_WEBHOOK_URL", required: true, secret: true },
  ]},
  { id: "email", name: "Email (SMTP)", category: "notification", envVars: [
    { key: "SMTP_HOST", required: true },
    { key: "SMTP_PORT", required: false, example: "587" },
    { key: "SMTP_USER", required: true },
    { key: "SMTP_PASS", required: true, secret: true },
    { key: "SMTP_FROM", required: true, example: "alerts@mycompany.com" },
  ]},
  { id: "github-summary", name: "GitHub Step Summary", category: "notification", envVars: [] },
];

export function getProvidersForCategory(category: string): ProviderOption[] {
  return PROVIDER_CATALOG.filter(p => p.category === category);
}
```

### packages/providers/src/index.ts
Add: `export { PROVIDER_CATALOG, getProvidersForCategory } from "./catalog.js"`
Add: `export type { ProviderOption, EnvVarSpec } from "./catalog.js"`

### packages/providers/package.json exports
Add browser-safe subpath: `"./catalog"` → `"./dist/catalog/index.js"`
(the catalog is already browser-safe since it's pure data)

### Changeset
@sweny-ai/providers: minor (new catalog export)

## Acceptance
- `import { PROVIDER_CATALOG } from "@sweny-ai/providers"` works
- All 15+ providers have accurate env var specs
- No Node.js imports in catalog.ts
