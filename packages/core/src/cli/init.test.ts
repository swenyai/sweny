import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { collectCredentials, detectGitRemote, PROVIDER_CREDENTIALS } from "./init.js";

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
