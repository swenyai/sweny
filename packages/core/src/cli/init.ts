import * as fs from "node:fs";
import * as path from "node:path";

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

/**
 * Detect the git remote origin from `.git/config`.
 * Returns provider + normalised remote (e.g. "github.com/owner/repo"), or null.
 */
export function detectGitRemote(cwd: string): GitRemoteInfo | null {
  const configPath = path.join(cwd, ".git", "config");

  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }

  // Find [remote "origin"] section and extract url
  const remoteMatch = content.match(/\[remote\s+"origin"\]\s*\n(?:\s+[^\[]*?\n)*?\s*url\s*=\s*(.+)/);
  if (!remoteMatch) return null;

  const url = remoteMatch[1].trim();

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const repoPath = sshMatch[2];
    if (host === "github.com") {
      return { provider: "github", remote: `github.com/${repoPath}` };
    }
    if (host === "gitlab.com") {
      return { provider: "gitlab", remote: `gitlab.com/${repoPath}` };
    }
    return null;
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    const repoPath = httpsMatch[2];
    if (host === "github.com") {
      return { provider: "github", remote: `github.com/${repoPath}` };
    }
    if (host === "gitlab.com") {
      return { provider: "gitlab", remote: `gitlab.com/${repoPath}` };
    }
    return null;
  }

  return null;
}

/**
 * Generate .sweny.yml content from selections.
 */
export function buildSwenyYml(selections: InitSelections): string {
  const lines: string[] = [];

  lines.push("# SWEny configuration");
  lines.push("# https://sweny.ai/docs/config");
  lines.push("");

  lines.push(`source-control: ${selections.sourceControl}`);

  if (selections.observability !== null) {
    lines.push(`observability-provider: ${selections.observability}`);
  }

  lines.push(`issue-tracker: ${selections.issueTracker}`);

  // Omit notification-provider when "console" (it's the default)
  if (selections.notification !== "console") {
    lines.push(`notification-provider: ${selections.notification}`);
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Generate .env template with comments for each credential.
 */
export function buildEnvTemplate(credentials: Credential[]): string {
  const lines: string[] = [];

  lines.push("# SWEny environment variables");
  lines.push("# Fill in the values below and keep this file out of version control.");
  lines.push("");

  for (const cred of credentials) {
    if (cred.url) {
      lines.push(`# ${cred.url}`);
    }
    if (cred.hint) {
      lines.push(`# ${cred.hint}`);
    }
    if (cred.default !== undefined) {
      lines.push(`${cred.key}=${cred.default}`);
    } else {
      lines.push(`${cred.key}=`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate a GitHub Actions workflow YAML for SWEny.
 * Only includes credentials WITHOUT defaults as secrets.
 */
export function buildActionWorkflow(credentials: Credential[], cronExpression: string): string {
  const secretCreds = credentials.filter((c) => c.default === undefined);

  const lines: string[] = [];

  lines.push("name: SWEny Triage");
  lines.push("");
  lines.push("on:");
  lines.push("  schedule:");
  lines.push(`    - cron: "${cronExpression}"`);
  lines.push("  workflow_dispatch:");
  lines.push("");
  lines.push("jobs:");
  lines.push("  triage:");
  lines.push("    runs-on: ubuntu-latest");
  lines.push("    steps:");
  lines.push("      - uses: actions/checkout@v4");
  lines.push("      - uses: swenyai/sweny@v4");
  if (secretCreds.length > 0) {
    lines.push("        env:");
    for (const cred of secretCreds) {
      lines.push(`          ${cred.key}: \${{ secrets.${cred.key} }}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
