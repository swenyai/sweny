/**
 * sweny init — Interactive setup wizard
 *
 * Pure functions for file generation + thin @clack/prompts interactive layer.
 * Tests cover the pure functions; the interactive wizard is thin glue.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";

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

// ── Interactive wizard ────────────────────────────────────────────────

function cancel(): never {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

/**
 * Interactive setup wizard — prompts the user through provider selection,
 * then generates `.sweny.yml`, `.env`, and an optional GitHub Action workflow.
 */
export async function runInit(): Promise<void> {
  const cwd = process.cwd();

  // ── Intro ───────────────────────────────────────────────────────────
  p.intro("Let's set up SWEny");

  const gitInfo = detectGitRemote(cwd);
  if (gitInfo) {
    p.log.info(`Detected git remote: ${chalk.cyan(gitInfo.remote)}`);
  }

  // ── Existing file check ─────────────────────────────────────────────
  const configPath = path.join(cwd, ".sweny.yml");
  if (fs.existsSync(configPath)) {
    const overwrite = await p.confirm({
      message: ".sweny.yml already exists. Overwrite?",
      initialValue: false,
    });
    if (p.isCancel(overwrite)) cancel();
    if (!overwrite) {
      p.cancel("Setup cancelled — existing config preserved.");
      process.exit(0);
    }
  }

  // ── Screen 1: Source control ────────────────────────────────────────
  const sourceControl = await p.select({
    message: "Source control provider",
    initialValue: gitInfo?.provider ?? "github",
    options: [
      {
        value: "github",
        label: "GitHub" + (gitInfo?.provider === "github" ? " (detected)" : ""),
      },
      {
        value: "gitlab",
        label: "GitLab" + (gitInfo?.provider === "gitlab" ? " (detected)" : ""),
      },
    ],
  });
  if (p.isCancel(sourceControl)) cancel();

  // ── Screen 2: Observability ─────────────────────────────────────────
  const obsRaw = await p.select({
    message: "Observability provider",
    options: [
      { value: "datadog", label: "Datadog" },
      { value: "sentry", label: "Sentry" },
      { value: "betterstack", label: "BetterStack" },
      { value: "newrelic", label: "New Relic" },
      { value: "cloudwatch", label: "CloudWatch" },
      { value: "__other", label: "Other" },
      { value: "__none", label: "None" },
    ],
  });
  if (p.isCancel(obsRaw)) cancel();

  let observability: string | null;
  if ((obsRaw as string) === "__none") {
    observability = null;
  } else if ((obsRaw as string) === "__other") {
    const custom = await p.text({
      message: "Enter your observability provider name",
      validate: (v) => (!v || v.trim().length === 0 ? "Provider name is required" : undefined),
    });
    if (p.isCancel(custom)) cancel();
    observability = (custom as string).trim().toLowerCase();
  } else {
    observability = obsRaw as string;
  }

  // ── Screen 3: Issue tracker ─────────────────────────────────────────
  const issueTracker = await p.select({
    message: "Issue tracker",
    initialValue: (sourceControl as string) === "github" ? "github-issues" : undefined,
    options: [
      { value: "github-issues", label: "GitHub Issues" },
      { value: "linear", label: "Linear" },
      { value: "jira", label: "Jira" },
    ],
  });
  if (p.isCancel(issueTracker)) cancel();

  // ── Screen 4: Notification ──────────────────────────────────────────
  const notification = await p.select({
    message: "Notification channel",
    initialValue: "console",
    options: [
      { value: "console", label: "Console (default)" },
      { value: "slack", label: "Slack" },
      { value: "discord", label: "Discord" },
      { value: "teams", label: "Microsoft Teams" },
      { value: "webhook", label: "Webhook" },
    ],
  });
  if (p.isCancel(notification)) cancel();

  // ── Screen 5: GitHub Action ─────────────────────────────────────────
  const wantAction = await p.confirm({
    message: "Set up a GitHub Action workflow?",
    initialValue: true,
  });
  if (p.isCancel(wantAction)) cancel();

  let cronExpression: string | null = null;
  if (wantAction) {
    const schedule = await p.select({
      message: "How often should the triage run?",
      options: [
        { value: "0 9 * * *", label: "Daily (9 AM UTC)" },
        { value: "0 9 * * 1", label: "Weekly (Monday 9 AM UTC)" },
        { value: "__custom", label: "Custom cron expression" },
      ],
    });
    if (p.isCancel(schedule)) cancel();

    if ((schedule as string) === "__custom") {
      const customCron = await p.text({
        message: "Enter cron expression (e.g. 0 8 * * 1-5)",
        validate: (v) => (!v || v.trim().length === 0 ? "Cron expression is required" : undefined),
      });
      if (p.isCancel(customCron)) cancel();
      cronExpression = (customCron as string).trim();
    } else {
      cronExpression = schedule as string;
    }
  }

  // ── Assemble selections ─────────────────────────────────────────────
  const selections: InitSelections = {
    sourceControl: sourceControl as string,
    observability,
    issueTracker: issueTracker as string,
    notification: notification as string,
    githubAction: !!wantAction,
    cronExpression,
  };

  const credentials = collectCredentials(selections);

  // ── Screen 6: Summary ───────────────────────────────────────────────
  const files = [".sweny.yml", ".env"];
  if (selections.githubAction) files.push(".github/workflows/sweny.yml");

  p.log.message(
    [
      chalk.bold("Files to create:"),
      ...files.map((f) => `  ${chalk.cyan(f)}`),
      "",
      chalk.bold("Providers:"),
      `  Source control:  ${selections.sourceControl}`,
      `  Observability:   ${selections.observability ?? "none"}`,
      `  Issue tracker:   ${selections.issueTracker}`,
      `  Notification:    ${selections.notification}`,
      selections.githubAction ? `  GitHub Action:   ${selections.cronExpression}` : "  GitHub Action:   no",
    ].join("\n"),
  );

  const confirmed = await p.confirm({
    message: "Create these files?",
    initialValue: true,
  });
  if (p.isCancel(confirmed)) cancel();
  if (!confirmed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // ── Screen 7: Write files ──────────────────────────────────────────

  // 1. Write .sweny.yml
  fs.writeFileSync(configPath, buildSwenyYml(selections), "utf-8");
  p.log.success("Created .sweny.yml");

  // 2. Write .env
  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf-8");
    const newKeys: Credential[] = [];
    for (const cred of credentials) {
      if (!existing.includes(cred.key + "=")) {
        newKeys.push(cred);
      }
    }
    if (newKeys.length > 0) {
      const appendBlock = "\n" + buildEnvTemplate(newKeys);
      fs.appendFileSync(envPath, appendBlock, "utf-8");
      p.log.success(`Appended ${newKeys.length} new key(s) to .env`);
    } else {
      p.log.info(".env already contains all required keys — skipped");
    }
  } else {
    fs.writeFileSync(envPath, buildEnvTemplate(credentials), "utf-8");
    p.log.success("Created .env");
  }

  // 3. GitHub Action workflow
  if (selections.githubAction && selections.cronExpression) {
    const workflowDir = path.join(cwd, ".github", "workflows");
    const workflowPath = path.join(workflowDir, "sweny.yml");

    if (fs.existsSync(workflowPath)) {
      const overwriteWf = await p.confirm({
        message: ".github/workflows/sweny.yml already exists. Overwrite?",
        initialValue: false,
      });
      if (p.isCancel(overwriteWf)) cancel();
      if (!overwriteWf) {
        p.log.info("Skipped GitHub Action workflow");
      } else {
        fs.mkdirSync(workflowDir, { recursive: true });
        fs.writeFileSync(workflowPath, buildActionWorkflow(credentials, selections.cronExpression), "utf-8");
        p.log.success("Created .github/workflows/sweny.yml");
      }
    } else {
      fs.mkdirSync(workflowDir, { recursive: true });
      fs.writeFileSync(workflowPath, buildActionWorkflow(credentials, selections.cronExpression), "utf-8");
      p.log.success("Created .github/workflows/sweny.yml");
    }
  }

  // 4. .gitignore check
  const gitignorePath = path.join(cwd, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".env")) {
      p.log.warn(chalk.yellow(".env is not in .gitignore — add it to avoid committing secrets"));
    }
  } else {
    p.log.warn(chalk.yellow("No .gitignore found — make sure .env is not committed"));
  }

  // 5. Next steps
  const docUrls = credentials.filter((c) => c.url).map((c) => `  ${c.key}: ${c.url}`);

  p.note(
    [
      "1. Fill in your API keys in .env:",
      ...docUrls,
      "",
      "2. Verify connectivity:",
      "   sweny check",
      "",
      "3. Run a dry-run triage:",
      "   sweny triage --dry-run",
    ].join("\n"),
    "Next steps",
  );

  // 6. Done
  p.outro("You're all set!");
}
