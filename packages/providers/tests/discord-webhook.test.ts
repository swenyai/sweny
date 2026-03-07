import { describe, it, expect, vi, afterEach } from "vitest";
import { discordWebhook, discordWebhookConfigSchema } from "../src/notification/discord-webhook.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const payload = {
  status: "success" as const,
  summary: "Triage complete for acme/api",
  body: "Triage complete for acme/api",
  fields: [{ label: "Repo", value: "acme/api" }],
  sections: [],
  links: [],
};

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("discordWebhookConfigSchema", () => {
  it("validates a valid webhookUrl", () => {
    expect(
      discordWebhookConfigSchema.safeParse({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      }).success,
    ).toBe(true);
  });

  it("rejects non-URL string", () => {
    expect(discordWebhookConfigSchema.safeParse({ webhookUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects missing webhookUrl", () => {
    expect(discordWebhookConfigSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// notify() — HTTP request
// ---------------------------------------------------------------------------

describe("discordWebhook notify", () => {
  it("sends POST to the configured webhookUrl with content-type application/json", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await provider.send(payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/123/abc");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("request body has embeds array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await provider.send(payload);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.embeds)).toBe(true);
    expect(body.embeds.length).toBeGreaterThan(0);
  });

  it("success status sets green color (5763719)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await provider.send({ ...payload, status: "success" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].color).toBe(5763719); // #57F287 green
  });

  it("error status sets red color (15548997)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await provider.send({ ...payload, status: "error", summary: "Deploy failed" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].color).toBe(15548997); // #ED4245 red
  });

  it("failure (error) status sets red color, not green", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await provider.send({ ...payload, status: "error", summary: "Something broke" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].color).not.toBe(5763719);
    expect(body.embeds[0].color).toBe(15548997);
  });

  it("summary with success status uses ✅ emoji in description", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await provider.send({ ...payload, status: "success", summary: "Triage complete for acme/api" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].description).toContain("✅");
    expect(body.embeds[0].description).toContain("Triage complete for acme/api");
  });

  it("body text appears in description when no summary", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await provider.send({ body: "plain message here" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].description).toContain("plain message here");
  });

  it("throws on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "invalid payload",
    });

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await expect(provider.send(payload)).rejects.toThrow("Discord API error: 400 Bad Request");
  });

  it("throws on 500 Internal Server Error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "",
    });

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });
    await expect(provider.send(payload)).rejects.toThrow("Discord API error: 500");
  });
});
