/**
 * Browser-safe provider catalog.
 * Pure data — no Node.js imports, no factory function calls.
 * Used by Studio to surface provider options and required env vars per step.
 */

export interface EnvVarSpec {
  key: string;
  description: string;
  required: boolean;
  example?: string;
  /** If true, the value should be masked in UI displays. */
  secret: boolean;
}

export interface ProviderOption {
  /** Machine-readable ID matching the factory function name. */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Provider category — matches StateDefinition.provider. */
  category: string;
  /** One-line description of what this provider connects to. */
  description: string;
  /** Hex color for icon/badge rendering. */
  color: string;
  /** Emoji or short text icon. */
  icon: string;
  /** Required and optional environment variables for this provider. */
  envVars: EnvVarSpec[];
  /** Import path for the factory function. */
  importPath: string;
  /** Factory function name. */
  factoryFn: string;
}

export const PROVIDER_CATALOG: ProviderOption[] = [
  // ── Observability ──────────────────────────────────────────────────────────

  {
    id: "datadog",
    name: "Datadog",
    category: "observability",
    description: "Query logs and metrics from Datadog APM and log management.",
    color: "#632CA6",
    icon: "🐶",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "datadog",
    envVars: [
      { key: "DATADOG_API_KEY", description: "Datadog API key", required: true, secret: true, example: "abc123..." },
      { key: "DATADOG_APP_KEY", description: "Datadog application key", required: true, secret: true },
      {
        key: "DATADOG_SITE",
        description: "Datadog site (default: datadoghq.com)",
        required: false,
        secret: false,
        example: "datadoghq.eu",
      },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "observability",
    description: "Aggregate and query error events from Sentry.",
    color: "#362D59",
    icon: "🔭",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "sentry",
    envVars: [
      { key: "SENTRY_AUTH_TOKEN", description: "Sentry auth token", required: true, secret: true },
      {
        key: "SENTRY_ORG",
        description: "Sentry organization slug",
        required: true,
        secret: false,
        example: "my-company",
      },
      {
        key: "SENTRY_PROJECT",
        description: "Sentry project slug (leave empty for all)",
        required: false,
        secret: false,
      },
    ],
  },
  {
    id: "cloudwatch",
    name: "AWS CloudWatch",
    category: "observability",
    description: "Query CloudWatch Logs Insights for structured log data.",
    color: "#FF9900",
    icon: "☁️",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "cloudwatch",
    envVars: [
      { key: "AWS_ACCESS_KEY_ID", description: "AWS access key ID", required: true, secret: true },
      { key: "AWS_SECRET_ACCESS_KEY", description: "AWS secret access key", required: true, secret: true },
      { key: "AWS_REGION", description: "AWS region", required: true, secret: false, example: "us-east-1" },
      {
        key: "CLOUDWATCH_LOG_GROUP",
        description: "Default log group name",
        required: false,
        secret: false,
        example: "/aws/lambda/my-service",
      },
    ],
  },
  {
    id: "elastic",
    name: "Elasticsearch",
    category: "observability",
    description: "Query logs and traces from an Elasticsearch / Elastic Cloud cluster.",
    color: "#005571",
    icon: "🔍",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "elastic",
    envVars: [
      {
        key: "ELASTICSEARCH_URL",
        description: "Elasticsearch endpoint",
        required: true,
        secret: false,
        example: "https://my-cluster.es.io:9200",
      },
      { key: "ELASTICSEARCH_API_KEY", description: "Elasticsearch API key", required: true, secret: true },
      {
        key: "ELASTICSEARCH_INDEX",
        description: "Default index pattern",
        required: false,
        secret: false,
        example: "logs-*",
      },
    ],
  },
  {
    id: "newrelic",
    name: "New Relic",
    category: "observability",
    description: "Query events and metrics from New Relic NRDB via NRQL.",
    color: "#008C99",
    icon: "📡",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "newrelic",
    envVars: [
      { key: "NEW_RELIC_API_KEY", description: "New Relic user API key", required: true, secret: true },
      { key: "NEW_RELIC_ACCOUNT_ID", description: "New Relic account ID", required: true, secret: false },
    ],
  },
  {
    id: "loki",
    name: "Grafana Loki",
    category: "observability",
    description: "Query log streams from a Grafana Loki or Grafana Cloud instance.",
    color: "#F05A28",
    icon: "📊",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "loki",
    envVars: [
      { key: "LOKI_URL", description: "Loki endpoint URL", required: true, secret: false, example: "http://loki:3100" },
      {
        key: "LOKI_USERNAME",
        description: "Grafana Cloud username (leave empty for self-hosted)",
        required: false,
        secret: false,
      },
      { key: "LOKI_PASSWORD", description: "Grafana Cloud API key", required: false, secret: true },
    ],
  },

  {
    id: "supabase",
    name: "Supabase",
    category: "observability",
    description: "Query postgres, edge function, API, and auth logs from Supabase projects.",
    color: "#3ECF8E",
    icon: "⚡",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "supabase",
    envVars: [
      { key: "SUPABASE_MANAGEMENT_KEY", description: "Supabase management API key", required: true, secret: true },
      {
        key: "SUPABASE_PROJECT_REF",
        description: "Supabase project reference ID",
        required: true,
        secret: false,
        example: "abcdefghijklmnop",
      },
    ],
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "observability",
    description: "Query runtime logs from Vercel serverless function deployments.",
    color: "#000000",
    icon: "▲",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "vercel",
    envVars: [
      { key: "VERCEL_TOKEN", description: "Vercel personal access token", required: true, secret: true },
      {
        key: "VERCEL_PROJECT_ID",
        description: "Vercel project ID",
        required: true,
        secret: false,
        example: "prj_xxxxxxxxxxxxxxxxxxxx",
      },
      {
        key: "VERCEL_TEAM_ID",
        description: "Vercel team ID (optional, for team-owned projects)",
        required: false,
        secret: false,
        example: "team_xxxxxxxxxxxxxxxxxxxx",
      },
    ],
  },

  // ── Issue Tracking ─────────────────────────────────────────────────────────

  {
    id: "linear",
    name: "Linear",
    category: "issueTracking",
    description: "Create, update, and search issues in Linear projects.",
    color: "#5E6AD2",
    icon: "◈",
    importPath: "@sweny-ai/providers/issue-tracking",
    factoryFn: "linear",
    envVars: [
      { key: "LINEAR_API_KEY", description: "Linear personal API key", required: true, secret: true },
      { key: "LINEAR_TEAM_ID", description: "Default team ID for new issues", required: true, secret: false },
      { key: "LINEAR_PROJECT_ID", description: "Default project ID (optional)", required: false, secret: false },
    ],
  },
  {
    id: "github-issues",
    name: "GitHub Issues",
    category: "issueTracking",
    description: "Create and manage issues directly in a GitHub repository.",
    color: "#24292F",
    icon: "🐙",
    importPath: "@sweny-ai/providers/issue-tracking",
    factoryFn: "githubIssues",
    envVars: [
      { key: "GITHUB_TOKEN", description: "GitHub personal access token or app token", required: true, secret: true },
      {
        key: "GITHUB_OWNER",
        description: "Repository owner (org or user)",
        required: true,
        secret: false,
        example: "my-org",
      },
      { key: "GITHUB_REPO", description: "Repository name", required: true, secret: false, example: "my-repo" },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    category: "issueTracking",
    description: "Create and update issues in Jira Cloud or Server.",
    color: "#0052CC",
    icon: "🔷",
    importPath: "@sweny-ai/providers/issue-tracking",
    factoryFn: "jira",
    envVars: [
      {
        key: "JIRA_URL",
        description: "Jira instance base URL",
        required: true,
        secret: false,
        example: "https://mycompany.atlassian.net",
      },
      { key: "JIRA_EMAIL", description: "Jira account email", required: true, secret: false },
      { key: "JIRA_API_TOKEN", description: "Jira API token", required: true, secret: true },
      { key: "JIRA_PROJECT_KEY", description: "Target project key", required: true, secret: false, example: "ENG" },
    ],
  },

  // ── Source Control ─────────────────────────────────────────────────────────

  {
    id: "github",
    name: "GitHub",
    category: "sourceControl",
    description: "Push branches, open PRs, and dispatch workflows on GitHub.",
    color: "#24292F",
    icon: "🐙",
    importPath: "@sweny-ai/providers/source-control",
    factoryFn: "github",
    envVars: [
      {
        key: "GITHUB_TOKEN",
        description: "GitHub personal access token (needs repo + workflow scopes)",
        required: true,
        secret: true,
      },
      {
        key: "GITHUB_OWNER",
        description: "Repository owner (org or user)",
        required: true,
        secret: false,
        example: "my-org",
      },
      { key: "GITHUB_REPO", description: "Repository name", required: true, secret: false, example: "my-repo" },
    ],
  },
  {
    id: "gitlab",
    name: "GitLab",
    category: "sourceControl",
    description: "Push branches and open merge requests on GitLab.",
    color: "#FC6D26",
    icon: "🦊",
    importPath: "@sweny-ai/providers/source-control",
    factoryFn: "gitlab",
    envVars: [
      { key: "GITLAB_TOKEN", description: "GitLab personal access token", required: true, secret: true },
      {
        key: "GITLAB_URL",
        description: "GitLab instance URL (default: https://gitlab.com)",
        required: false,
        secret: false,
      },
      {
        key: "GITLAB_PROJECT_ID",
        description: "GitLab project ID or path",
        required: true,
        secret: false,
        example: "123",
      },
    ],
  },

  // ── Coding Agent ───────────────────────────────────────────────────────────

  {
    id: "claude-code",
    name: "Claude Code",
    category: "codingAgent",
    description: "Claude Code CLI — Anthropic's agentic coding tool. Reads context, writes code, runs tests.",
    color: "#D97706",
    icon: "🤖",
    importPath: "@sweny-ai/providers/coding-agent",
    factoryFn: "claudeCode",
    envVars: [
      {
        key: "ANTHROPIC_API_KEY",
        description: "Anthropic API key",
        required: true,
        secret: true,
        example: "sk-ant-...",
      },
    ],
  },
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    category: "codingAgent",
    description: "OpenAI's code-focused models for autonomous coding tasks.",
    color: "#10A37F",
    icon: "✦",
    importPath: "@sweny-ai/providers/coding-agent",
    factoryFn: "openaiCodex",
    envVars: [
      { key: "OPENAI_API_KEY", description: "OpenAI API key", required: true, secret: true, example: "sk-..." },
    ],
  },
  {
    id: "google-gemini",
    name: "Google Gemini",
    category: "codingAgent",
    description: "Google Gemini models for autonomous coding tasks.",
    color: "#4285F4",
    icon: "✦",
    importPath: "@sweny-ai/providers/coding-agent",
    factoryFn: "googleGemini",
    envVars: [{ key: "GOOGLE_API_KEY", description: "Google AI Studio API key", required: true, secret: true }],
  },

  // ── Notification ───────────────────────────────────────────────────────────

  {
    id: "slack-webhook",
    name: "Slack Webhook",
    category: "notification",
    description: "Post rich Block Kit messages to a Slack channel via an incoming webhook.",
    color: "#4A154B",
    icon: "💬",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "slackWebhook",
    envVars: [
      {
        key: "SLACK_WEBHOOK_URL",
        description: "Slack incoming webhook URL",
        required: true,
        secret: true,
        example: "https://hooks.slack.com/services/...",
      },
    ],
  },
  {
    id: "discord-webhook",
    name: "Discord Webhook",
    category: "notification",
    description: "Post embed messages to a Discord channel via a webhook.",
    color: "#5865F2",
    icon: "🎮",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "discordWebhook",
    envVars: [
      {
        key: "DISCORD_WEBHOOK_URL",
        description: "Discord webhook URL",
        required: true,
        secret: true,
        example: "https://discord.com/api/webhooks/...",
      },
    ],
  },
  {
    id: "teams-webhook",
    name: "Microsoft Teams",
    category: "notification",
    description: "Post Adaptive Card messages to a Teams channel via a webhook.",
    color: "#6264A7",
    icon: "💼",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "teamsWebhook",
    envVars: [{ key: "TEAMS_WEBHOOK_URL", description: "Teams incoming webhook URL", required: true, secret: true }],
  },
  {
    id: "email",
    name: "Email (SMTP)",
    category: "notification",
    description: "Send HTML or plain-text notification emails via SMTP.",
    color: "#EA4335",
    icon: "📧",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "email",
    envVars: [
      {
        key: "SMTP_HOST",
        description: "SMTP server hostname",
        required: true,
        secret: false,
        example: "smtp.sendgrid.net",
      },
      { key: "SMTP_PORT", description: "SMTP port (default: 587)", required: false, secret: false, example: "587" },
      { key: "SMTP_USER", description: "SMTP username", required: true, secret: false },
      { key: "SMTP_PASS", description: "SMTP password or API key", required: true, secret: true },
      {
        key: "SMTP_FROM",
        description: "Sender email address",
        required: true,
        secret: false,
        example: "alerts@mycompany.com",
      },
      {
        key: "SMTP_TO",
        description: "Recipient email address(es)",
        required: true,
        secret: false,
        example: "oncall@mycompany.com",
      },
    ],
  },
  {
    id: "github-summary",
    name: "GitHub Step Summary",
    category: "notification",
    description: "Write a markdown summary to the GitHub Actions job summary page.",
    color: "#24292F",
    icon: "📋",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "githubSummary",
    envVars: [],
  },
];

/** Get all provider options for a given category. */
export function getProvidersForCategory(category: string): ProviderOption[] {
  return PROVIDER_CATALOG.filter((p) => p.category === category);
}

/** Get a provider option by its unique id. */
export function getProviderById(id: string): ProviderOption | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
