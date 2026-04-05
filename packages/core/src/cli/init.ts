/**
 * sweny init — Interactive setup wizard
 *
 * Pure functions for file generation + thin @clack/prompts interactive layer.
 * Tests cover the pure functions; the interactive wizard is thin glue.
 */

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
      hint: "api scope",
      url: "https://gitlab.com/-/profile/personal_access_tokens",
    },
    { key: "GITLAB_URL", hint: "e.g. https://gitlab.com", default: "https://gitlab.com" },
  ],
  datadog: [
    {
      key: "DD_API_KEY",
      url: "https://app.datadoghq.com/organization-settings",
      hint: "Organization Settings > API Keys",
    },
    { key: "DD_APP_KEY", hint: "Organization Settings > Application Keys" },
    { key: "DD_SITE", hint: "datadoghq.com, datadoghq.eu, etc.", default: "datadoghq.com" },
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
    { key: "AWS_ACCESS_KEY_ID", hint: "IAM user access key" },
    { key: "AWS_SECRET_ACCESS_KEY", hint: "IAM user secret key" },
    { key: "AWS_REGION", hint: "e.g. us-east-1", default: "us-east-1" },
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
    { key: "JIRA_BASE_URL", hint: "e.g. https://your-org.atlassian.net" },
    { key: "JIRA_EMAIL", hint: "your Atlassian account email" },
    {
      key: "JIRA_API_TOKEN",
      url: "https://id.atlassian.com/manage-profile/security/api-tokens",
    },
  ],
  console: [],
  slack: [{ key: "SLACK_BOT_TOKEN", url: "https://api.slack.com/apps" }],
  discord: [{ key: "DISCORD_WEBHOOK_URL", hint: "Server Settings > Integrations > Webhooks" }],
  teams: [{ key: "TEAMS_WEBHOOK_URL", hint: "Channel > Connectors > Incoming Webhook" }],
  webhook: [{ key: "NOTIFICATION_WEBHOOK_URL", hint: "Your webhook endpoint URL" }],
};

const ALWAYS_CREDENTIALS: Credential[] = [
  {
    key: "ANTHROPIC_API_KEY",
    url: "https://console.anthropic.com/settings/api-keys",
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

  return Array.from(seen.values());
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

  lines.push("# .sweny.yml — SWEny project configuration");
  lines.push("# Secrets (API keys, tokens) go in .env (gitignored).");
  lines.push("# Docs: https://docs.sweny.ai/cli");
  lines.push("");

  lines.push(`source-control-provider: ${selections.sourceControl}`);

  if (selections.observability !== null) {
    lines.push(`observability-provider: ${selections.observability}`);
  }

  lines.push(`issue-tracker-provider: ${selections.issueTracker}`);

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

  lines.push("# .env — SWEny credentials (DO NOT COMMIT)");
  lines.push("# Fill in each value, then run: sweny check");
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
  lines.push("        with:");
  lines.push("          workflow: triage");
  if (secretCreds.length > 0) {
    lines.push("        env:");
    for (const cred of secretCreds) {
      lines.push(`          ${cred.key}: \${{ secrets.${cred.key} }}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
