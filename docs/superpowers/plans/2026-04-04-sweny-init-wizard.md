# `sweny init` Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `sweny init` stub with an interactive 7-screen wizard that writes `.sweny.yml`, `.env` template, and optional GitHub Action workflow.

**Architecture:** A new `init.ts` module with pure file-generation functions + a thin `@clack/prompts` interactive layer. The existing Commander stub in `main.ts` delegates to `runInit()`. Tests cover all pure functions; the interactive glue is not unit-tested.

**Tech Stack:** `@clack/prompts`, `yaml` (already dep), `vitest` (existing test framework), Commander.js (existing CLI)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/cli/init.ts` | Create | Credential table, git detection, file generators, wizard flow |
| `packages/core/src/cli/init.test.ts` | Create | Tests for `detectGitRemote`, `buildSwenyYml`, `buildEnvTemplate`, `buildActionWorkflow` |
| `packages/core/src/cli/main.ts` | Modify lines 85-98 | Replace sync stub with async `runInit()` call |
| `packages/core/package.json` | Modify | Add `@clack/prompts` to dependencies |

---

### Task 1: Add `@clack/prompts` dependency

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd /Users/nate/src/swenyai/sweny && npm install @clack/prompts --workspace=packages/core
```

- [ ] **Step 2: Verify it was added to package.json**

Run: `grep clack packages/core/package.json`
Expected: `"@clack/prompts": "^0.x.x"` in dependencies

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json package-lock.json
git commit -m "chore: add @clack/prompts dependency for init wizard"
```

---

### Task 2: Credential table and types

**Files:**
- Create: `packages/core/src/cli/init.ts`

This task creates the module with the `Credential` interface, the `PROVIDER_CREDENTIALS` lookup table, and the `InitSelections` interface that flows through the wizard. No interactive code yet — just the data layer.

- [ ] **Step 1: Create init.ts with types and credential table**

```ts
/**
 * sweny init — Interactive setup wizard
 *
 * Pure functions for file generation + thin @clack/prompts interactive layer.
 * Tests cover the pure functions; the interactive wizard is thin glue.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────

export interface Credential {
  key: string;
  hint?: string;
  url?: string;
  default?: string;
}

export interface InitSelections {
  sourceControl: string;
  observability: string | null; // null = skipped
  issueTracker: string;
  notification: string;
  githubAction: boolean;
  cronExpression: string | null; // null = no action
}

// ─── Credential Mapping ─────────────────────────────────────────────

const ALWAYS_CREDENTIALS: Credential[] = [
  {
    key: "ANTHROPIC_API_KEY",
    hint: "Claude API key",
    url: "https://console.anthropic.com/settings/api-keys",
  },
];

export const PROVIDER_CREDENTIALS: Record<string, Credential[]> = {
  // Source control
  github: [
    { key: "GITHUB_TOKEN", hint: "repo + issues scopes", url: "https://github.com/settings/tokens" },
  ],
  gitlab: [
    { key: "GITLAB_TOKEN", hint: "api scope", url: "https://gitlab.com/-/profile/personal_access_tokens" },
    { key: "GITLAB_URL", hint: "e.g. https://gitlab.com", default: "https://gitlab.com" },
  ],
  // Observability
  datadog: [
    { key: "DD_API_KEY", hint: "Organization Settings > API Keys", url: "https://app.datadoghq.com/organization-settings" },
    { key: "DD_APP_KEY", hint: "Organization Settings > Application Keys" },
    { key: "DD_SITE", hint: "datadoghq.com, datadoghq.eu, etc.", default: "datadoghq.com" },
  ],
  sentry: [
    { key: "SENTRY_AUTH_TOKEN", url: "https://sentry.io/settings/auth-tokens/" },
    { key: "SENTRY_ORG", hint: "sentry.io/organizations/<slug>/" },
  ],
  betterstack: [
    { key: "BETTERSTACK_API_TOKEN", url: "https://betterstack.com/docs/logs/api" },
  ],
  newrelic: [
    { key: "NR_API_KEY", url: "https://one.newrelic.com/api-keys" },
  ],
  cloudwatch: [
    { key: "AWS_ACCESS_KEY_ID", hint: "IAM user access key" },
    { key: "AWS_SECRET_ACCESS_KEY", hint: "IAM user secret key" },
    { key: "AWS_REGION", hint: "e.g. us-east-1", default: "us-east-1" },
  ],
  // Issue trackers
  "github-issues": [], // uses GITHUB_TOKEN from source control
  linear: [
    { key: "LINEAR_API_KEY", url: "https://linear.app/settings/api" },
    { key: "LINEAR_TEAM_ID", hint: "Settings > Teams > copy ID from URL" },
  ],
  jira: [
    { key: "JIRA_BASE_URL", hint: "e.g. https://your-org.atlassian.net" },
    { key: "JIRA_EMAIL", hint: "your Atlassian account email" },
    { key: "JIRA_API_TOKEN", url: "https://id.atlassian.com/manage-profile/security/api-tokens" },
  ],
  // Notification
  console: [],
  slack: [
    { key: "SLACK_BOT_TOKEN", url: "https://api.slack.com/apps" },
  ],
  discord: [
    { key: "DISCORD_WEBHOOK_URL", hint: "Server Settings > Integrations > Webhooks" },
  ],
  teams: [
    { key: "TEAMS_WEBHOOK_URL", hint: "Channel > Connectors > Incoming Webhook" },
  ],
  webhook: [
    { key: "NOTIFICATION_WEBHOOK_URL", hint: "Your webhook endpoint URL" },
  ],
};

/**
 * Collect all unique credentials for the selected providers.
 * Always includes ANTHROPIC_API_KEY. Deduplicates by key name
 * (e.g., GITHUB_TOKEN used by both github source control and github-issues).
 */
export function collectCredentials(selections: InitSelections): Credential[] {
  const providers = [
    selections.sourceControl,
    selections.observability,
    selections.issueTracker,
    selections.notification,
  ].filter((p): p is string => p != null);

  const seen = new Set<string>();
  const result: Credential[] = [];

  for (const cred of ALWAYS_CREDENTIALS) {
    seen.add(cred.key);
    result.push(cred);
  }

  for (const provider of providers) {
    const creds = PROVIDER_CREDENTIALS[provider] ?? [];
    for (const cred of creds) {
      if (!seen.has(cred.key)) {
        seen.add(cred.key);
        result.push(cred);
      }
    }
  }

  return result;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx tsc --noEmit src/cli/init.ts`
Expected: No errors (may warn about unused exports — that's fine)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/cli/init.ts
git commit -m "feat(init): add credential table and types for init wizard"
```

---

### Task 3: Git remote detection

**Files:**
- Modify: `packages/core/src/cli/init.ts`
- Create: `packages/core/src/cli/init.test.ts`

- [ ] **Step 1: Write failing tests for detectGitRemote**

Create `packages/core/src/cli/init.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectGitRemote } from "./init.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("detectGitRemote", () => {
  function makeTmpGit(configContent: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-init-test-"));
    const gitDir = path.join(dir, ".git");
    fs.mkdirSync(gitDir);
    fs.writeFileSync(path.join(gitDir, "config"), configContent);
    return dir;
  }

  it("detects GitHub HTTPS remote", () => {
    const dir = makeTmpGit(`[remote "origin"]\n\turl = https://github.com/acme/my-app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*`);
    const result = detectGitRemote(dir);
    expect(result).toEqual({ provider: "github", remote: "github.com/acme/my-app" });
  });

  it("detects GitHub SSH remote", () => {
    const dir = makeTmpGit(`[remote "origin"]\n\turl = git@github.com:acme/my-app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*`);
    const result = detectGitRemote(dir);
    expect(result).toEqual({ provider: "github", remote: "github.com/acme/my-app" });
  });

  it("detects GitLab HTTPS remote", () => {
    const dir = makeTmpGit(`[remote "origin"]\n\turl = https://gitlab.com/acme/my-app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*`);
    const result = detectGitRemote(dir);
    expect(result).toEqual({ provider: "gitlab", remote: "gitlab.com/acme/my-app" });
  });

  it("returns null when no .git directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-init-test-"));
    const result = detectGitRemote(dir);
    expect(result).toBeNull();
  });

  it("returns null for unknown remote host", () => {
    const dir = makeTmpGit(`[remote "origin"]\n\turl = https://bitbucket.org/acme/my-app.git`);
    const result = detectGitRemote(dir);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: FAIL — `detectGitRemote` is not exported

- [ ] **Step 3: Implement detectGitRemote**

Add to `packages/core/src/cli/init.ts`, after the `collectCredentials` function:

```ts
// ─── Git Remote Detection ───────────────────────────────────────────

export interface GitRemoteInfo {
  provider: "github" | "gitlab";
  remote: string; // e.g. "github.com/acme/my-app"
}

/**
 * Parse .git/config for the origin remote URL.
 * Returns provider + cleaned remote string, or null if not detected.
 */
export function detectGitRemote(cwd: string): GitRemoteInfo | null {
  const configPath = path.join(cwd, ".git", "config");
  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }

  // Match: url = <anything> under [remote "origin"]
  const originMatch = content.match(/\[remote "origin"\]\s*\n(?:\t[^\n]*\n)*?\turl\s*=\s*(.+)/);
  if (!originMatch) return null;

  const url = originMatch[1].trim();

  // HTTPS: https://github.com/owner/repo.git
  // SSH:   git@github.com:owner/repo.git
  const httpsMatch = url.match(/https?:\/\/(github\.com|gitlab\.com)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    const repoPath = httpsMatch[2];
    return {
      provider: host === "github.com" ? "github" : "gitlab",
      remote: `${host}/${repoPath}`,
    };
  }

  const sshMatch = url.match(/git@(github\.com|gitlab\.com):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const repoPath = sshMatch[2];
    return {
      provider: host === "github.com" ? "github" : "gitlab",
      remote: `${host}/${repoPath}`,
    };
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/init.ts packages/core/src/cli/init.test.ts
git commit -m "feat(init): add git remote detection with tests"
```

---

### Task 4: buildSwenyYml

**Files:**
- Modify: `packages/core/src/cli/init.ts`
- Modify: `packages/core/src/cli/init.test.ts`

- [ ] **Step 1: Write failing tests for buildSwenyYml**

Append to `packages/core/src/cli/init.test.ts`:

```ts
import { buildSwenyYml } from "./init.js";
// (add to existing import if detectGitRemote import already present)

describe("buildSwenyYml", () => {
  it("generates YAML with all providers", () => {
    const yml = buildSwenyYml({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "slack",
      githubAction: false,
      cronExpression: null,
    });
    expect(yml).toContain("source-control-provider: github");
    expect(yml).toContain("observability-provider: datadog");
    expect(yml).toContain("issue-tracker-provider: linear");
    expect(yml).toContain("notification-provider: slack");
    expect(yml).toContain("# .sweny.yml");
  });

  it("omits observability when null", () => {
    const yml = buildSwenyYml({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    expect(yml).not.toContain("observability-provider");
    expect(yml).toContain("source-control-provider: github");
  });

  it("omits notification when console (default)", () => {
    const yml = buildSwenyYml({
      sourceControl: "github",
      observability: "sentry",
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    // console is the default so no need to write it
    expect(yml).not.toContain("notification-provider");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: FAIL — `buildSwenyYml` is not exported

- [ ] **Step 3: Implement buildSwenyYml**

Add to `packages/core/src/cli/init.ts`:

```ts
// ─── File Generators ────────────────────────────────────────────────

/**
 * Generate a clean .sweny.yml from user selections.
 * Only includes lines for selected providers — no commented-out options.
 */
export function buildSwenyYml(selections: InitSelections): string {
  const lines: string[] = [
    "# .sweny.yml — SWEny project configuration",
    "# Secrets (API keys, tokens) go in .env (gitignored).",
    "# Docs: https://docs.sweny.ai/cli",
    "",
  ];

  lines.push(`source-control-provider: ${selections.sourceControl}`);

  if (selections.observability) {
    lines.push(`observability-provider: ${selections.observability}`);
  }

  lines.push(`issue-tracker-provider: ${selections.issueTracker}`);

  // Console is the default — omit it to keep the file minimal
  if (selections.notification !== "console") {
    lines.push(`notification-provider: ${selections.notification}`);
  }

  lines.push(""); // trailing newline
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/init.ts packages/core/src/cli/init.test.ts
git commit -m "feat(init): add buildSwenyYml file generator with tests"
```

---

### Task 5: buildEnvTemplate

**Files:**
- Modify: `packages/core/src/cli/init.ts`
- Modify: `packages/core/src/cli/init.test.ts`

- [ ] **Step 1: Write failing tests for buildEnvTemplate**

Append to `packages/core/src/cli/init.test.ts`:

```ts
import { buildEnvTemplate, collectCredentials } from "./init.js";

describe("buildEnvTemplate", () => {
  it("always includes ANTHROPIC_API_KEY", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    const env = buildEnvTemplate(creds);
    expect(env).toContain("ANTHROPIC_API_KEY=");
    expect(env).toContain("console.anthropic.com");
  });

  it("includes provider-specific credentials", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "slack",
      githubAction: false,
      cronExpression: null,
    });
    const env = buildEnvTemplate(creds);
    expect(env).toContain("GITHUB_TOKEN=");
    expect(env).toContain("DD_API_KEY=");
    expect(env).toContain("DD_APP_KEY=");
    expect(env).toContain("DD_SITE=datadoghq.com"); // default pre-filled
    expect(env).toContain("LINEAR_API_KEY=");
    expect(env).toContain("SLACK_BOT_TOKEN=");
  });

  it("deduplicates credentials (github source + github-issues)", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    const env = buildEnvTemplate(creds);
    const matches = env.match(/GITHUB_TOKEN=/g);
    expect(matches).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: FAIL — `buildEnvTemplate` is not exported

- [ ] **Step 3: Implement buildEnvTemplate**

Add to `packages/core/src/cli/init.ts`:

```ts
/**
 * Generate a .env template from collected credentials.
 * Each credential gets a KEY=value line. Defaults are pre-filled;
 * secrets are left empty. Grouped with section headers.
 */
export function buildEnvTemplate(credentials: Credential[]): string {
  const lines: string[] = [
    "# .env — SWEny credentials (DO NOT COMMIT)",
    "# Fill in each value, then run: sweny check",
    "",
  ];

  for (const cred of credentials) {
    if (cred.url) {
      lines.push(`# ${cred.url}`);
    }
    if (cred.hint) {
      lines.push(`# ${cred.hint}`);
    }
    lines.push(`${cred.key}=${cred.default ?? ""}`);
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/init.ts packages/core/src/cli/init.test.ts
git commit -m "feat(init): add buildEnvTemplate file generator with tests"
```

---

### Task 6: buildActionWorkflow

**Files:**
- Modify: `packages/core/src/cli/init.ts`
- Modify: `packages/core/src/cli/init.test.ts`

- [ ] **Step 1: Write failing tests for buildActionWorkflow**

Append to `packages/core/src/cli/init.test.ts`:

```ts
import { buildActionWorkflow } from "./init.js";

describe("buildActionWorkflow", () => {
  it("generates workflow with weekly cron", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "console",
      githubAction: true,
      cronExpression: "0 9 * * 1",
    });
    const yml = buildActionWorkflow(creds, "0 9 * * 1");
    expect(yml).toContain('cron: "0 9 * * 1"');
    expect(yml).toContain("workflow_dispatch");
    expect(yml).toContain("swenyai/sweny@v4");
    expect(yml).toContain("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}");
    expect(yml).toContain("DD_API_KEY: ${{ secrets.DD_API_KEY }}");
    expect(yml).toContain("LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}");
  });

  it("generates workflow with daily cron", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "sentry",
      issueTracker: "github-issues",
      notification: "console",
      githubAction: true,
      cronExpression: "0 9 * * *",
    });
    const yml = buildActionWorkflow(creds, "0 9 * * *");
    expect(yml).toContain('cron: "0 9 * * *"');
    expect(yml).toContain("SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}");
    // github-issues uses GITHUB_TOKEN which is auto-available in Actions
    expect(yml).toContain("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  });

  it("skips credentials with defaults from secrets (DD_SITE is not a secret)", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "github-issues",
      notification: "console",
      githubAction: true,
      cronExpression: "0 9 * * 1",
    });
    const yml = buildActionWorkflow(creds, "0 9 * * 1");
    // DD_SITE has a default value — it's not a secret
    expect(yml).not.toContain("DD_SITE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: FAIL — `buildActionWorkflow` is not exported

- [ ] **Step 3: Implement buildActionWorkflow**

Add to `packages/core/src/cli/init.ts`:

```ts
/**
 * Generate a GitHub Actions workflow YAML for SWEny triage.
 * Only includes secrets for credentials that don't have defaults
 * (credentials with defaults like DD_SITE are config, not secrets).
 */
export function buildActionWorkflow(credentials: Credential[], cronExpression: string): string {
  // Only include credentials without defaults as secrets
  const secrets = credentials.filter((c) => !c.default);

  const envLines = secrets.map((c) => `          ${c.key}: \${{ secrets.${c.key} }}`).join("\n");

  return `name: SWEny Triage
on:
  schedule:
    - cron: "${cronExpression}"
  workflow_dispatch:

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v4
        with:
          workflow: triage
        env:
${envLines}
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/cli/init.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/init.ts packages/core/src/cli/init.test.ts
git commit -m "feat(init): add buildActionWorkflow file generator with tests"
```

---

### Task 7: Interactive wizard (runInit)

**Files:**
- Modify: `packages/core/src/cli/init.ts`

This task adds the interactive wizard function that ties everything together. It uses `@clack/prompts` for the TUI and calls the pure functions from Tasks 2-6 to generate file content.

- [ ] **Step 1: Add the runInit function**

Add the following to the end of `packages/core/src/cli/init.ts`:

```ts
import * as p from "@clack/prompts";
import chalk from "chalk";

// ─── Interactive Wizard ─────────────────────────────────────────────

/**
 * Run the interactive init wizard.
 * Collects provider selections, shows summary, writes files.
 */
export async function runInit(): Promise<void> {
  const cwd = process.cwd();

  p.intro("Let's set up SWEny");

  // Auto-detect git remote
  const gitInfo = detectGitRemote(cwd);
  if (gitInfo) {
    p.log.info(`Git remote detected: ${gitInfo.remote}`);
  }

  // Check for existing .sweny.yml
  const swenyYmlPath = path.join(cwd, ".sweny.yml");
  if (fs.existsSync(swenyYmlPath)) {
    const overwrite = await p.confirm({
      message: ".sweny.yml already exists. Overwrite?",
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
  }

  // Screen 1: Source control
  const sourceControl = await p.select({
    message: "Source control provider",
    options: [
      { value: "github", label: "GitHub", hint: gitInfo?.provider === "github" ? "detected" : undefined },
      { value: "gitlab", label: "GitLab", hint: gitInfo?.provider === "gitlab" ? "detected" : undefined },
    ],
    initialValue: gitInfo?.provider ?? "github",
  });
  if (p.isCancel(sourceControl)) { p.cancel("Setup cancelled."); process.exit(0); }

  // Screen 2: Observability
  const obsChoice = await p.select({
    message: "Observability provider",
    options: [
      { value: "datadog", label: "Datadog" },
      { value: "sentry", label: "Sentry" },
      { value: "betterstack", label: "BetterStack" },
      { value: "newrelic", label: "New Relic" },
      { value: "cloudwatch", label: "CloudWatch" },
      { value: "__other", label: "Other" },
      { value: "__none", label: "None / skip" },
    ],
  });
  if (p.isCancel(obsChoice)) { p.cancel("Setup cancelled."); process.exit(0); }

  let observability: string | null = null;
  if (obsChoice === "__other") {
    const custom = await p.text({
      message: "Enter observability provider name",
      placeholder: "e.g. splunk, elastic, loki",
    });
    if (p.isCancel(custom)) { p.cancel("Setup cancelled."); process.exit(0); }
    observability = custom as string;
  } else if (obsChoice !== "__none") {
    observability = obsChoice as string;
  }

  // Screen 3: Issue tracker
  const issueTracker = await p.select({
    message: "Issue tracker",
    options: [
      { value: "github-issues", label: "GitHub Issues", hint: sourceControl === "github" ? "matches source control" : undefined },
      { value: "linear", label: "Linear" },
      { value: "jira", label: "Jira" },
    ],
    initialValue: sourceControl === "github" ? "github-issues" : undefined,
  });
  if (p.isCancel(issueTracker)) { p.cancel("Setup cancelled."); process.exit(0); }

  // Screen 4: Notification
  const notification = await p.select({
    message: "Where should SWEny send results?",
    options: [
      { value: "console", label: "Console", hint: "default" },
      { value: "slack", label: "Slack" },
      { value: "discord", label: "Discord" },
      { value: "teams", label: "Teams" },
      { value: "webhook", label: "Webhook" },
    ],
    initialValue: "console",
  });
  if (p.isCancel(notification)) { p.cancel("Setup cancelled."); process.exit(0); }

  // Screen 5: GitHub Action
  let githubAction = false;
  let cronExpression: string | null = null;

  const wantAction = await p.confirm({
    message: "Set up a GitHub Action workflow?",
  });
  if (p.isCancel(wantAction)) { p.cancel("Setup cancelled."); process.exit(0); }

  if (wantAction) {
    githubAction = true;
    const schedule = await p.select({
      message: "Run schedule",
      options: [
        { value: "0 9 * * *", label: "Daily (9am UTC)" },
        { value: "0 9 * * 1", label: "Weekly (Monday 9am UTC)" },
        { value: "__custom", label: "Custom cron expression" },
      ],
    });
    if (p.isCancel(schedule)) { p.cancel("Setup cancelled."); process.exit(0); }

    if (schedule === "__custom") {
      const custom = await p.text({
        message: "Cron expression",
        placeholder: "0 9 * * 1-5",
      });
      if (p.isCancel(custom)) { p.cancel("Setup cancelled."); process.exit(0); }
      cronExpression = custom as string;
    } else {
      cronExpression = schedule as string;
    }
  }

  const selections: InitSelections = {
    sourceControl: sourceControl as string,
    observability,
    issueTracker: issueTracker as string,
    notification: notification as string,
    githubAction,
    cronExpression,
  };

  // Screen 6: Summary
  p.log.message(
    [
      "",
      chalk.bold("  .sweny.yml"),
      `    source-control: ${selections.sourceControl}`,
      selections.observability ? `    observability:  ${selections.observability}` : null,
      `    issue-tracker:  ${selections.issueTracker}`,
      selections.notification !== "console" ? `    notification:   ${selections.notification}` : null,
      "",
      chalk.bold("  .env") + chalk.dim("  (credential template)"),
      "",
      githubAction ? chalk.bold("  .github/workflows/sweny.yml") : null,
      cronExpression ? `    cron: ${cronExpression}` : null,
    ]
      .filter((l) => l != null)
      .join("\n"),
  );

  const confirmed = await p.confirm({ message: "Create these files?" });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Screen 7: Write files
  const credentials = collectCredentials(selections);

  // Write .sweny.yml
  fs.writeFileSync(swenyYmlPath, buildSwenyYml(selections), "utf-8");
  p.log.success("Created .sweny.yml");

  // Write .env (append if exists)
  const envPath = path.join(cwd, ".env");
  const envContent = buildEnvTemplate(credentials);
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf-8");
    // Only append credentials not already present
    const newLines = envContent
      .split("\n")
      .filter((line) => {
        const keyMatch = line.match(/^([A-Z_]+)=/);
        return !keyMatch || !existing.includes(keyMatch[1] + "=");
      })
      .join("\n");
    if (newLines.trim()) {
      fs.appendFileSync(envPath, "\n" + newLines, "utf-8");
      p.log.success("Updated .env (appended new credentials)");
    } else {
      p.log.info(".env already has all required credentials");
    }
  } else {
    fs.writeFileSync(envPath, envContent, "utf-8");
    p.log.success("Created .env");
  }

  // Write GitHub Action workflow
  if (githubAction && cronExpression) {
    const workflowDir = path.join(cwd, ".github", "workflows");
    const workflowPath = path.join(workflowDir, "sweny.yml");

    let shouldWrite = true;
    if (fs.existsSync(workflowPath)) {
      const overwrite = await p.confirm({ message: ".github/workflows/sweny.yml already exists. Overwrite?" });
      shouldWrite = !p.isCancel(overwrite) && !!overwrite;
    }

    if (shouldWrite) {
      fs.mkdirSync(workflowDir, { recursive: true });
      fs.writeFileSync(workflowPath, buildActionWorkflow(credentials, cronExpression), "utf-8");
      p.log.success("Created .github/workflows/sweny.yml");
    }
  }

  // Check .gitignore for .env
  const gitignorePath = path.join(cwd, ".gitignore");
  let envIgnored = false;
  try {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    envIgnored = gitignore.split("\n").some((line) => line.trim() === ".env");
  } catch {
    // no .gitignore
  }
  if (!envIgnored) {
    p.log.warn(".env is not in .gitignore — add it to avoid leaking secrets");
  }

  // Next steps
  const docUrls = credentials
    .filter((c) => c.url)
    .map((c) => `  ${c.key}: ${c.url}`)
    .join("\n");

  p.note(
    [
      "1. Fill in your API keys in .env",
      docUrls ? `\n${docUrls}\n` : "",
      "2. sweny check          (verify connectivity)",
      "3. sweny triage --dry-run  (test run)",
    ].join("\n"),
    "Next steps",
  );

  p.outro("You're all set!");
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/cli/init.ts
git commit -m "feat(init): add interactive wizard flow using @clack/prompts"
```

---

### Task 8: Wire up main.ts

**Files:**
- Modify: `packages/core/src/cli/main.ts:85-98`

- [ ] **Step 1: Replace the init stub in main.ts**

In `packages/core/src/cli/main.ts`, find this block (lines 85-98):

```ts
// ── sweny init ────────────────────────────────────────────────────────
program
  .command("init")
  .description("Create a starter .sweny.yml config file")
  .action(() => {
    const target = path.join(process.cwd(), ".sweny.yml");
    if (fs.existsSync(target)) {
      console.error(chalk.yellow("  .sweny.yml already exists — skipping."));
      process.exit(1);
    }
    fs.writeFileSync(target, STARTER_CONFIG, "utf-8");
    console.log(chalk.green("  Created .sweny.yml"));
    console.log(chalk.dim("  Add your secrets to .env and run: sweny triage --dry-run"));
  });
```

Replace with:

```ts
// ── sweny init ────────────────────────────────────────────────────────
import { runInit } from "./init.js";

program
  .command("init")
  .description("Interactive setup wizard — creates .sweny.yml, .env template, and optional GitHub Action")
  .action(async () => {
    await runInit();
  });
```

Also remove `STARTER_CONFIG` from the import on the existing import line (line 31) if it becomes unused. The import line:

```ts
import { loadDotenv, loadConfigFile, STARTER_CONFIG } from "./config-file.js";
```

becomes:

```ts
import { loadDotenv, loadConfigFile } from "./config-file.js";
```

Check if `STARTER_CONFIG` is used anywhere else in `main.ts` before removing. If not used elsewhere, remove it from the import.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all existing tests to verify nothing broke**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run`
Expected: All tests PASS (including the new init tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/cli/main.ts packages/core/src/cli/init.ts
git commit -m "feat(init): wire up interactive wizard, replace static stub"
```

---

### Task 9: Build and verify end-to-end

**Files:**
- None new — verification only

- [ ] **Step 1: Build the package**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npm run build`
Expected: Clean build, no errors

- [ ] **Step 2: Run all tests across the monorepo**

Run: `cd /Users/nate/src/swenyai/sweny && npm test`
Expected: All tests pass

- [ ] **Step 3: Typecheck**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Smoke-test the CLI**

Run: `cd /tmp && mkdir sweny-init-test && cd sweny-init-test && git init && git remote add origin git@github.com:test/test.git && node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js init`

Expected: The wizard starts, shows "Let's set up SWEny", detects GitHub remote. Press Ctrl+C to exit without writing files.

- [ ] **Step 5: Commit any fixes**

If the smoke test revealed issues, fix them and commit:

```bash
git add -A
git commit -m "fix(init): address smoke test findings"
```
