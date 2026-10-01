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
import { createHarness } from "../harness/index.js";
import { consoleLogger, type Skill } from "../types.js";
import { configuredSkills } from "../skills/custom-loader.js";
import { builtinSkills } from "../skills/index.js";
import { DagRenderer } from "./renderer.js";
import { runE2eInit } from "./e2e.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface Credential {
  key: string;
  hint?: string;
  url?: string;
  default?: string;
  /** Written commented-out in .env (not needed in every setup). */
  optional?: boolean;
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

// ── Skill → Credential extras ─────────────────────────────────────────

/**
 * Supplementary metadata (URLs, hints, defaults) for env vars.
 * skill.config has description/required but not setup URLs or default values.
 */
export const SKILL_EXTRAS: Record<string, { url?: string; hint?: string; default?: string }> = {
  GITHUB_TOKEN: { url: "https://github.com/settings/tokens", hint: "repo + issues scopes" },
  GITLAB_TOKEN: { url: "https://gitlab.com/-/profile/personal_access_tokens", hint: "api scope" },
  GITLAB_URL: { hint: "e.g. https://gitlab.com", default: "https://gitlab.com" },
  DD_API_KEY: { url: "https://app.datadoghq.com/organization-settings", hint: "Organization Settings > API Keys" },
  DD_APP_KEY: { hint: "Organization Settings > Application Keys" },
  DD_SITE: { hint: "datadoghq.com, datadoghq.eu, etc.", default: "datadoghq.com" },
  SENTRY_AUTH_TOKEN: { url: "https://sentry.io/settings/auth-tokens/" },
  SENTRY_ORG: { hint: "sentry.io/organizations/slug/" },
  BETTERSTACK_API_TOKEN: { url: "https://betterstack.com/docs/logs/api" },
  NR_API_KEY: { url: "https://one.newrelic.com/api-keys" },
  LINEAR_API_KEY: { url: "https://linear.app/settings/api" },
  LINEAR_TEAM_ID: { hint: "Settings > Teams > copy ID from URL" },
  JIRA_BASE_URL: { hint: "e.g. https://your-org.atlassian.net" },
  JIRA_EMAIL: { hint: "your Atlassian account email" },
  JIRA_API_TOKEN: { url: "https://id.atlassian.com/manage-profile/security/api-tokens" },
  SLACK_BOT_TOKEN: { url: "https://api.slack.com/apps" },
  SLACK_WEBHOOK_URL: { hint: "Incoming webhook URL" },
  DISCORD_WEBHOOK_URL: { hint: "Server Settings > Integrations > Webhooks" },
  NOTIFICATION_WEBHOOK_URL: { hint: "Your webhook endpoint URL" },
  TEAMS_WEBHOOK_URL: { hint: "Channel > Connectors > Incoming Webhook" },
  SUPABASE_URL: { hint: "Supabase project URL" },
  SUPABASE_SERVICE_ROLE_KEY: { hint: "Settings > API > service_role key" },
  BETTERSTACK_QUERY_ENDPOINT: { hint: "ClickHouse HTTP endpoint" },
};

/**
 * Static fallback credential map, used when skill objects are unavailable.
 * When availableSkills is provided, collectCredentialsForSkills derives
 * credentials from skill.config instead.
 */
export const SKILL_CREDENTIALS: Record<string, Credential[]> = {
  github: [{ key: "GITHUB_TOKEN", url: "https://github.com/settings/tokens", hint: "repo + issues scopes" }],
  gitlab: [
    { key: "GITLAB_TOKEN", hint: "api scope", url: "https://gitlab.com/-/profile/personal_access_tokens" },
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
    { key: "SENTRY_AUTH_TOKEN", url: "https://sentry.io/settings/auth-tokens/" },
    { key: "SENTRY_ORG", hint: "sentry.io/organizations/slug/" },
  ],
  betterstack: [{ key: "BETTERSTACK_API_TOKEN", url: "https://betterstack.com/docs/logs/api" }],
  newrelic: [{ key: "NR_API_KEY", url: "https://one.newrelic.com/api-keys" }],
  linear: [
    { key: "LINEAR_API_KEY", url: "https://linear.app/settings/api" },
    { key: "LINEAR_TEAM_ID", hint: "Settings > Teams > copy ID from URL" },
  ],
  jira: [
    { key: "JIRA_BASE_URL", hint: "e.g. https://your-org.atlassian.net" },
    { key: "JIRA_EMAIL", hint: "your Atlassian account email" },
    { key: "JIRA_API_TOKEN", url: "https://id.atlassian.com/manage-profile/security/api-tokens" },
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
 *
 * When `availableSkills` is provided, derives credentials from each skill's
 * `.config` fields (works for both builtins and custom skills from Task 01).
 * Falls back to `SKILL_CREDENTIALS` for skills not found in the available set.
 */
export function collectCredentialsForSkills(skillIds: string[], availableSkills?: Skill[]): Credential[] {
  const seen = new Map<string, Credential>();

  for (const cred of ALWAYS_CREDENTIALS) {
    seen.set(cred.key, cred);
  }

  const skillMap = new Map<string, Skill>();
  if (availableSkills) {
    for (const s of availableSkills) skillMap.set(s.id, s);
  }

  for (const id of skillIds) {
    const skill = skillMap.get(id);
    if (skill && Object.keys(skill.config).length > 0) {
      // Derive from skill.config
      for (const [envKey, field] of Object.entries(skill.config)) {
        const key = field.env ?? envKey;
        if (seen.has(key)) continue;
        const extras = SKILL_EXTRAS[key];
        seen.set(key, {
          key,
          hint: extras?.hint ?? field.description,
          url: extras?.url,
          default: extras?.default,
        });
      }
    } else {
      // Fallback to SKILL_CREDENTIALS for unknown skills or skills without config
      const creds = SKILL_CREDENTIALS[id];
      if (!creds) continue;
      for (const cred of creds) {
        if (!seen.has(cred.key)) {
          seen.set(cred.key, cred);
        }
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
export function inferSourceControl(gitInfo: GitRemoteInfo | null): string {
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
export function inferIssueTracker(skills: string[], _sourceControl: string): string {
  if (skills.includes("linear")) return "linear";
  if (skills.includes("jira")) return "jira";
  return "github-issues";
}

/**
 * Infer observability-provider from skills in the workflow.
 */
export function inferObservability(skills: string[]): string | null {
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
    const prefix = cred.optional ? "# " : "";
    if (cred.default !== undefined) {
      lines.push(`${prefix}${cred.key}=${cred.default}`);
    } else {
      lines.push(`${prefix}${cred.key}=`);
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
  // #473: no token on disk for the agents to read; sweny pushes the PR branch itself.
  lines.push("        with:");
  lines.push("          persist-credentials: false");
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

// ── Pure write helpers (exported for marketplace install path) ────────

/** Write .sweny.yml if missing. Returns true if created, false if file existed. */
export function writeSwenyYmlIfMissing(
  cwd: string,
  sourceControl: string,
  observability: string | null,
  issueTracker: string,
): boolean {
  const configPath = path.join(cwd, ".sweny.yml");
  if (fs.existsSync(configPath)) return false;
  fs.writeFileSync(configPath, buildSwenyYml(sourceControl, observability, issueTracker), "utf-8");
  return true;
}

/** Append credential keys to .env that aren't already present. Returns count appended. */
export function appendMissingEnvKeys(cwd: string, credentials: Credential[]): number {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, buildEnvTemplate(credentials), "utf-8");
    return credentials.length;
  }
  const existing = fs.readFileSync(envPath, "utf-8");
  const definedKeys = new Set<string>();
  for (const rawLine of existing.split("\n")) {
    const line = rawLine.trimStart().replace(/^#\s*/, "");
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) definedKeys.add(key);
  }
  const newKeys = credentials.filter((c) => !definedKeys.has(c.key));
  if (newKeys.length === 0) return 0;
  fs.appendFileSync(envPath, "\n" + buildEnvTemplate(newKeys), "utf-8");
  return newKeys.length;
}

/** Write workflow YAML into .sweny/workflows/<id>.yml. Returns info about what happened. */
/** Where a pack's GitHub Actions trigger is written: `.github/workflows/sweny-<pack>.yml`. */
export function packTriggerPath(id: string): string {
  return path.join(".github", "workflows", `sweny-${id}.yml`);
}

/**
 * Write a pack's Actions trigger (#474). Never overwrites: an existing file is
 * left exactly as it is. Returns `skipped` for a template that is not a pack.
 */
export function writePackTrigger(
  cwd: string,
  template: WorkflowTemplate,
): { written: boolean; exists?: boolean; skipped?: boolean; path: string } {
  const target = path.join(cwd, packTriggerPath(template.id));
  if (!template.pack) return { written: false, skipped: true, path: target };
  if (fs.existsSync(target)) return { written: false, exists: true, path: target };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, template.pack.trigger, "utf-8");
  return { written: true, path: target };
}

export function writeWorkflowFile(
  cwd: string,
  id: string,
  yaml: string,
  options?: { overwrite?: boolean },
): { written: boolean; exists?: boolean; path: string } {
  const dir = path.join(cwd, ".sweny", "workflows");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${id}.yml`);
  const overwrite = options?.overwrite ?? false;
  if (fs.existsSync(target) && !overwrite) {
    return { written: false, exists: true, path: target };
  }
  fs.writeFileSync(target, yaml, "utf-8");
  return { written: true, path: target };
}

/**
 * Make sure `line` is in `.gitignore`: create the file if missing, append the
 * line if absent. Returns what happened.
 */
function ensureGitignoreLine(cwd: string, line: string): "created" | "appended" | "present" {
  const gitignorePath = path.join(cwd, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${line}\n`, "utf-8");
    return "created";
  }
  const content = fs.readFileSync(gitignorePath, "utf-8");
  if (content.split(/\r?\n/).some((l) => l.trim() === line)) return "present";
  const sep = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(gitignorePath, `${sep}${line}\n`, "utf-8");
  return "appended";
}

/** Make sure `.env` is gitignored. */
export function ensureGitignoreEnv(cwd: string): "created" | "appended" | "present" {
  return ensureGitignoreLine(cwd, ".env");
}

/** Make sure local run history (`.sweny/runs/`) is gitignored. */
export function ensureGitignoreRuns(cwd: string): "created" | "appended" | "present" {
  return ensureGitignoreLine(cwd, ".sweny/runs/");
}

/** The command to show in next steps: `npx` users have no `sweny` on PATH. */
function cliCommand(): string {
  return process.env.npm_command === "exec" ? "npx @sweny-ai/core" : "sweny";
}

/** Usage printed (exit 2) when `sweny new` has no terminal and no --yes. */
export function nonInteractiveUsage(): string {
  return [
    "sweny new needs a terminal to ask questions. Non-interactive form:",
    "",
    "  sweny new --template <id> --yes",
    "",
    `Templates: ${WORKFLOW_TEMPLATES.map((t) => t.id).join(", ")}`,
    `Zero-credential starter: sweny new --template ${WORKFLOW_TEMPLATES[0].id} --yes`,
  ].join("\n");
}

/** Credentials to list for a workflow: a no-skill starter only needs Claude auth, which a Claude Code login covers. */
function credentialsForWorkflow(skillIds: string[], allSkills: Skill[]): Credential[] {
  const creds = collectCredentialsForSkills(skillIds, allSkills);
  if (skillIds.length > 0) return creds;
  return creds.map((c) =>
    c.key === "ANTHROPIC_API_KEY"
      ? { ...c, optional: true, hint: "Not needed if you are logged in to Claude Code (run `claude` once)" }
      : c,
  );
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
 * 2. Pick one of five branches:
 *    - `__marketplace` → browse published workflows at swenyai/workflows, then delegate to `installMarketplaceWorkflow`
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
export async function runNew(options?: {
  marketplaceId?: string;
  skipIntro?: boolean;
  /** Built-in template id: skip the picker. */
  template?: string;
  /** Skip every confirmation prompt (never overwrites existing files). */
  yes?: boolean;
  /** `false` (`--no-ci`) skips writing a pack's GitHub Actions trigger file. */
  ci?: boolean;
  /** Internal: the id came from the marketplace picker, skip the built-in shortcut. */
  forceMarketplace?: boolean;
}): Promise<void> {
  const cwd = process.cwd();

  // `sweny new <id>`: a built-in template id wins over a marketplace lookup,
  // so it works with no network. Only other ids go to the marketplace.
  if (options?.marketplaceId && options.marketplaceId !== "e2e" && !options.forceMarketplace) {
    if (WORKFLOW_TEMPLATES.some((t) => t.id === options.marketplaceId)) {
      return runNew({
        template: options.marketplaceId,
        skipIntro: options.skipIntro,
        yes: options.yes,
        ci: options.ci,
      });
    }
  }

  if (options?.template && !WORKFLOW_TEMPLATES.some((t) => t.id === options.template)) {
    p.log.error(`Unknown template "${options.template}". Available: ${WORKFLOW_TEMPLATES.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }

  // ── E2E shortcut: `sweny new e2e` jumps straight into the e2e wizard ──
  // `new` is the single entry for all workflow creation; this is a named
  // shortcut into the same flow the interactive picker reaches via "__e2e".
  if (options?.marketplaceId === "e2e") {
    await runE2eInit({ skipIntro: options.skipIntro });
    return;
  }

  // ── Marketplace install fast path ───────────────────────────────────
  if (options?.marketplaceId) {
    const { installMarketplaceWorkflow } = await import("./marketplace.js");
    const allSkills = configuredSkills(process.env, cwd);
    const hasAgent = !!process.env.ANTHROPIC_API_KEY;
    const claude = hasAgent ? createHarness("claude-code", { maxTurns: 3, cwd, logger: consoleLogger }) : null;

    if (!options.skipIntro) p.intro(`Installing ${options.marketplaceId} from marketplace`);

    // Pre-compute source-control from git-remote (same method as the wizard path).
    // Don't pre-compute issue-tracker / observability — those are skill-based,
    // and marketplace.ts infers them after the workflow is fetched.
    const gitInfo = detectGitRemote(cwd);
    const inferredSourceControl = inferSourceControl(gitInfo);

    // Check for existing workflow file and prompt before fetching.
    const existingWorkflowPath = path.join(cwd, ".sweny", "workflows", `${options.marketplaceId}.yml`);
    let overwrite = false;
    if (fs.existsSync(existingWorkflowPath) && options.yes) {
      p.log.info(`Workflow already exists at ${path.relative(cwd, existingWorkflowPath)}. Not overwritten.`);
      return;
    }
    if (fs.existsSync(existingWorkflowPath)) {
      const confirmed = await p.confirm({
        message: `.sweny/workflows/${options.marketplaceId}.yml already exists. Overwrite?`,
        initialValue: false,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        p.log.info(`Workflow already exists at ${path.relative(cwd, existingWorkflowPath)}. Not overwritten.`);
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      overwrite = true;
    }

    let result;
    try {
      result = await installMarketplaceWorkflow(options.marketplaceId, {
        cwd,
        availableSkills: allSkills,
        claude,
        logger: consoleLogger,
        inferredSourceControl,
        overwrite,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      p.log.error(
        `${reason}\nNot a built-in template either. Built-in templates (work offline): ${WORKFLOW_TEMPLATES.map((t) => t.id).join(", ")}`,
      );
      process.exit(1);
    }

    if (!result.installed) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (result.adapted) p.log.success("Adapted workflow for your project");
    if (result.addedEnvKeys > 0) p.log.success(`Appended ${result.addedEnvKeys} key(s) to .env`);
    p.log.success(`Created ${path.relative(cwd, result.workflowPath)}`);
    p.outro("Workflow installed!");
    return;
  }

  // ── Fresh vs existing detection ─────────────────────────────────────
  const configPath = path.join(cwd, ".sweny.yml");
  const hasExistingConfig = fs.existsSync(configPath);

  // ── Intro ───────────────────────────────────────────────────────────
  p.intro(hasExistingConfig ? "Adding a new workflow" : "Let's set up SWEny");

  const gitInfo = detectGitRemote(cwd);
  if (gitInfo && !hasExistingConfig) {
    p.log.info(`Detected: ${chalk.cyan(gitInfo.remote)} (${gitInfo.provider})`);
  }

  // ── Discover all skills (builtins + custom) ────────────────────────
  const allSkills = configuredSkills(process.env, cwd);
  const customSkills = allSkills.filter((s) => !builtinSkills.some((b) => b.id === s.id));
  if (customSkills.length > 0) {
    p.log.info(`Found ${customSkills.length} custom skill(s): ${chalk.cyan(customSkills.map((s) => s.id).join(", "))}`);
  }

  // ── Step 1: Pick a workflow ─────────────────────────────────────────
  // Marketplace is offered only when its index is reachable. Offline or a
  // missing index must never leave the default option broken.
  let marketplaceEntries: Awaited<ReturnType<typeof import("./marketplace.js").fetchMarketplaceIndex>> | null = null;
  let templateChoice: string | symbol;
  if (options?.template) {
    templateChoice = options.template;
  } else {
    try {
      const { fetchMarketplaceIndex } = await import("./marketplace.js");
      const entries = await fetchMarketplaceIndex({ timeoutMs: 3000 });
      if (Array.isArray(entries) && entries.length > 0) marketplaceEntries = entries;
    } catch {
      // No reachable index: built-in templates only, and nothing about a marketplace is shown.
    }

    templateChoice = await p.select({
      message: "What do you want to do?",
      initialValue: WORKFLOW_TEMPLATES[0].id,
      options: [
        ...WORKFLOW_TEMPLATES.map((t) => ({
          value: t.id,
          label: t.name,
          hint: t.description,
        })),
        ...(marketplaceEntries
          ? [
              {
                value: "__marketplace",
                label: "Browse marketplace",
                hint: "install a published workflow from swenyai/workflows",
              },
            ]
          : []),
        { value: "__e2e", label: "End-to-end browser testing", hint: "Automated browser tests for your app" },
        { value: "__custom", label: "Describe your own", hint: "AI-generated from your description" },
        { value: "__blank", label: "Start blank", hint: "just set up config, I'll create workflows later" },
      ],
    });
  }
  if (p.isCancel(templateChoice)) cancel();

  // ── Marketplace short-circuit: pick from the fetched index, delegate ──
  if (templateChoice === "__marketplace" && marketplaceEntries) {
    const pick = await p.select({
      message: "Which workflow?",
      options: marketplaceEntries.map((e) => ({
        value: e.id,
        label: e.name,
        hint: e.description,
      })),
    });
    if (p.isCancel(pick)) cancel();

    // Delegate to the marketplace install path
    // Wizard already showed its intro — skip the fast-path intro to avoid doubling.
    return runNew({ marketplaceId: pick as string, skipIntro: true, forceMarketplace: true });
  }

  // ── E2E short-circuit: delegate to the e2e wizard ────────────────────
  if (templateChoice === "__e2e") {
    await runE2eInit({ skipIntro: true });
    return;
  }

  // ── Step 2: Resolve the chosen workflow ─────────────────────────────
  let template: WorkflowTemplate | undefined;

  if (templateChoice === "__custom") {
    template = (await runCustomWorkflowBuilder(allSkills)) ?? undefined;
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
  const credentials = credentialsForWorkflow(workflowSkills, allSkills);

  // ── Step 3: Summary + confirm ───────────────────────────────────────
  const files: string[] = [];
  if (!hasExistingConfig) files.push(".sweny.yml", ".env");
  if (template) files.push(`.sweny/workflows/${template.id}.yml`);
  const writeTrigger = !!template?.pack && options?.ci !== false;
  if (template && writeTrigger) files.push(packTriggerPath(template.id));

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
  summaryLines.push(chalk.bold(`Credentials: ${credentials.filter((c) => !c.optional).length} required`));
  summaryLines.push(
    ...credentials.map(
      (c) => `  ${chalk.dim(c.key)}${c.optional ? chalk.dim(" (optional with a Claude Code login)") : ""}`,
    ),
  );

  p.log.message(summaryLines.join("\n"));

  if (!options?.yes) {
    const confirmed = await p.confirm({
      message: hasExistingConfig ? "Add this workflow?" : "Create these files?",
      initialValue: true,
    });
    if (p.isCancel(confirmed)) cancel();
    if (!confirmed) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
  }

  // ── Step 4: Write files ─────────────────────────────────────────────

  // 1. Write .sweny.yml (only if fresh)
  if (writeSwenyYmlIfMissing(cwd, sourceControl, observability, issueTracker)) {
    p.log.success("Created .sweny.yml");
  } else {
    p.log.info(".sweny.yml already exists — keeping existing config");
  }

  // 2. Append missing .env keys
  const envExistedBefore = fs.existsSync(path.join(cwd, ".env"));
  const addedCount = appendMissingEnvKeys(cwd, credentials);
  const addedNewKeys = addedCount > 0;
  if (!envExistedBefore) {
    p.log.success("Created .env");
  } else if (addedCount > 0) {
    p.log.success(`Appended ${addedCount} new key(s) to .env`);
  } else {
    p.log.info(".env already contains all required keys — skipped");
  }

  // The pack's Actions trigger (#474): never overwritten, skipped with --no-ci.
  const installTrigger = () => {
    if (!template || !writeTrigger) return;
    const r = writePackTrigger(cwd, template);
    if (r.written) p.log.success(`Created ${packTriggerPath(template.id)}`);
    else if (r.exists) p.log.info(`${packTriggerPath(template.id)} already exists, not overwritten`);
  };

  // 3. Workflow template
  if (template) {
    const firstAttempt = writeWorkflowFile(cwd, template.id, template.yaml, { overwrite: false });
    if (firstAttempt.exists && options?.yes) {
      p.log.info(`.sweny/workflows/${template.id}.yml already exists, not overwritten`);
      installTrigger();
      p.outro("Done.");
      return;
    }
    if (firstAttempt.exists) {
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
      writeWorkflowFile(cwd, template.id, template.yaml, { overwrite: true });
    }
    p.log.success(`Created .sweny/workflows/${template.id}.yml`);
    installTrigger();
  }

  // 4. Keep .env out of version control
  const ignoreResult = ensureGitignoreEnv(cwd);
  if (ignoreResult === "created") p.log.success("Created .gitignore with .env");
  else if (ignoreResult === "appended") p.log.success("Added .env to .gitignore");
  ensureGitignoreRuns(cwd);

  // 5. Next steps
  const requiredCreds = credentials.filter((c) => !c.optional);
  const credUrls = requiredCreds.filter((c) => c.url).map((c) => `  ${c.key}: ${c.url}`);
  const steps: string[] = [];
  let stepNum = 1;
  const cli = cliCommand();

  if (addedNewKeys && requiredCreds.length > 0) {
    steps.push(
      `${stepNum++}. Fill in your API keys in .env:`,
      ...credUrls,
      "",
      `${stepNum++}. Verify connectivity:`,
      `   ${cli} check`,
      "",
    );
  }

  if (template) {
    steps.push(`${stepNum++}. Run your workflow:`, `   ${cli} workflow run .sweny/workflows/${template.id}.yml`);
    if (template.pack && writeTrigger) {
      steps.push(
        "",
        `${stepNum++}. Run it automatically: add the CLAUDE_CODE_OAUTH_TOKEN repo secret, then commit`,
        `   .sweny/workflows/${template.id}.yml and ${packTriggerPath(template.id)}`,
        `   https://docs.sweny.ai/workflows/packs/#${template.id}`,
      );
    } else if (template.pack) {
      steps.push(
        "",
        `${stepNum++}. Run it automatically (GitHub Actions trigger and permissions):`,
        `   https://docs.sweny.ai/workflows/packs/#${template.id}`,
      );
    }
  } else {
    steps.push(`${stepNum++}. Create your first workflow:`, `   ${cli} new`);
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
async function runCustomWorkflowBuilder(skills: Skill[]): Promise<WorkflowTemplate | null> {
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
  const claude = createHarness("claude-code", {
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
