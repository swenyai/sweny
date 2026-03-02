import { createHmac } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { webhook, webhookConfigSchema } from "../src/notification/webhook.js";
import { ProviderApiError } from "../src/errors.js";

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("webhookConfigSchema", () => {
  it("validates a valid URL", () => {
    expect(webhookConfigSchema.safeParse({ url: "https://example.com/hook" }).success).toBe(true);
  });

  it("rejects invalid URL", () => {
    expect(webhookConfigSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
  });

  it("defaults method to POST", () => {
    const result = webhookConfigSchema.parse({ url: "https://example.com/hook" });
    expect(result.method).toBe("POST");
  });

  it("accepts PUT method", () => {
    const result = webhookConfigSchema.parse({ url: "https://example.com/hook", method: "PUT" });
    expect(result.method).toBe("PUT");
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe("webhook provider", () => {
  it("sends POST with correct JSON body and content-type", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = webhook({ url: "https://example.com/hook", logger: silentLogger });
    await provider.send({ title: "Alert", body: "something broke", format: "markdown" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.title).toBe("Alert");
    expect(body.body).toBe("something broke");
    expect(body.format).toBe("markdown");
    expect(body.timestamp).toBeDefined();
  });

  it("merges custom headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = webhook({
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer token123", "X-Custom": "value" },
      logger: silentLogger,
    });
    await provider.send({ body: "test" });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer token123");
    expect(headers["X-Custom"]).toBe("value");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("computes HMAC-SHA256 signature when signingSecret is set", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const secret = "my-webhook-secret";
    const provider = webhook({
      url: "https://example.com/hook",
      signingSecret: secret,
      logger: silentLogger,
    });
    await provider.send({ body: "test" });

    const [, opts] = mockFetch.mock.calls[0];
    const rawBody = opts.body;
    const expectedSig = createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(opts.headers["X-Signature-256"]).toBe(`sha256=${expectedSig}`);
  });

  it("omits signature header when no signingSecret", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = webhook({ url: "https://example.com/hook", logger: silentLogger });
    await provider.send({ body: "test" });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Signature-256"]).toBeUndefined();
  });

  it("supports PUT method", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = webhook({ url: "https://example.com/hook", method: "PUT", logger: silentLogger });
    await provider.send({ body: "test" });

    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
  });

  it("throws ProviderApiError on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.resolve("upstream error"),
    });

    const provider = webhook({ url: "https://example.com/hook", logger: silentLogger });

    await expect(provider.send({ body: "test" })).rejects.toThrow(ProviderApiError);
    await expect(provider.send({ body: "test" })).rejects.toThrow("webhook API error: 502 Bad Gateway");
  });

  it("includes timestamp in payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = webhook({ url: "https://example.com/hook", logger: silentLogger });
    await provider.send({ body: "test" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Timestamp should be a valid ISO 8601 string
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("logs on successful send", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const provider = webhook({ url: "https://example.com/hook", logger: silentLogger });
    await provider.send({ body: "test" });

    expect(silentLogger.info).toHaveBeenCalledWith("Webhook notification sent to https://example.com/hook");
  });

  it("forwards all structured fields in JSON payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = webhook({ url: "https://example.com/hook", logger: silentLogger });
    await provider.send({
      title: "Triage Summary",
      body: "fallback",
      status: "success",
      summary: "PR created",
      fields: [{ label: "Service", value: "api-*", short: true }],
      sections: [{ title: "Log", content: "Found 3 errors" }],
      links: [{ label: "View PR", url: "https://github.com/org/repo/pull/42" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.status).toBe("success");
    expect(body.summary).toBe("PR created");
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0].label).toBe("Service");
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].title).toBe("Log");
    expect(body.links).toHaveLength(1);
    expect(body.links[0].url).toBe("https://github.com/org/repo/pull/42");
  });
});
