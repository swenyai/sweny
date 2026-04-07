import { describe, it, expect } from "vitest";
import { buildCredentialMap } from "./credentials.js";
import { buildSkillMcpServers } from "../mcp.js";

// ─────────────────────────────────────────────────────────────────────
// Integration tests: env vars → buildCredentialMap → buildSkillMcpServers
// ─────────────────────────────────────────────────────────────────────
//
// These tests catch env-var name drift between:
//   - the user-facing env var name (what docs / init.ts / config.ts read)
//   - the canonical key the MCP wiring functions look up
//
// Unit tests in mcp.test.ts inject the credentials map directly. That
// validates each MCP wiring path but cannot catch a buildCredentialMap
// that puts the value under the wrong key. THESE tests close that gap
// by going through the real env-var → canonical-key translation.
//
// If a future contributor renames an env var and forgets to update both
// sides, one of these will fail loudly.

describe("buildCredentialMap ↔ buildSkillMcpServers integration", () => {
  // ── New Relic: NR_API_KEY user-facing → NEW_RELIC_API_KEY canonical ──

  it("user setting NR_API_KEY auto-wires the New Relic MCP", () => {
    const creds = buildCredentialMap({ NR_API_KEY: "NRAK-abc" });
    expect(creds.NEW_RELIC_API_KEY).toBe("NRAK-abc");

    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["newrelic"]),
      credentials: creds,
    });
    expect(mcps.newrelic).toBeDefined();
    expect(mcps.newrelic?.url).toBe("https://mcp.newrelic.com/mcp/");
  });

  it("user setting NR_REGION=eu picks the EU New Relic endpoint", () => {
    const creds = buildCredentialMap({ NR_API_KEY: "NRAK-abc", NR_REGION: "eu" });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["newrelic"]),
      credentials: creds,
    });
    expect(mcps.newrelic?.url).toBe("https://mcp.eu.newrelic.com/mcp/");
  });

  it("user setting NEW_RELIC_API_KEY (canonical name) also works", () => {
    const creds = buildCredentialMap({ NEW_RELIC_API_KEY: "NRAK-xyz" });
    expect(creds.NEW_RELIC_API_KEY).toBe("NRAK-xyz");
  });

  // ── Sentry: SENTRY_BASE_URL user-facing → SENTRY_URL canonical ──

  it("user setting SENTRY_BASE_URL for self-hosted reaches the MCP layer", () => {
    const creds = buildCredentialMap({
      SENTRY_AUTH_TOKEN: "sntrys_abc",
      SENTRY_BASE_URL: "https://sentry.acme.com",
    });
    expect(creds.SENTRY_URL).toBe("https://sentry.acme.com");

    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["sentry"]),
      credentials: creds,
    });
    expect(mcps.sentry).toBeDefined();
    expect(mcps.sentry?.env?.SENTRY_HOST).toBe("sentry.acme.com");
  });

  it("user setting SENTRY_URL (canonical name) also reaches MCP layer", () => {
    const creds = buildCredentialMap({
      SENTRY_AUTH_TOKEN: "sntrys_abc",
      SENTRY_URL: "https://sentry.acme.com",
    });
    expect(creds.SENTRY_URL).toBe("https://sentry.acme.com");
  });

  it("default sentry.io URL does not set SENTRY_HOST", () => {
    const creds = buildCredentialMap({ SENTRY_AUTH_TOKEN: "sntrys_abc" });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["sentry"]),
      credentials: creds,
    });
    expect(mcps.sentry).toBeDefined();
    expect(mcps.sentry?.env?.SENTRY_HOST).toBeUndefined();
  });

  // ── Jira: JIRA_BASE_URL user-facing → JIRA_URL canonical ──

  it("user setting JIRA_BASE_URL auto-wires the Jira MCP", () => {
    const creds = buildCredentialMap({
      JIRA_BASE_URL: "https://acme.atlassian.net",
      JIRA_EMAIL: "alice@acme.com",
      JIRA_API_TOKEN: "tok_abc",
    });
    expect(creds.JIRA_URL).toBe("https://acme.atlassian.net");

    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["jira"]),
      credentials: creds,
    });
    expect(mcps.jira).toBeDefined();
    expect(mcps.jira?.env?.JIRA_URL).toBe("https://acme.atlassian.net");
  });

  it("user setting JIRA_URL (canonical name) also auto-wires Jira", () => {
    const creds = buildCredentialMap({
      JIRA_URL: "https://acme.atlassian.net",
      JIRA_EMAIL: "alice@acme.com",
      JIRA_API_TOKEN: "tok_abc",
    });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["jira"]),
      credentials: creds,
    });
    expect(mcps.jira).toBeDefined();
  });

  it("Jira MCP is NOT wired without all 3 creds", () => {
    const creds = buildCredentialMap({
      JIRA_BASE_URL: "https://acme.atlassian.net",
      JIRA_EMAIL: "alice@acme.com",
      // missing JIRA_API_TOKEN
    });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["jira"]),
      credentials: creds,
    });
    expect(mcps.jira).toBeUndefined();
  });

  // ── Notion: both env-var spellings ──

  it("user setting NOTION_API_KEY (official Notion name) auto-wires Notion MCP", () => {
    const creds = buildCredentialMap({ NOTION_API_KEY: "secret_abc" });
    expect(creds.NOTION_API_KEY).toBe("secret_abc");

    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["notion"]),
      credentials: creds,
    });
    expect(mcps.notion).toBeDefined();
    expect(mcps.notion?.env?.NOTION_TOKEN).toBe("secret_abc");
  });

  it("user setting NOTION_TOKEN auto-wires Notion MCP", () => {
    const creds = buildCredentialMap({ NOTION_TOKEN: "secret_xyz" });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["notion"]),
      credentials: creds,
    });
    expect(mcps.notion?.env?.NOTION_TOKEN).toBe("secret_xyz");
  });

  // ── BetterStack token fallbacks ──

  it("user setting BETTERSTACK_API_TOKEN auto-wires BetterStack MCP", () => {
    const creds = buildCredentialMap({ BETTERSTACK_API_TOKEN: "bs_abc" });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["betterstack"]),
      credentials: creds,
    });
    expect(mcps.betterstack).toBeDefined();
    expect(mcps.betterstack?.headers?.Authorization).toBe("Bearer bs_abc");
  });

  it("user setting BETTERSTACK_TELEMETRY_TOKEN reaches the MCP layer", () => {
    const creds = buildCredentialMap({ BETTERSTACK_TELEMETRY_TOKEN: "bs_tel_abc" });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["betterstack"]),
      credentials: creds,
    });
    expect(mcps.betterstack?.headers?.Authorization).toBe("Bearer bs_tel_abc");
  });

  // ── Happy-path: all the common providers at once ──

  it("end-to-end: a typical SRE triage env wires every expected MCP", () => {
    const creds = buildCredentialMap({
      GITHUB_TOKEN: "ghp_abc",
      LINEAR_API_KEY: "lin_abc",
      DD_API_KEY: "dd_api",
      DD_APP_KEY: "dd_app",
      SLACK_BOT_TOKEN: "xoxb-abc",
    });
    const mcps = buildSkillMcpServers({
      referencedSkills: new Set(["github", "linear", "datadog", "slack"]),
      credentials: creds,
    });
    expect(Object.keys(mcps).sort()).toEqual(["datadog", "github", "linear", "slack"]);
  });

  it("returns empty creds for an empty env", () => {
    expect(buildCredentialMap({})).toEqual({});
  });

  it("ignores empty-string env values (treats them as unset)", () => {
    const creds = buildCredentialMap({ GITHUB_TOKEN: "", LINEAR_API_KEY: "lin_abc" });
    expect(creds.GITHUB_TOKEN).toBeUndefined();
    expect(creds.LINEAR_API_KEY).toBe("lin_abc");
  });
});
