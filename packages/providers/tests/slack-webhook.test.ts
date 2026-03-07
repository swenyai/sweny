import { describe, it, expect, vi, afterEach } from "vitest";
import { slackWebhook, slackWebhookConfigSchema } from "../src/notification/slack-webhook.js";

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

describe("slackWebhookConfigSchema", () => {
  it("validates a valid webhookUrl", () => {
    expect(
      slackWebhookConfigSchema.safeParse({
        webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
      }).success,
    ).toBe(true);
  });

  it("rejects non-URL string", () => {
    expect(slackWebhookConfigSchema.safeParse({ webhookUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects missing webhookUrl", () => {
    expect(slackWebhookConfigSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// notify() — HTTP request
// ---------------------------------------------------------------------------

describe("slackWebhook notify", () => {
  it("sends POST to the configured webhookUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await provider.send(payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/T/B/x");
    expect(init.method).toBe("POST");
  });

  it("sends content-type application/json", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await provider.send(payload);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("request body contains blocks array (Block Kit)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await provider.send(payload);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  it("success payload produces a section block with ✅ emoji", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await provider.send({ ...payload, status: "success", summary: "All good" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const statusBlock = body.blocks.find(
      (b: { type: string; text?: { text: string } }) => b.type === "section" && b.text?.text.includes("✅"),
    );
    expect(statusBlock).toBeDefined();
  });

  it("error payload produces a section block with ❌ emoji", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await provider.send({ ...payload, status: "error", summary: "Something failed" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const statusBlock = body.blocks.find(
      (b: { type: string; text?: { text: string } }) => b.type === "section" && b.text?.text.includes("❌"),
    );
    expect(statusBlock).toBeDefined();
  });

  it("summary text appears in a section block", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await provider.send({ ...payload, summary: "Triage complete for acme/api" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const summaryBlock = body.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === "section" && b.text?.text.includes("Triage complete for acme/api"),
    );
    expect(summaryBlock).toBeDefined();
  });

  it("throws on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "",
    });

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await expect(provider.send(payload)).rejects.toThrow("Slack API error: 500 Internal Server Error");
  });

  it("throws on 429 Too Many Requests", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "",
    });

    const provider = slackWebhook({ webhookUrl: "https://hooks.slack.com/services/T/B/x", logger: silentLogger });
    await expect(provider.send(payload)).rejects.toThrow("Slack API error: 429");
  });
});
