import { describe, it, expect } from "vitest";
import { envSchema } from "../../src/config/schema.js";

describe("envSchema", () => {
  it("passes with ANTHROPIC_API_KEY", () => {
    const result = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
    });
    expect(result.success).toBe(true);
  });

  it("passes with CLAUDE_CODE_OAUTH_TOKEN", () => {
    const result = envSchema.safeParse({
      claudeOauthToken: "oauth-token-value",
    });
    expect(result.success).toBe(true);
  });

  it("passes with both credentials", () => {
    const result = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
      claudeOauthToken: "oauth-token-value",
    });
    expect(result.success).toBe(true);
  });

  it("fails with neither credential", () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts any non-empty SLACK_APP_TOKEN", () => {
    const valid = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
      slackAppToken: "xapp-1-ABCDEF",
    });
    expect(valid.success).toBe(true);

    const alsoValid = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
      slackAppToken: "any-token-format",
    });
    expect(alsoValid.success).toBe(true);
  });

  it("accepts any non-empty SLACK_BOT_TOKEN", () => {
    const valid = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
      slackBotToken: "xoxb-abc-123",
    });
    expect(valid.success).toBe(true);

    const alsoValid = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
      slackBotToken: "any-token-format",
    });
    expect(alsoValid.success).toBe(true);
  });

  it("LOG_LEVEL defaults to info", () => {
    const result = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logLevel).toBe("info");
    }
  });

  it("accepts valid LOG_LEVEL values", () => {
    for (const level of ["debug", "info", "warn", "error"]) {
      const result = envSchema.safeParse({
        claudeApiKey: "sk-ant-test-key",
        logLevel: level,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid LOG_LEVEL values", () => {
    const result = envSchema.safeParse({
      claudeApiKey: "sk-ant-test-key",
      logLevel: "verbose",
    });
    expect(result.success).toBe(false);
  });
});
