import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadEnv = vi.hoisted(() =>
  vi.fn(() => ({
    claudeApiKey: "sk-ant-test",
    logLevel: "info" as const,
  })),
);

vi.mock("../../src/config/schema.js", () => ({
  loadEnv: mockLoadEnv,
}));

vi.mock("../../src/auth/no-auth.js", () => ({
  noAuth: () => ({ displayName: "no-auth", authenticate: vi.fn() }),
}));

import { loadConfig } from "../../src/config/loader.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadEnv.mockReturnValue({
      claudeApiKey: "sk-ant-test",
      logLevel: "info" as const,
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("returns default config when no config file exists", async () => {
    const result = await loadConfig("/nonexistent/sweny.config.ts");

    expect(result.sweny.name).toBe("sweny-agent");
    expect(result.sweny.plugins).toEqual([]);
    expect(result.env.claudeApiKey).toBe("sk-ant-test");
  });

  it("returns env config from loadEnv()", async () => {
    mockLoadEnv.mockReturnValue({
      claudeApiKey: "sk-custom",
      claudeOauthToken: "oauth-tok",
      logLevel: "debug" as const,
    });

    const result = await loadConfig("/nonexistent/config.ts");

    expect(result.env.claudeApiKey).toBe("sk-custom");
    expect(result.env.claudeOauthToken).toBe("oauth-tok");
    expect(result.env.logLevel).toBe("debug");
  });

  it("falls back to default config on import error", async () => {
    // Invalid path triggers import error, should not throw
    const result = await loadConfig("/definitely/not/a/real/file.ts");

    expect(result.sweny.name).toBe("sweny-agent");
  });

  it("auto-constructs slack config from env vars when not set in config", async () => {
    mockLoadEnv.mockReturnValue({
      claudeApiKey: "sk-ant-test",
      logLevel: "info" as const,
      slackAppToken: "xapp-123",
      slackBotToken: "xoxb-456",
      slackSigningSecret: "sec-789",
    });

    const result = await loadConfig("/nonexistent/config.ts");

    expect(result.sweny.slack).toEqual({
      appToken: "xapp-123",
      botToken: "xoxb-456",
      signingSecret: "sec-789",
    });
  });

  it("does not auto-construct slack config when only some env vars are set", async () => {
    mockLoadEnv.mockReturnValue({
      claudeApiKey: "sk-ant-test",
      logLevel: "info" as const,
      slackAppToken: "xapp-123",
      // missing slackBotToken and slackSigningSecret
    });

    const result = await loadConfig("/nonexistent/config.ts");

    expect(result.sweny.slack).toBeUndefined();
  });

  it("merges logLevel from env when not set in config", async () => {
    mockLoadEnv.mockReturnValue({
      claudeApiKey: "sk-ant-test",
      logLevel: "warn" as const,
    });

    const result = await loadConfig("/nonexistent/config.ts");

    expect(result.sweny.logLevel).toBe("warn");
  });

  it("resolves configPath relative to cwd when not provided", async () => {
    // We can't easily test the actual dynamic import, but we can verify
    // it doesn't throw and returns a valid default config
    process.cwd = () => "/tmp/test-project";

    const result = await loadConfig();

    expect(result.sweny.name).toBe("sweny-agent");
  });
});
