import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  collectCredentials,
  detectGitRemote,
  buildSwenyYml,
  buildEnvTemplate,
  buildActionWorkflow,
  PROVIDER_CREDENTIALS,
} from "./init.js";

// ── detectGitRemote ────────────────────────────────────────────────────

describe("detectGitRemote", () => {
  const tmpDirs: string[] = [];

  function makeTempRepo(gitConfigContent: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-init-test-"));
    tmpDirs.push(dir);
    const gitDir = path.join(dir, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "config"), gitConfigContent);
    return dir;
  }

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("detects GitHub HTTPS remote", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = https://github.com/acme/widgets.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "github",
      remote: "github.com/acme/widgets",
    });
  });

  it("detects GitHub SSH remote", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = git@github.com:acme/widgets.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "github",
      remote: "github.com/acme/widgets",
    });
  });

  it("detects GitLab HTTPS remote", () => {
    const cwd = makeTempRepo(`
[core]
\tbare = false
[remote "origin"]
\turl = https://gitlab.com/team/project.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "gitlab",
      remote: "gitlab.com/team/project",
    });
  });

  it("returns null when no .git directory exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-init-test-"));
    tmpDirs.push(dir);
    expect(detectGitRemote(dir)).toBeNull();
  });

  it("returns null for unknown host (bitbucket)", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = git@bitbucket.org:acme/widgets.git
`);
    expect(detectGitRemote(cwd)).toBeNull();
  });

  it("handles HTTPS URLs without .git suffix", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = https://github.com/acme/widgets
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "github",
      remote: "github.com/acme/widgets",
    });
  });
});

// ── collectCredentials ─────────────────────────────────────────────────

describe("collectCredentials", () => {
  it("always includes ANTHROPIC_API_KEY", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    expect(creds.map((c) => c.key)).toContain("ANTHROPIC_API_KEY");
  });

  it("includes provider-specific credentials", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "slack",
      githubAction: true,
      cronExpression: "0 8 * * 1",
    });
    const keys = creds.map((c) => c.key);
    expect(keys).toContain("GITHUB_TOKEN");
    expect(keys).toContain("DD_API_KEY");
    expect(keys).toContain("DD_APP_KEY");
    expect(keys).toContain("DD_SITE");
    expect(keys).toContain("LINEAR_API_KEY");
    expect(keys).toContain("LINEAR_TEAM_ID");
    expect(keys).toContain("SLACK_BOT_TOKEN");
  });

  it("deduplicates credentials (github + github-issues)", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    const keys = creds.map((c) => c.key);
    const githubTokenCount = keys.filter((k) => k === "GITHUB_TOKEN").length;
    expect(githubTokenCount).toBe(1);
  });

  it("handles empty credential providers (console, github-issues)", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    expect(creds).toHaveLength(2);
  });
});

// ── PROVIDER_CREDENTIALS table sanity ──────────────────────────────────

describe("PROVIDER_CREDENTIALS", () => {
  it("has entries for all expected providers", () => {
    const expected = [
      "github",
      "gitlab",
      "datadog",
      "sentry",
      "betterstack",
      "newrelic",
      "cloudwatch",
      "github-issues",
      "linear",
      "jira",
      "console",
      "slack",
      "discord",
      "teams",
      "webhook",
    ];
    for (const name of expected) {
      expect(PROVIDER_CREDENTIALS).toHaveProperty(name);
    }
  });

  it("github-issues and console have empty credential arrays", () => {
    expect(PROVIDER_CREDENTIALS["github-issues"]).toEqual([]);
    expect(PROVIDER_CREDENTIALS["console"]).toEqual([]);
  });
});

// ── buildSwenyYml ──────────────────────────────────────────────────────

describe("buildSwenyYml", () => {
  it("includes all selected providers", () => {
    const yml = buildSwenyYml({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "slack",
      githubAction: true,
      cronExpression: "0 8 * * 1",
    });
    expect(yml).toContain("source-control: github");
    expect(yml).toContain("observability-provider: datadog");
    expect(yml).toContain("issue-tracker: linear");
    expect(yml).toContain("notification-provider: slack");
  });

  it("omits observability-provider when null", () => {
    const yml = buildSwenyYml({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "slack",
      githubAction: false,
      cronExpression: null,
    });
    expect(yml).not.toContain("observability-provider");
  });

  it("omits notification-provider when console (default)", () => {
    const yml = buildSwenyYml({
      sourceControl: "github",
      observability: "sentry",
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    expect(yml).not.toContain("notification-provider");
  });

  it("includes header comments", () => {
    const yml = buildSwenyYml({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    expect(yml).toContain("# SWEny configuration");
  });
});

// ── buildEnvTemplate ───────────────────────────────────────────────────

describe("buildEnvTemplate", () => {
  it("includes url and hint comments", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    const template = buildEnvTemplate(creds);
    expect(template).toContain("# https://console.anthropic.com/settings/keys");
    expect(template).toContain("# Claude API key");
    expect(template).toContain("ANTHROPIC_API_KEY=");
    expect(template).toContain("# https://github.com/settings/tokens");
    expect(template).toContain("# repo + issues scopes");
    expect(template).toContain("GITHUB_TOKEN=");
  });

  it("pre-fills defaults", () => {
    const creds = collectCredentials({
      sourceControl: "gitlab",
      observability: "datadog",
      issueTracker: "jira",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    const template = buildEnvTemplate(creds);
    expect(template).toContain("GITLAB_URL=https://gitlab.com");
    expect(template).toContain("DD_SITE=datadoghq.com");
  });

  it("includes header comment", () => {
    const template = buildEnvTemplate([]);
    expect(template).toContain("# SWEny environment variables");
  });
});

// ── buildActionWorkflow ────────────────────────────────────────────────

describe("buildActionWorkflow", () => {
  it("generates a valid workflow with weekly cron", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: true,
      cronExpression: "0 8 * * 1",
    });
    const workflow = buildActionWorkflow(creds, "0 8 * * 1");
    expect(workflow).toContain("name: SWEny Triage");
    expect(workflow).toContain('cron: "0 8 * * 1"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("actions/checkout@v4");
    expect(workflow).toContain("swenyai/sweny@v4");
  });

  it("generates a workflow with daily cron", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "sentry",
      issueTracker: "linear",
      notification: "slack",
      githubAction: true,
      cronExpression: "0 9 * * *",
    });
    const workflow = buildActionWorkflow(creds, "0 9 * * *");
    expect(workflow).toContain('cron: "0 9 * * *"');
  });

  it("skips credentials with defaults from secrets", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "github-issues",
      notification: "console",
      githubAction: true,
      cronExpression: "0 8 * * 1",
    });
    const workflow = buildActionWorkflow(creds, "0 8 * * 1");

    // DD_SITE has a default, so it should NOT appear in secrets
    expect(workflow).not.toContain("secrets.DD_SITE");

    // DD_API_KEY has no default, so it should appear
    expect(workflow).toContain("secrets.DD_API_KEY");
    expect(workflow).toContain("secrets.DD_APP_KEY");
    expect(workflow).toContain("secrets.ANTHROPIC_API_KEY");
    expect(workflow).toContain("secrets.GITHUB_TOKEN");
  });

  it("maps credentials to ${{ secrets.KEY }} format", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "linear",
      notification: "slack",
      githubAction: true,
      cronExpression: "0 8 * * 1",
    });
    const workflow = buildActionWorkflow(creds, "0 8 * * 1");
    expect(workflow).toContain("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}");
    expect(workflow).toContain("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(workflow).toContain("LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}");
    expect(workflow).toContain("SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}");
  });
});
