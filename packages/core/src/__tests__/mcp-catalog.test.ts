import { describe, it, expect } from "vitest";
import { MCP_CATALOG, type McpCatalogEntry } from "../mcp-catalog.js";

// Fix #15 + #18: catalog-level invariants. These guard against future
// entries silently drifting from the policy documented in ARCHITECTURE.md.

describe("MCP_CATALOG", () => {
  it("has unique ids", () => {
    const ids = MCP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has at least one trigger for every entry", () => {
    for (const entry of MCP_CATALOG) {
      const { skill, sourceControl, issueTracker, observability, workspaceTool } = entry.triggers;
      const total =
        (skill?.length ?? 0) +
        (sourceControl?.length ?? 0) +
        (issueTracker?.length ?? 0) +
        (observability?.length ?? 0) +
        (workspaceTool?.length ?? 0);
      expect(total).toBeGreaterThan(0);
    }
  });

  it("every stdio entry has a non-empty npxExceptionReason", () => {
    for (const entry of MCP_CATALOG) {
      if (entry.transport === "stdio") {
        expect(entry.npxExceptionReason, `entry "${entry.id}"`).not.toBeNull();
        expect(entry.npxExceptionReason!.length, `entry "${entry.id}"`).toBeGreaterThan(10);
      }
    }
  });

  it("every http entry has a null npxExceptionReason (no exception needed)", () => {
    for (const entry of MCP_CATALOG) {
      if (entry.transport === "http") {
        expect(entry.npxExceptionReason, `entry "${entry.id}"`).toBeNull();
      }
    }
  });

  it("stdio entries wire `npx` as their command", () => {
    for (const entry of MCP_CATALOG) {
      if (entry.transport !== "stdio") continue;
      // Provide creds for every env var any stdio wire looks at — gross but
      // it lets wire() succeed so we can inspect the command. Over-providing
      // is harmless.
      const allCreds: Record<string, string> = {
        GITHUB_TOKEN: "x",
        GITLAB_TOKEN: "x",
        LINEAR_API_KEY: "x",
        JIRA_URL: "https://x.atlassian.net",
        JIRA_EMAIL: "a@b.c",
        JIRA_API_TOKEN: "x",
        SENTRY_AUTH_TOKEN: "x",
        SLACK_BOT_TOKEN: "x",
        NOTION_TOKEN: "x",
        MONDAY_TOKEN: "x",
      };
      const config = entry.wire(allCreds);
      if (!config) continue; // entry couldn't wire with these creds — skip
      expect(config.type, `entry "${entry.id}"`).toBe("stdio");
      expect(config.command, `entry "${entry.id}"`).toBe("npx");
    }
  });

  it("http entries expose url + headers", () => {
    for (const entry of MCP_CATALOG) {
      if (entry.transport !== "http") continue;
      const allCreds: Record<string, string> = {
        LINEAR_API_KEY: "x",
        DD_API_KEY: "x",
        DD_APP_KEY: "x",
        NEW_RELIC_API_KEY: "x",
        BETTERSTACK_API_TOKEN: "x",
        PAGERDUTY_API_TOKEN: "x",
      };
      const config = entry.wire(allCreds);
      if (!config) continue;
      expect(config.type, `entry "${entry.id}"`).toBe("http");
      expect(config.url, `entry "${entry.id}"`).toBeTypeOf("string");
      expect(config.headers, `entry "${entry.id}"`).toBeTypeOf("object");
    }
  });

  it("wire() returns undefined when required creds are missing", () => {
    for (const entry of MCP_CATALOG) {
      expect(entry.wire({}), `entry "${entry.id}"`).toBeUndefined();
    }
  });

  // Covers the documented provider IDs so accidentally deleting one shows up
  // as a test failure, not a silent drop.
  it("includes the expected set of providers", () => {
    const ids = new Set(MCP_CATALOG.map((e) => e.id));
    for (const expected of [
      "github",
      "gitlab",
      "linear",
      "jira",
      "datadog",
      "sentry",
      "newrelic",
      "betterstack",
      "slack",
      "notion",
      "pagerduty",
      "monday",
    ]) {
      expect(ids.has(expected), `expected provider "${expected}" in catalog`).toBe(true);
    }
  });
});

describe("catalog shape", () => {
  it("every entry matches the McpCatalogEntry type", () => {
    // Compile-time check is the real test. This just ensures we at least
    // see every entry's id when iterating — if the import shape breaks,
    // TypeScript would fail before getting here.
    const entries: McpCatalogEntry[] = [...MCP_CATALOG];
    expect(entries.length).toBeGreaterThan(0);
  });
});
