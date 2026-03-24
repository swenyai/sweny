/**
 * Tests for buildMcpServers() in packages/worker/src/providers.ts.
 *
 * These tests verify the credential → MCP server config mapping without
 * spinning up any real processes or network connections.
 */
import { describe, it, expect, vi } from "vitest";

// Mock env before module import
vi.mock("../src/env.js", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    INTERNAL_API_URL: "http://localhost:3001",
    QUEUE_NAME: "sweny-jobs",
    CONCURRENCY: 1,
    CODING_AGENT: "claude",
  },
}));

// Mock @sweny-ai/providers (type-only import, but the mock avoids any side effects)
vi.mock("@sweny-ai/providers", () => ({}));

const { buildMcpServers } = await import("../src/providers.js");

describe("buildMcpServers", () => {
  it("returns empty object when credentials have no Sentry token", () => {
    expect(buildMcpServers({ GITHUB_TOKEN: "ghp_test", ANTHROPIC_API_KEY: "sk-ant" })).toEqual({});
  });

  it("returns empty object for empty credentials", () => {
    expect(buildMcpServers({})).toEqual({});
  });

  it("returns Sentry stdio server when SENTRY_AUTH_TOKEN is present", () => {
    const servers = buildMcpServers({ SENTRY_AUTH_TOKEN: "sntryu_token" });
    expect(servers).toHaveProperty("sentry");
    expect(servers.sentry.type).toBe("stdio");
    expect(servers.sentry.command).toBe("npx");
    expect(servers.sentry.args).toEqual(["-y", "@sentry/mcp-server@latest"]);
  });

  it("maps SENTRY_AUTH_TOKEN → SENTRY_ACCESS_TOKEN in server env", () => {
    const servers = buildMcpServers({ SENTRY_AUTH_TOKEN: "sntryu_secret" });
    expect(servers.sentry.env?.SENTRY_ACCESS_TOKEN).toBe("sntryu_secret");
    expect(servers.sentry.env).not.toHaveProperty("SENTRY_AUTH_TOKEN");
  });

  it("omits SENTRY_HOST when SENTRY_BASE_URL is absent (defaults to sentry.io)", () => {
    const servers = buildMcpServers({ SENTRY_AUTH_TOKEN: "tok" });
    expect(servers.sentry.env).not.toHaveProperty("SENTRY_HOST");
  });

  it("omits SENTRY_HOST when SENTRY_BASE_URL is https://sentry.io", () => {
    const servers = buildMcpServers({
      SENTRY_AUTH_TOKEN: "tok",
      SENTRY_BASE_URL: "https://sentry.io",
    });
    expect(servers.sentry.env).not.toHaveProperty("SENTRY_HOST");
  });

  it("sets SENTRY_HOST as hostname-only for self-hosted Sentry", () => {
    // The MCP server expects a bare hostname, not a full URL with protocol
    const servers = buildMcpServers({
      SENTRY_AUTH_TOKEN: "tok",
      SENTRY_BASE_URL: "https://sentry.corp.example.com",
    });
    expect(servers.sentry.env?.SENTRY_HOST).toBe("sentry.corp.example.com");
  });

  it("omits SENTRY_HOST and does not throw when SENTRY_BASE_URL is malformed", () => {
    expect(() => buildMcpServers({ SENTRY_AUTH_TOKEN: "tok", SENTRY_BASE_URL: "not::a-url" })).not.toThrow();
    const servers = buildMcpServers({ SENTRY_AUTH_TOKEN: "tok", SENTRY_BASE_URL: "not::a-url" });
    expect(servers.sentry.env).not.toHaveProperty("SENTRY_HOST");
  });
});
