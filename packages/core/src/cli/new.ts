/**
 * sweny new — Interactive workflow creation wizard
 *
 * Workflow-first: pick a template or describe what you want, then SWEny
 * infers which skills are needed and only asks for those credentials.
 *
 * Pure functions for file generation + thin @clack/prompts interactive layer.
 * Tests cover the pure functions; the interactive wizard is thin glue.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { WORKFLOW_TEMPLATES } from "./templates.js";

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

// ── Skill → Credential mapping ────────────────────────────────────────

/**
 * Maps skill IDs (as used in workflow nodes) to the credentials they require.
 * When a workflow uses a skill, we collect only those credentials.
 */
export const SKILL_CREDENTIALS: Record<string, Credential[]> = {
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
  slack: [{ key: "SLACK_BOT_TOKEN", url: "https://api.slack.com/apps" }],
  discord: [{ key: "DISCORD_WEBHOOK_URL", hint: "Server Settings > Integrations > Webhooks" }],
  notification: [{ key: "NOTIFICATION_WEBHOOK_URL", hint: "Your webhook endpoint URL" }],
};

const ALWAYS_CREDENTIALS: Credential[] = [
  {
    key: "ANTHROPIC_API_KEY",
    url: "https://console.anthropic.com/settings/api-keys",
    hint: "Claude API key",
  },
];

// ── Backward compat alias ─────────────────────────────────────────────
// Old tests/code may reference PROVIDER_CREDENTIALS
export const PROVIDER_CREDENTIALS: Record<string, Credential[]> = {
  ...SKILL_CREDENTIALS,
  "github-issues": [],
  cloudwatch: [
    { key: "AWS_ACCESS_KEY_ID", hint: "IAM user access key" },
    { key: "AWS_SECRET_ACCESS_KEY", hint: "IAM user secret key" },
    { key: "AWS_REGION", hint: "e.g. us-east-1", default: "us-east-1" },
  ],
  console: [],
  teams: [{ key: "TEAMS_WEBHOOK_URL", hint: "Channel > Connectors > Incoming Webhook" }],
  webhook: [{ key: "NOTIFICATION_WEBHOOK_URL", hint: "Your webhook endpoint URL" }],
};

// ── Functions ──────────────────────────────────────────────────────────

/**
 * Extract all unique skill IDs from a workflow template YAML string.
 */
export function extractSkillsFromYaml(yaml: string): string[] {
  const skills = new Set<string>();
  // Match skills: [github, linear, sentry] patterns
  const matches = yaml.matchAll(/skills:\s*\[([^\]]+)\]/g);
  for (const m of matches) {
    for (const skill of m[1].split(",")) {
      skills.add(skill.trim());
    }
  }
  return [...skills];
}

/**
 * Gather credentials required for a set of skills.
 * Always includes ANTHROPIC_API_KEY. Deduplicates by key name.
 */
export function collectCredentialsForSkills(skills: string[]): Credential[] {
  const seen = new Map<string, Credential>();

  for (const cred of ALWAYS_CREDENTIALS) {
    seen.set(cred.key, cred);
  }

  for (const skill of skills) {
    const creds = SKILL_CREDENTIALS[skill];
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
 * Gather all unique credentials required for the selected providers.
 * Always includes ANTHROPIC_API_KEY. Deduplicates by key name.
 * @deprecated Use collectCredentialsForSkills instead — kept for backward compat.
 */
export function collectCredentials(selections: InitSelections): Credential[] {
  const seen = new Map<string, Credential>();

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

  // SSH scheme: ssh://git@github.com/owner/repo.git
  const sshSchemeMatch = url.match(/^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshSchemeMatch) {
    const host = sshSchemeMatch[1];
    const repoPath = sshSchemeMatch[2];
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
 * Infer source-control-provider from git remote detection.
 */
function inferSourceControl(gitInfo: GitRemoteInfo | null): string {
  return gitInfo?.provider ?? "github";
}

/**
 * Infer issue-tracker-provider from skills in the workflow.
 */
function inferIssueTracker(skills: string[], sourceControl: string): string {
  if (skills.includes("linear")) return "linear";
  if (skills.includes("jira")) return "jira";
  return sourceControl === "github" ? "github-issues" : "github-issues";
}

/**
 * Infer observability-provider from skills in the workflow.
 */
function inferObservability(skills: string[]): string | null {
  if (skills.includes("datadog")) return "datadog";
  if (skills.includes("sentry")) return "sentry";
  if (skills.includes("betterstack")) return "betterstack";
  if (skills.includes("newrelic")) return "newrelic";
  return null;
}

/**
 * Generate .sweny.yml content from inferred providers.
 */
export function buildSwenyYml(sourceControl: string, observability: string | null, issueTracker: string): string {
  const lines: string[] = [];

  lines.push("# .sweny.yml — SWEny project configuration");
  lines.push("# Secrets (API keys, tokens) go in .env (gitignored).");
  lines.push("# Docs: https://docs.sweny.ai/cli");
  lines.push("");

  lines.push(`source-control-provider: ${sourceControl}`);

  if (observability !== null) {
    lines.push(`observability-provider: ${observability}`);
  }

  lines.push(`issue-tracker-provider: ${issueTracker}`);
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
  lines.push("      - uses: swenyai/sweny@v5");
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
 * Interactive workflow creation wizard — workflow-first approach.
 *
 * 1. Detect git remote (infer source control)
 * 2. Pick a workflow template (or describe your own, or e2e)
 * 3. Infer providers from workflow skills
 * 4. Collect only the credentials those skills need
 * 5. Generate files (non-destructive if .sweny.yml already exists)
 */
export async function runNew(): Promise<void> {
  const cwd = process.cwd();

  // ── Intro ───────────────────────────────────────────────────────────
  p.intro("Let's set up SWEny");

  const gitInfo = detectGitRemote(cwd);
  if (gitInfo) {
    p.log.info(`Detected: ${chalk.cyan(gitInfo.remote)} (${gitInfo.provider})`);
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

  // ── Step 1: Pick a workflow ─────────────────────────────────────────
  const templateChoice = await p.select({
    message: "What do you want to do?",
    options: [
      ...WORKFLOW_TEMPLATES.map((t) => ({
        value: t.id,
        label: t.name,
        hint: t.description,
      })),
      { value: "__blank", label: "Start blank", hint: "just set up config, I'll create workflows later" },
    ],
  });
  if (p.isCancel(templateChoice)) cancel();

  // ── Step 2: Infer everything from the workflow ──────────────────────
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateChoice);
  const workflowSkills = template ? extractSkillsFromYaml(template.yaml) : [];

  const sourceControl = inferSourceControl(gitInfo);
  const issueTracker = inferIssueTracker(workflowSkills, sourceControl);
  const observability = inferObservability(workflowSkills);

  // Collect credentials for the workflow's skills (+ always ANTHROPIC_API_KEY)
  const credentials = collectCredentialsForSkills(workflowSkills);

  // ── Step 3: Summary + confirm ───────────────────────────────────────
  const files = [".sweny.yml", ".env"];
  if (template) files.push(`.sweny/workflows/${template.id}.yml`);

  const inferred: string[] = [
    `  Source control:  ${sourceControl}${gitInfo ? " (detected)" : ""}`,
    `  Issue tracker:   ${issueTracker}`,
  ];
  if (observability) {
    inferred.push(`  Observability:   ${observability}`);
  }
  if (workflowSkills.length > 0) {
    inferred.push(`  Skills:          ${workflowSkills.join(", ")}`);
  }

  p.log.message(
    [
      chalk.bold("Files to create:"),
      ...files.map((f) => `  ${chalk.cyan(f)}`),
      "",
      chalk.bold("Inferred from workflow:"),
      ...inferred,
      "",
      chalk.bold(`Credentials needed: ${credentials.length}`),
      ...credentials.map((c) => `  ${chalk.dim(c.key)}`),
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

  // ── Step 4: Write files ─────────────────────────────────────────────

  // 1. Write .sweny.yml
  fs.writeFileSync(configPath, buildSwenyYml(sourceControl, observability, issueTracker), "utf-8");
  p.log.success("Created .sweny.yml");

  // 2. Write .env
  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf-8");
    const definedKeys = new Set(
      existing
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#") && l.includes("="))
        .map((l) => l.split("=")[0].trim()),
    );
    const newKeys: Credential[] = [];
    for (const cred of credentials) {
      if (!definedKeys.has(cred.key)) {
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

  // 3. Workflow template
  if (template) {
    const workflowDir = path.join(cwd, ".sweny", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    const templatePath = path.join(workflowDir, `${template.id}.yml`);
    fs.writeFileSync(templatePath, template.yaml, "utf-8");
    p.log.success(`Created .sweny/workflows/${template.id}.yml`);
  }

  // 4. .gitignore check
  const gitignorePath = path.join(cwd, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    const envIgnored = gitignore.split("\n").some((line) => line.trim() === ".env");
    if (!envIgnored) {
      p.log.warn(chalk.yellow(".env is not in .gitignore — add it to avoid committing secrets"));
    }
  } else {
    p.log.warn(chalk.yellow("No .gitignore found — make sure .env is not committed"));
  }

  // 5. Next steps
  const credUrls = credentials.filter((c) => c.url).map((c) => `  ${c.key}: ${c.url}`);

  const steps = ["1. Fill in your API keys in .env:", ...credUrls, "", "2. Verify connectivity:", "   sweny check"];

  if (template) {
    steps.push("", `3. Run your workflow:`, `   sweny workflow run .sweny/workflows/${template.id}.yml`);
  } else {
    steps.push("", "3. Create your first workflow:", '   sweny workflow create "describe what you want"');
  }

  p.note(steps.join("\n"), "Next steps");

  p.outro("You're all set!");
}

/**
 * @deprecated Use `runNew` instead. Kept as a named re-export so external
 * callers (e.g. create-sweny, plugin skills) don't break during the migration.
 */
export const runInit = runNew;
