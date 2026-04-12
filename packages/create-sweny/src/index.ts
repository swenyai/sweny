#!/usr/bin/env node
/**
 * create-sweny — Scaffold a SWEny AI workflow project.
 *
 * Usage: npx create-sweny [directory]
 *
 * Standalone package — no dependency on @sweny-ai/core so users get a fast
 * install. Templates and config generation are inlined.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";

// ── Templates (inlined to avoid @sweny-ai/core dependency) ──────────

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  yaml: string;
}

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "pr-review",
    name: "PR Review Bot",
    description: "Automated code review on pull requests",
    yaml: `id: pr-review
name: PR Review Bot
description: Review pull requests for code quality, security issues, and best practices.
entry: fetch-diff

nodes:
  fetch-diff:
    name: Fetch PR Changes
    instruction: |
      Fetch the pull request diff. Identify which files changed,
      what was added, modified, or removed. Summarize the scope.
    skills: [github]

  review-code:
    name: Review Code
    instruction: |
      Review the code changes for security vulnerabilities, logic errors,
      code style, and test coverage gaps. Be specific with file names
      and line numbers. Categorize as critical, important, or minor.
    skills: [github]

  post-review:
    name: Post Review Comment
    instruction: |
      Post a structured review comment on the pull request.
      Lead with a summary, then list findings by severity.
    skills: [github]

edges:
  - from: fetch-diff
    to: review-code
  - from: review-code
    to: post-review
`,
  },
  {
    id: "issue-triage",
    name: "Issue Triage",
    description: "Classify, prioritize, and label incoming issues",
    yaml: `id: issue-triage
name: Issue Triage
description: Automatically classify, prioritize, and label new issues.
entry: classify

nodes:
  classify:
    name: Classify Issue
    instruction: |
      Read the issue title and body. Classify as bug, feature,
      question, or chore. Assess priority P0-P3.
    skills: [github]

  label-and-assign:
    name: Apply Labels
    instruction: |
      Apply appropriate labels to the issue based on classification.
      Add a comment explaining the rationale.
    skills: [github]

edges:
  - from: classify
    to: label-and-assign
`,
  },
  {
    id: "security-scan",
    name: "Security Audit",
    description: "Scan code and dependencies for vulnerabilities",
    yaml: `id: security-scan
name: Security Audit
description: Scan repository code and dependencies for security vulnerabilities.
entry: scan-code

nodes:
  scan-code:
    name: Scan Code for Secrets
    instruction: |
      Search the repository for exposed secrets, API keys,
      and hardcoded credentials in code and config files.
    skills: [github]

  scan-deps:
    name: Scan Dependencies
    instruction: |
      Review dependency manifests for known vulnerable versions
      and outdated packages with security advisories.
    skills: [github]

  compile-report:
    name: Compile Security Report
    instruction: |
      Compile findings into a structured report categorized by
      severity (critical, high, medium, low) with remediation steps.
    skills: [github]

edges:
  - from: scan-code
    to: scan-deps
  - from: scan-deps
    to: compile-report
`,
  },
];

// ── Provider credentials ────────────────────────────────────────────

interface ProviderCred {
  key: string;
  hint?: string;
  url?: string;
  default?: string;
}

const CREDENTIALS: Record<string, ProviderCred[]> = {
  github: [{ key: "GITHUB_TOKEN", url: "https://github.com/settings/tokens", hint: "repo + issues scopes" }],
  gitlab: [
    { key: "GITLAB_TOKEN", url: "https://gitlab.com/-/profile/personal_access_tokens", hint: "api scope" },
    { key: "GITLAB_URL", hint: "e.g. https://gitlab.com", default: "https://gitlab.com" },
  ],
  datadog: [
    { key: "DD_API_KEY", url: "https://app.datadoghq.com/organization-settings" },
    { key: "DD_APP_KEY", hint: "Organization Settings > Application Keys" },
  ],
  sentry: [
    { key: "SENTRY_AUTH_TOKEN", url: "https://sentry.io/settings/auth-tokens/" },
    { key: "SENTRY_ORG", hint: "sentry.io/organizations/slug/" },
  ],
  betterstack: [{ key: "BETTERSTACK_API_TOKEN", url: "https://betterstack.com/docs/logs/api" }],
  "github-issues": [],
  linear: [
    { key: "LINEAR_API_KEY", url: "https://linear.app/settings/api" },
    { key: "LINEAR_TEAM_ID", hint: "Settings > Teams > copy ID from URL" },
  ],
  jira: [
    { key: "JIRA_BASE_URL", hint: "e.g. https://your-org.atlassian.net" },
    { key: "JIRA_EMAIL", hint: "your Atlassian account email" },
    { key: "JIRA_API_TOKEN", url: "https://id.atlassian.com/manage-profile/security/api-tokens" },
  ],
};

// ── Helpers ─────────────────────────────────────────────────────────

function cancel(): never {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

function collectCreds(providers: (string | null)[]): ProviderCred[] {
  const seen = new Map<string, ProviderCred>();
  seen.set("ANTHROPIC_API_KEY", {
    key: "ANTHROPIC_API_KEY",
    url: "https://console.anthropic.com/settings/api-keys",
    hint: "Claude API key",
  });

  for (const prov of providers) {
    if (!prov) continue;
    for (const c of CREDENTIALS[prov] ?? []) {
      if (!seen.has(c.key)) seen.set(c.key, c);
    }
  }

  return Array.from(seen.values());
}

function buildSwenyYml(sc: string, obs: string | null, it: string): string {
  const lines = [
    "# .sweny.yml — SWEny project configuration",
    "# Secrets go in .env (gitignored). Docs: https://docs.sweny.ai/cli",
    "",
    `source-control-provider: ${sc}`,
  ];
  if (obs) lines.push(`observability-provider: ${obs}`);
  lines.push(`issue-tracker-provider: ${it}`, "");
  return lines.join("\n");
}

function buildEnv(creds: ProviderCred[]): string {
  const lines = ["# .env — SWEny credentials (DO NOT COMMIT)", ""];
  for (const c of creds) {
    if (c.url) lines.push(`# ${c.url}`);
    if (c.hint) lines.push(`# ${c.hint}`);
    lines.push(c.default !== undefined ? `${c.key}=${c.default}` : `${c.key}=`, "");
  }
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const dirArg = process.argv[2];

  p.intro(chalk.bold("Create SWEny Project"));

  // Step 1: Directory
  let targetDir: string;
  if (dirArg && dirArg !== ".") {
    targetDir = path.resolve(dirArg);
    p.log.info(`Project directory: ${chalk.cyan(targetDir)}`);
  } else if (dirArg === ".") {
    targetDir = process.cwd();
  } else {
    const dir = await p.text({
      message: "Project directory",
      placeholder: ".",
      initialValue: ".",
    });
    if (p.isCancel(dir)) cancel();
    targetDir = path.resolve((dir as string).trim() || ".");
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    p.log.success(`Created ${chalk.cyan(targetDir)}`);
  }

  // Step 2: Source control
  const sourceControl = await p.select({
    message: "Source control",
    initialValue: "github",
    options: [
      { value: "github", label: "GitHub" },
      { value: "gitlab", label: "GitLab" },
    ],
  });
  if (p.isCancel(sourceControl)) cancel();

  // Step 3: Issue tracker
  const issueTracker = await p.select({
    message: "Issue tracker",
    initialValue: "github-issues",
    options: [
      { value: "github-issues", label: "GitHub Issues" },
      { value: "linear", label: "Linear" },
      { value: "jira", label: "Jira" },
    ],
  });
  if (p.isCancel(issueTracker)) cancel();

  // Step 4: Observability (optional)
  const obsRaw = await p.select({
    message: "Observability provider",
    options: [
      { value: "__none", label: "None" },
      { value: "datadog", label: "Datadog" },
      { value: "sentry", label: "Sentry" },
      { value: "betterstack", label: "BetterStack" },
    ],
  });
  if (p.isCancel(obsRaw)) cancel();
  const observability = (obsRaw as string) === "__none" ? null : (obsRaw as string);

  // Step 5: Starter template
  const templateChoice = await p.select({
    message: "Start with a workflow template?",
    options: [
      ...TEMPLATES.map((t) => ({ value: t.id, label: t.name, hint: t.description })),
      { value: "__none", label: "Skip", hint: "I'll create my own" },
    ],
  });
  if (p.isCancel(templateChoice)) cancel();

  // ── Generate files ──────────────────────────────────────────────────

  const creds = collectCreds([sourceControl as string, observability, issueTracker as string]);

  // .sweny.yml
  const configPath = path.join(targetDir, ".sweny.yml");
  fs.writeFileSync(configPath, buildSwenyYml(sourceControl as string, observability, issueTracker as string));
  p.log.success("Created .sweny.yml");

  // .env
  const envPath = path.join(targetDir, ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, buildEnv(creds));
    p.log.success("Created .env");
  } else {
    p.log.info(".env already exists — skipped");
  }

  // .gitignore — ensure .env is ignored
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    if (!existing.split("\n").some((l) => l.trim() === ".env")) {
      fs.appendFileSync(gitignorePath, "\n.env\n");
      p.log.success("Added .env to .gitignore");
    }
  } else {
    fs.writeFileSync(gitignorePath, ".env\nnode_modules/\n");
    p.log.success("Created .gitignore");
  }

  // Workflow template
  const template = TEMPLATES.find((t) => t.id === templateChoice);
  let templatePath: string | null = null;
  if (template) {
    const wfDir = path.join(targetDir, ".sweny", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    templatePath = path.join(wfDir, `${template.id}.yml`);
    fs.writeFileSync(templatePath, template.yaml);
    p.log.success(`Created .sweny/workflows/${template.id}.yml`);
  }

  // ── Next steps ──────────────────────────────────────────────────────

  const credUrls = creds.filter((c) => c.url).map((c) => `  ${c.key}: ${c.url}`);

  const steps = [
    "1. Add your API keys to .env:",
    ...credUrls,
    "",
    "2. Install the CLI:",
    "   npm install -g @sweny-ai/core",
    "",
    "3. Verify connectivity:",
    "   sweny check",
  ];

  if (template && templatePath) {
    steps.push("", `4. Run your starter workflow:`, `   sweny workflow run .sweny/workflows/${template.id}.yml`);
  } else {
    steps.push("", "4. Create your first workflow:", '   sweny workflow create "describe your task here"');
  }

  p.note(steps.join("\n"), "Next steps");
  p.outro(chalk.green("You're all set!") + " " + chalk.dim("Docs: https://docs.sweny.ai"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
