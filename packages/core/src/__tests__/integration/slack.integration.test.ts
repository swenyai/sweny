import { describe, it, expect } from "vitest";
import { available } from "./harness.js";
import { slack } from "../../skills/slack.js";
import type { ToolContext } from "../../types.js";

const ctx = (): ToolContext => ({
  config: {
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ?? "",
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? "",
  },
  logger: console,
});

// Only run Slack integration tests when explicitly opted in
// to avoid spamming channels during routine test runs
const slackEnabled = available.slack && process.env.SLACK_INTEGRATION_TEST === "1";

describe.runIf(slackEnabled)("slack integration", () => {
  it("sends a test message via webhook", async () => {
    if (!process.env.SLACK_WEBHOOK_URL) return;
    const tool = slack.tools.find((t) => t.name === "slack_send_message")!;
    const result: any = await tool.handler({ text: `🧪 SWEny integration test — ${new Date().toISOString()}` }, ctx());
    expect(result).toHaveProperty("ok");
  }, 15_000);
});
