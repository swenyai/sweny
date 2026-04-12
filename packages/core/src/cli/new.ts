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
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "./templates.js";
import { buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { ClaudeClient } from "../claude.js";
import { consoleLogger } from "../types.js";
import { configuredSkills } from "../skills/custom-loader.js";
import { DagRenderer } from "./renderer.js";
import { runE2eInit } from "./e2e.js";

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
 * Extract all unique skill IDs used by nodes in a workflow YAML string.
 *
 * Handles both inline (`skills: [github, linear]`) and block-style arrays:
 *
 * ```yaml
 * skills:
 *   - github
 *   - linear
 * ```
 *
 * Returns `[]` for malformed YAML or YAML without node skills.
 */
export function extractSkillsFromYaml(yaml: string): string[] {
  const skills = new Set<string>();

  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];
  const nodes = (parsed as { nodes?: unknown }).nodes;
  if (!nodes || typeof nodes !== "object") return [];

  for (const node of Object.values(nodes as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const nodeSkills = (node as { skills?: unknown }).skills;
    if (!Array.isArray(nodeSkills)) continue;
    for (const skill of nodeSkills) {
      if (typeof skill === "string" && skill.trim().length > 0) {
        skills.add(skill.trim());
      }
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
 *
 * Explicit issue-tracker skills win. Otherwise we default to `github-issues`
 * regardless of source-control provider: we don't ship a gitlab issues
 * provider (yet), and `github-issues` is a sensible "use the same platform
 * as source control" default for the supported case.
 */
function inferIssueTracker(skills: string[], _sourceControl: string): string {
  if (skills.includes("linear")) return "linear";
  if (skills.includes("jira")) return "jira";
  return "github-issues";
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
 * Flow:
 * 1. Detect git remote (used to infer source-control provider)
 * 2. Pick one of four branches:
 *    - A built-in `WORKFLOW_TEMPLATES` entry → write that workflow file
 *    - `__custom` → LLM generates a workflow from a user description
 *    - `__e2e` → delegate to the e2e browser-testing wizard in `./e2e.ts`
 *    - `__blank` → only set up config / credentials (no workflow file)
 * 3. Infer observability + issue-tracker providers from the workflow's skills
 * 4. Collect only the credentials those skills need (+ ANTHROPIC_API_KEY)
 * 5. Write files idempotently:
 *    - `.sweny.yml` is never overwritten — if it exists, we keep it
 *    - `.env` is append-only (dedupes by key, incl. commented placeholders)
 *    - Workflow files in `.sweny/workflows/` prompt before overwriting
 *
 * Safe to re-run in an existing project to add additional workflows.
 */
export async function runNew(): Promise<void> {
  const cwd = process.cwd();

  // ── Fresh vs existing detection ─────────────────────────────────────
  const configPath = path.join(cwd, ".sweny.yml");
  const hasExistingConfig = fs.existsSync(configPath);

  // ── Intro ───────────────────────────────────────────────────────────
  p.intro(hasExistingConfig ? "Adding a new workflow" : "Let's set up SWEny");

  const gitInfo = detectGitRemote(cwd);
  if (gitInfo && !hasExistingConfig) {
    p.log.info(`Detected: ${chalk.cyan(gitInfo.remote)} (${gitInfo.provider})`);
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
      { value: "__e2e", label: "End-to-end browser testing", hint: "Automated browser tests for your app" },
      { value: "__custom", label: "Describe your own", hint: "AI-generated from your description" },
      { value: "__blank", label: "Start blank", hint: "just set up config, I'll create workflows later" },
    ],
  });
  if (p.isCancel(templateChoice)) cancel();

  // ── E2E short-circuit: delegate to the e2e wizard ────────────────────
  if (templateChoice === "__e2e") {
    await runE2eInit({ skipIntro: true });
    return;
  }

  // ── Step 2: Resolve the chosen workflow ─────────────────────────────
  let template: WorkflowTemplate | undefined;

  if (templateChoice === "__custom") {
    template = (await runCustomWorkflowBuilder()) ?? undefined;
    if (!template) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
  } else {
    template = WORKFLOW_TEMPLATES.find((t) => t.id === templateChoice);
  }

  const workflowSkills = template ? extractSkillsFromYaml(template.yaml) : [];

  const sourceControl = inferSourceControl(gitInfo);
  const issueTracker = inferIssueTracker(workflowSkills, sourceControl);
  const observability = inferObservability(workflowSkills);

  // Collect credentials for the workflow's skills (+ always ANTHROPIC_API_KEY)
  const credentials = collectCredentialsForSkills(workflowSkills);

  // ── Step 3: Summary + confirm ───────────────────────────────────────
  const files: string[] = [];
  if (!hasExistingConfig) files.push(".sweny.yml", ".env");
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

  const summaryLines: string[] = [];
  if (files.length > 0) {
    summaryLines.push(chalk.bold("Files to create:"));
    summaryLines.push(...files.map((f) => `  ${chalk.cyan(f)}`));
    summaryLines.push("");
  }
  if (hasExistingConfig) {
    summaryLines.push(chalk.dim("(.sweny.yml already exists — keeping your existing config)"));
    summaryLines.push("");
  }
  summaryLines.push(chalk.bold(hasExistingConfig ? "Workflow uses:" : "Inferred from workflow:"));
  summaryLines.push(...inferred);
  summaryLines.push("");
  summaryLines.push(chalk.bold(`Credentials needed: ${credentials.length}`));
  summaryLines.push(...credentials.map((c) => `  ${chalk.dim(c.key)}`));

  p.log.message(summaryLines.join("\n"));

  const confirmed = await p.confirm({
    message: hasExistingConfig ? "Add this workflow?" : "Create these files?",
    initialValue: true,
  });
  if (p.isCancel(confirmed)) cancel();
  if (!confirmed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // ── Step 4: Write files ─────────────────────────────────────────────

  // 1. Write .sweny.yml (only if fresh — never clobber existing config)
  if (!hasExistingConfig) {
    fs.writeFileSync(configPath, buildSwenyYml(sourceControl, observability, issueTracker), "utf-8");
    p.log.success("Created .sweny.yml");
  } else {
    p.log.info(".sweny.yml already exists — keeping existing config");
  }

  // 2. Write .env (append-only: safe for both fresh and existing repos)
  let addedNewKeys = false;
  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf-8");
    // A key is "present" if it appears as either an active `KEY=...` line
    // or a commented `# KEY=...` placeholder. Either way appending the same
    // key would create a duplicate the user has to reconcile.
    const definedKeys = new Set<string>();
    for (const rawLine of existing.split("\n")) {
      const line = rawLine.trimStart().replace(/^#\s*/, "");
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        definedKeys.add(key);
      }
    }
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
      addedNewKeys = true;
    } else {
      p.log.info(".env already contains all required keys — skipped");
    }
  } else {
    fs.writeFileSync(envPath, buildEnvTemplate(credentials), "utf-8");
    p.log.success("Created .env");
    addedNewKeys = true;
  }

  // 3. Workflow template (prompt per-file if it already exists)
  if (template) {
    const workflowDir = path.join(cwd, ".sweny", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    const templatePath = path.join(workflowDir, `${template.id}.yml`);

    if (fs.existsSync(templatePath)) {
      const overwrite = await p.confirm({
        message: `.sweny/workflows/${template.id}.yml already exists. Overwrite?`,
        initialValue: false,
      });
      if (p.isCancel(overwrite)) cancel();
      if (!overwrite) {
        p.log.info("Workflow file preserved — no changes");
        p.outro("Done.");
        return;
      }
    }

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
  const steps: string[] = [];
  let stepNum = 1;

  if (addedNewKeys) {
    steps.push(
      `${stepNum++}. Fill in your API keys in .env:`,
      ...credUrls,
      "",
      `${stepNum++}. Verify connectivity:`,
      "   sweny check",
      "",
    );
  }

  if (template) {
    steps.push(`${stepNum++}. Run your workflow:`, `   sweny workflow run .sweny/workflows/${template.id}.yml`);
  } else {
    steps.push(`${stepNum++}. Create your first workflow:`, "   sweny new");
  }

  p.note(steps.join("\n"), "Next steps");

  p.outro(hasExistingConfig ? "Workflow added!" : "You're all set!");
}

// ── Custom workflow branch ────────────────────────────────────────────

/**
 * Prompt the user for a description, generate a workflow via the LLM,
 * show it, and run an accept/refine loop. Returns a WorkflowTemplate-shaped
 * object on accept, null on cancel.
 *
 * Consumed by the `__custom` branch of `runNew`'s picker.
 */
async function runCustomWorkflowBuilder(): Promise<WorkflowTemplate | null> {
  const description = await p.text({
    message: "Describe the workflow you want",
    placeholder: "e.g. Review Python PRs for security issues and post a comment",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Description is required";
      if (v.trim().length < 10) return "Please give a bit more detail (10+ characters)";
      return undefined;
    },
  });
  if (p.isCancel(description)) return null;

  const skills = configuredSkills();
  const claude = new ClaudeClient({
    maxTurns: 3,
    cwd: process.cwd(),
    logger: consoleLogger,
  });

  const spinner = p.spinner();
  spinner.start("Generating workflow...");
  let workflow;
  try {
    workflow = await buildWorkflow(description as string, { claude, skills, logger: consoleLogger });
    spinner.stop("Generated");
  } catch (err) {
    spinner.stop("Failed");
    p.log.error(`  ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  while (true) {
    // Show the DAG
    console.log("");
    const renderer = new DagRenderer(workflow, { animate: false });
    console.log(renderer.renderToString());
    console.log("");

    const action = await p.select({
      message: "Looks good?",
      options: [
        { value: "accept", label: "Yes — use this workflow" },
        { value: "refine", label: "Refine — describe what to change" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    if (p.isCancel(action) || action === "cancel") return null;

    if (action === "accept") {
      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description ?? "",
        yaml: stringifyYaml(workflow, { indent: 2, lineWidth: 120 }),
      };
    }

    if (action === "refine") {
      const refinement = await p.text({
        message: "What would you like to change?",
        validate: (v) => (v && v.trim().length > 0 ? undefined : "Refinement is required"),
      });
      if (p.isCancel(refinement)) return null;

      const rspin = p.spinner();
      rspin.start("Refining...");
      try {
        workflow = await refineWorkflow(workflow, refinement as string, { claude, skills, logger: consoleLogger });
        rspin.stop("Refined");
      } catch (err) {
        rspin.stop("Failed");
        p.log.error(`  ${err instanceof Error ? err.message : String(err)}`);
        // Stay in the loop — let them try again
      }
    }
  }
}
