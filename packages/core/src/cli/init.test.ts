import { describe, it, expect } from "vitest";
import { collectCredentials, PROVIDER_CREDENTIALS } from "./init.js";

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
