import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import {
  collectCredentials,
  collectCredentialsForSkills,
  extractSkillsFromYaml,
  detectGitRemote,
  buildSwenyYml,
  buildEnvTemplate,
  buildActionWorkflow,
  PROVIDER_CREDENTIALS,
  SKILL_CREDENTIALS,
} from "./init.js";
import type { InitSelections } from "./init.js";

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
    const yml = buildSwenyYml("github", "datadog", "linear");
    expect(yml).toContain("source-control-provider: github");
    expect(yml).toContain("observability-provider: datadog");
    expect(yml).toContain("issue-tracker-provider: linear");
  });

  it("omits observability-provider when null", () => {
    const yml = buildSwenyYml("github", null, "github-issues");
    expect(yml).not.toContain("observability-provider");
  });

  it("includes header comments", () => {
    const yml = buildSwenyYml("github", null, "github-issues");
    expect(yml).toContain("# .sweny.yml");
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
    expect(template).toContain("# https://console.anthropic.com/settings/api-keys");
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
    expect(template).toContain("# .env");
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
    expect(workflow).toContain("swenyai/sweny@v5");
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

// ═══════════════════════════════════════════════════════════════════════
// Additional tests: edge cases, correctness, security
// ═══════════════════════════════════════════════════════════════════════

// ── detectGitRemote: additional edge cases ────────────────────────────

describe("detectGitRemote — edge cases", () => {
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

  it("detects ssh:// scheme GitHub remote", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = ssh://git@github.com/acme/widgets.git
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "github",
      remote: "github.com/acme/widgets",
    });
  });

  it("detects ssh:// scheme GitLab remote", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = ssh://git@gitlab.com/team/project.git
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "gitlab",
      remote: "gitlab.com/team/project",
    });
  });

  it("returns null for ssh:// with unknown host", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = ssh://git@bitbucket.org/acme/widgets.git
`);
    expect(detectGitRemote(cwd)).toBeNull();
  });

  it("handles git config with multiple remotes (uses origin)", () => {
    const cwd = makeTempRepo(`
[remote "upstream"]
\turl = https://gitlab.com/upstream/project.git
[remote "origin"]
\turl = https://github.com/acme/widgets.git
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "github",
      remote: "github.com/acme/widgets",
    });
  });

  it("handles nested org paths (gitlab subgroups)", () => {
    const cwd = makeTempRepo(`
[remote "origin"]
\turl = https://gitlab.com/org/team/subteam/project.git
`);
    const info = detectGitRemote(cwd);
    expect(info).toEqual({
      provider: "gitlab",
      remote: "gitlab.com/org/team/subteam/project",
    });
  });

  it("handles empty git config file", () => {
    const cwd = makeTempRepo("");
    expect(detectGitRemote(cwd)).toBeNull();
  });

  it("handles git config with no origin remote", () => {
    const cwd = makeTempRepo(`
[remote "upstream"]
\turl = https://github.com/acme/widgets.git
`);
    expect(detectGitRemote(cwd)).toBeNull();
  });
});

// ── buildSwenyYml: YAML validity ──────────────────────────────────────

describe("buildSwenyYml — YAML validity", () => {
  it("generates valid YAML that can be parsed", () => {
    const yml = buildSwenyYml("github", "datadog", "linear");
    const parsed = parseYaml(yml);
    expect(parsed["source-control-provider"]).toBe("github");
    expect(parsed["observability-provider"]).toBe("datadog");
    expect(parsed["issue-tracker-provider"]).toBe("linear");
  });

  it("generates valid YAML with minimal selections", () => {
    const yml = buildSwenyYml("github", null, "github-issues");
    const parsed = parseYaml(yml);
    expect(parsed["source-control-provider"]).toBe("github");
    expect(parsed["issue-tracker-provider"]).toBe("github-issues");
    expect(parsed["observability-provider"]).toBeUndefined();
  });

  it("uses correct key names matching config parser expectations", () => {
    const yml = buildSwenyYml("gitlab", "sentry", "jira");
    // These are the exact keys the config parser reads
    expect(yml).toContain("source-control-provider:");
    expect(yml).toContain("observability-provider:");
    expect(yml).toContain("issue-tracker-provider:");
    // Must NOT contain the short form
    expect(yml).not.toMatch(/^source-control:/m);
    expect(yml).not.toMatch(/^issue-tracker:/m);
  });

  it("every provider combination produces valid YAML", () => {
    const sourceControls = ["github", "gitlab"];
    const observabilities = ["datadog", "sentry", "betterstack", "newrelic", "cloudwatch", null];
    const issueTrackers = ["github-issues", "linear", "jira"];

    for (const sc of sourceControls) {
      for (const obs of observabilities) {
        for (const it of issueTrackers) {
          const yml = buildSwenyYml(sc, obs, it);
          // Should not throw
          const parsed = parseYaml(yml);
          expect(parsed["source-control-provider"]).toBe(sc);
        }
      }
    }
  });
});

// ── buildEnvTemplate: correctness ─────────────────────────────────────

describe("buildEnvTemplate — correctness", () => {
  it("every credential has exactly one KEY= line", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "slack",
      githubAction: false,
      cronExpression: null,
    });
    const template = buildEnvTemplate(creds);
    for (const cred of creds) {
      const matches = template.match(new RegExp(`^${cred.key}=`, "gm"));
      expect(matches, `${cred.key} should appear exactly once`).toHaveLength(1);
    }
  });

  it("does not include empty KEY= lines for credentials with defaults", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    const template = buildEnvTemplate(creds);
    // DD_SITE has a default — should be pre-filled, not empty
    expect(template).toContain("DD_SITE=datadoghq.com");
    expect(template).not.toMatch(/^DD_SITE=$/m);
  });

  it("header warns about not committing", () => {
    const template = buildEnvTemplate([]);
    expect(template).toContain("DO NOT COMMIT");
  });

  it("header mentions sweny check", () => {
    const template = buildEnvTemplate([]);
    expect(template).toContain("sweny check");
  });
});

// ── buildActionWorkflow: YAML validity ────────────────────────────────

describe("buildActionWorkflow — YAML validity", () => {
  it("generates valid GitHub Actions YAML", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "console",
      githubAction: true,
      cronExpression: "0 9 * * 1",
    });
    const workflow = buildActionWorkflow(creds, "0 9 * * 1");
    const parsed = parseYaml(workflow);
    expect(parsed.name).toBe("SWEny Triage");
    expect(parsed.on.schedule[0].cron).toBe("0 9 * * 1");
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.jobs.triage["runs-on"]).toBe("ubuntu-latest");
  });

  it("includes with.workflow: triage", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: true,
      cronExpression: "0 9 * * 1",
    });
    const workflow = buildActionWorkflow(creds, "0 9 * * 1");
    expect(workflow).toContain("workflow: triage");
  });

  it("omits env block when all credentials have defaults", () => {
    // Only credentials with defaults — should produce no env block
    const workflow = buildActionWorkflow(
      [
        { key: "DD_SITE", default: "datadoghq.com" },
        { key: "AWS_REGION", default: "us-east-1" },
      ],
      "0 9 * * 1",
    );
    expect(workflow).not.toContain("env:");
  });

  it("generates valid YAML for every provider combination", () => {
    const combos: InitSelections[] = [
      {
        sourceControl: "github",
        observability: "datadog",
        issueTracker: "linear",
        notification: "slack",
        githubAction: true,
        cronExpression: "0 9 * * 1",
      },
      {
        sourceControl: "gitlab",
        observability: "sentry",
        issueTracker: "jira",
        notification: "teams",
        githubAction: true,
        cronExpression: "0 9 * * *",
      },
      {
        sourceControl: "github",
        observability: "cloudwatch",
        issueTracker: "github-issues",
        notification: "discord",
        githubAction: true,
        cronExpression: "0 8 * * 1-5",
      },
      {
        sourceControl: "github",
        observability: null,
        issueTracker: "github-issues",
        notification: "console",
        githubAction: true,
        cronExpression: "0 9 * * 1",
      },
    ];
    for (const sel of combos) {
      const creds = collectCredentials(sel);
      const workflow = buildActionWorkflow(creds, sel.cronExpression!);
      // Should not throw
      const parsed = parseYaml(workflow);
      expect(parsed.name).toBe("SWEny Triage");
      expect(parsed.jobs.triage).toBeDefined();
    }
  });
});

// ── collectCredentials: additional cases ──────────────────────────────

describe("collectCredentials — additional cases", () => {
  it("ANTHROPIC_API_KEY is always first", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "datadog",
      issueTracker: "linear",
      notification: "slack",
      githubAction: false,
      cronExpression: null,
    });
    expect(creds[0].key).toBe("ANTHROPIC_API_KEY");
  });

  it("ANTHROPIC_API_KEY has correct url", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: null,
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    const anthropic = creds.find((c) => c.key === "ANTHROPIC_API_KEY");
    expect(anthropic?.url).toBe("https://console.anthropic.com/settings/api-keys");
  });

  it("handles unknown provider gracefully (custom observability)", () => {
    const creds = collectCredentials({
      sourceControl: "github",
      observability: "splunk",
      issueTracker: "github-issues",
      notification: "console",
      githubAction: false,
      cronExpression: null,
    });
    // Should still have ANTHROPIC_API_KEY + GITHUB_TOKEN, no crash
    const keys = creds.map((c) => c.key);
    expect(keys).toContain("ANTHROPIC_API_KEY");
    expect(keys).toContain("GITHUB_TOKEN");
  });

  it("every provider in PROVIDER_CREDENTIALS has valid credential entries", () => {
    for (const [provider, creds] of Object.entries(PROVIDER_CREDENTIALS)) {
      expect(Array.isArray(creds), `${provider} should have an array`).toBe(true);
      for (const cred of creds) {
        expect(typeof cred.key, `${provider}.${cred.key} should be a string`).toBe("string");
        expect(cred.key.length, `${provider} has an empty key`).toBeGreaterThan(0);
        expect(cred.key, `${provider}.${cred.key} should be UPPER_SNAKE_CASE`).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    }
  });

  it("credential URLs are valid https URLs when present", () => {
    for (const [provider, creds] of Object.entries(PROVIDER_CREDENTIALS)) {
      for (const cred of creds) {
        if (cred.url) {
          expect(cred.url, `${provider}.${cred.key} URL should start with https://`).toMatch(/^https:\/\//);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Workflow-first functions: extractSkillsFromYaml, collectCredentialsForSkills
// ═══════════════════════════════════════════════════════════════════════

describe("extractSkillsFromYaml", () => {
  it("extracts skills from a single node", () => {
    const yaml = `
nodes:
  review:
    name: Code Review
    instruction: Review the PR
    skills: [github]
`;
    expect(extractSkillsFromYaml(yaml)).toEqual(["github"]);
  });

  it("extracts and deduplicates skills from multiple nodes", () => {
    const yaml = `
nodes:
  review:
    name: Code Review
    skills: [github, linear]
  scan:
    name: Security Scan
    skills: [github, sentry]
`;
    const skills = extractSkillsFromYaml(yaml);
    expect(skills).toContain("github");
    expect(skills).toContain("linear");
    expect(skills).toContain("sentry");
    expect(skills.filter((s) => s === "github")).toHaveLength(1);
  });

  it("returns empty array when no skills present", () => {
    const yaml = `
nodes:
  review:
    name: Code Review
    instruction: Review the PR
`;
    expect(extractSkillsFromYaml(yaml)).toEqual([]);
  });

  it("handles skills with spaces around commas", () => {
    const yaml = `
nodes:
  review:
    skills: [github , linear , sentry]
`;
    const skills = extractSkillsFromYaml(yaml);
    expect(skills).toEqual(["github", "linear", "sentry"]);
  });

  it("handles single-skill arrays", () => {
    const yaml = `
nodes:
  review:
    skills: [datadog]
`;
    expect(extractSkillsFromYaml(yaml)).toEqual(["datadog"]);
  });
});

describe("collectCredentialsForSkills", () => {
  it("always includes ANTHROPIC_API_KEY even with no skills", () => {
    const creds = collectCredentialsForSkills([]);
    expect(creds.map((c) => c.key)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("includes credentials for specified skills", () => {
    const creds = collectCredentialsForSkills(["github", "linear"]);
    const keys = creds.map((c) => c.key);
    expect(keys).toContain("ANTHROPIC_API_KEY");
    expect(keys).toContain("GITHUB_TOKEN");
    expect(keys).toContain("LINEAR_API_KEY");
    expect(keys).toContain("LINEAR_TEAM_ID");
  });

  it("deduplicates credentials across skills", () => {
    const creds = collectCredentialsForSkills(["github", "github"]);
    const tokenCount = creds.filter((c) => c.key === "GITHUB_TOKEN").length;
    expect(tokenCount).toBe(1);
  });

  it("skips unknown skills gracefully", () => {
    const creds = collectCredentialsForSkills(["github", "nonexistent-skill"]);
    const keys = creds.map((c) => c.key);
    expect(keys).toContain("ANTHROPIC_API_KEY");
    expect(keys).toContain("GITHUB_TOKEN");
    expect(keys).toHaveLength(2);
  });

  it("ANTHROPIC_API_KEY is always first", () => {
    const creds = collectCredentialsForSkills(["datadog", "github"]);
    expect(creds[0].key).toBe("ANTHROPIC_API_KEY");
  });
});

describe("SKILL_CREDENTIALS", () => {
  it("has entries for all built-in skills", () => {
    const expected = [
      "github",
      "gitlab",
      "datadog",
      "sentry",
      "betterstack",
      "newrelic",
      "linear",
      "jira",
      "slack",
      "discord",
      "notification",
    ];
    for (const skill of expected) {
      expect(SKILL_CREDENTIALS).toHaveProperty(skill);
    }
  });

  it("every skill has valid credential entries", () => {
    for (const [skill, creds] of Object.entries(SKILL_CREDENTIALS)) {
      expect(Array.isArray(creds), `${skill} should have an array`).toBe(true);
      for (const cred of creds) {
        expect(typeof cred.key, `${skill}.${cred.key} should be a string`).toBe("string");
        expect(cred.key, `${skill}.${cred.key} should be UPPER_SNAKE_CASE`).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    }
  });
});
