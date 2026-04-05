// ── Types ──────────────────────────────────────────────────────────────

export interface Credential {
  key: string;
  hint?: string;
  url?: string;
  default?: string;
}

export interface InitSelections {
  sourceControl: string;
  observability: string | null;
  issueTracker: string;
  notification: string;
  githubAction: boolean;
  cronExpression: string | null;
}

export interface GitRemoteInfo {
  provider: "github" | "gitlab";
  remote: string;
}

// ── Credential table ───────────────────────────────────────────────────

export const PROVIDER_CREDENTIALS: Record<string, Credential[]> = {
  github: [
    {
      key: "GITHUB_TOKEN",
      url: "https://github.com/settings/tokens",
      hint: "repo + issues scopes",
    },
  ],
  gitlab: [
    {
      key: "GITLAB_TOKEN",
      url: "https://gitlab.com/-/profile/personal_access_tokens",
    },
    { key: "GITLAB_URL", default: "https://gitlab.com" },
  ],
  datadog: [
    {
      key: "DD_API_KEY",
      url: "https://app.datadoghq.com/organization-settings",
      hint: "Organization Settings > API Keys",
    },
    { key: "DD_APP_KEY", hint: "Organization Settings > Application Keys" },
    { key: "DD_SITE", default: "datadoghq.com" },
  ],
  sentry: [
    {
      key: "SENTRY_AUTH_TOKEN",
      url: "https://sentry.io/settings/auth-tokens/",
    },
    { key: "SENTRY_ORG", hint: "sentry.io/organizations/slug/" },
  ],
  betterstack: [
    {
      key: "BETTERSTACK_API_TOKEN",
      url: "https://betterstack.com/docs/logs/api",
    },
  ],
  newrelic: [{ key: "NR_API_KEY", url: "https://one.newrelic.com/api-keys" }],
  cloudwatch: [
    { key: "AWS_ACCESS_KEY_ID" },
    { key: "AWS_SECRET_ACCESS_KEY" },
    { key: "AWS_REGION", default: "us-east-1" },
  ],
  "github-issues": [],
  linear: [
    {
      key: "LINEAR_API_KEY",
      url: "https://linear.app/settings/api",
    },
    {
      key: "LINEAR_TEAM_ID",
      hint: "Settings > Teams > copy ID from URL",
    },
  ],
  jira: [
    { key: "JIRA_BASE_URL" },
    { key: "JIRA_EMAIL" },
    {
      key: "JIRA_API_TOKEN",
      url: "https://id.atlassian.com/manage-profile/security/api-tokens",
    },
  ],
  console: [],
  slack: [{ key: "SLACK_BOT_TOKEN", url: "https://api.slack.com/apps" }],
  discord: [{ key: "DISCORD_WEBHOOK_URL" }],
  teams: [{ key: "TEAMS_WEBHOOK_URL" }],
  webhook: [{ key: "NOTIFICATION_WEBHOOK_URL" }],
};

const ALWAYS_CREDENTIALS: Credential[] = [
  {
    key: "ANTHROPIC_API_KEY",
    url: "https://console.anthropic.com/settings/keys",
    hint: "Claude API key",
  },
];

// ── Functions ──────────────────────────────────────────────────────────

/**
 * Gather all unique credentials required for the selected providers.
 * Always includes ANTHROPIC_API_KEY. Deduplicates by key name.
 */
export function collectCredentials(selections: InitSelections): Credential[] {
  const seen = new Map<string, Credential>();

  // Always-present credentials first
  for (const cred of ALWAYS_CREDENTIALS) {
    seen.set(cred.key, cred);
  }

  const providers = [
    selections.sourceControl,
    selections.observability,
    selections.issueTracker,
    selections.notification,
  ].filter((p): p is string => p !== null);

  for (const provider of providers) {
    const creds = PROVIDER_CREDENTIALS[provider];
    if (!creds) continue;
    for (const cred of creds) {
      if (!seen.has(cred.key)) {
        seen.set(cred.key, cred);
      }
    }
  }

  return [...seen.values()];
}
