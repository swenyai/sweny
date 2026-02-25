import { describe, it, expect, vi, afterEach } from "vitest";
import { slackWebhook, slackWebhookConfigSchema } from "../src/notification/slack-webhook.js";
import { teamsWebhook, teamsWebhookConfigSchema } from "../src/notification/teams-webhook.js";
import { discordWebhook, discordWebhookConfigSchema } from "../src/notification/discord-webhook.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("slackWebhookConfigSchema", () => {
  it("validates a valid URL", () => {
    expect(
      slackWebhookConfigSchema.safeParse({
        webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
      }).success,
    ).toBe(true);
  });

  it("rejects non-URL string", () => {
    expect(
      slackWebhookConfigSchema.safeParse({ webhookUrl: "not-a-url" }).success,
    ).toBe(false);
  });
});

describe("teamsWebhookConfigSchema", () => {
  it("validates a valid URL", () => {
    expect(
      teamsWebhookConfigSchema.safeParse({
        webhookUrl: "https://outlook.office.com/webhook/xxx",
      }).success,
    ).toBe(true);
  });
});

describe("discordWebhookConfigSchema", () => {
  it("validates a valid URL", () => {
    expect(
      discordWebhookConfigSchema.safeParse({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slack webhook
// ---------------------------------------------------------------------------

describe("slackWebhook", () => {
  it("sends markdown body with title as bold prefix", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({ title: "Alert", body: "something broke" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/T/B/x");
    const payload = JSON.parse(opts.body);
    expect(payload.text).toBe("*Alert*\nsomething broke");
  });

  it("sends body only when no title", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({ body: "just a message" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.text).toBe("just a message");
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await expect(provider.send({ body: "x" })).rejects.toThrow(
      "Slack webhook error: 500 Internal Server Error",
    );
  });
});

// ---------------------------------------------------------------------------
// Teams webhook
// ---------------------------------------------------------------------------

describe("teamsWebhook", () => {
  it("sends Adaptive Card with title and body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({
      webhookUrl: "https://outlook.office.com/webhook/xxx",
      logger: silentLogger,
    });

    await provider.send({ title: "Deploy", body: "v1.2.3 deployed" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.type).toBe("message");
    expect(payload.attachments[0].content.type).toBe("AdaptiveCard");
    const blocks = payload.attachments[0].content.body;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("Deploy");
    expect(blocks[1].text).toBe("v1.2.3 deployed");
  });

  it("sends body-only card when no title", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({
      webhookUrl: "https://outlook.office.com/webhook/xxx",
      logger: silentLogger,
    });

    await provider.send({ body: "hello" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const blocks = payload.attachments[0].content.body;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Discord webhook
// ---------------------------------------------------------------------------

describe("discordWebhook", () => {
  it("sends content with bold title prefix", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await provider.send({ title: "Alert", body: "fire" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.content).toBe("**Alert**\nfire");
  });

  it("truncates messages over 2000 chars", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    const longBody = "x".repeat(3000);
    await provider.send({ body: longBody });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.content.length).toBe(2000);
    expect(payload.content.endsWith("...")).toBe(true);
  });
});
